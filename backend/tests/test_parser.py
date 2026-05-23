"""Tests for email parsing utilities and document extraction service.

All tests here are pure unit tests (no network, no DB, no real LLM calls).
DocumentParser tests mock the Anthropic client so they run offline.
"""
import pytest
from datetime import date
from unittest.mock import MagicMock, patch
from pydantic import ValidationError

from app.utils.email_parsing import (
    ALLOWED_CATEGORIES,
    UNCATEGORIZED,
    parse_sub_address_variable,
)
from app.services.document_parser import (
    DocumentParser,
    NotAReceiptError,
    ReceiptExtraction,
)


# ── parse_sub_address_variable ────────────────────────────────────────────────

@pytest.mark.unit
def test_parse_sub_address_valid_categories():
    """All allowed categories resolve correctly regardless of case/whitespace."""
    assert parse_sub_address_variable("jamestinsley+personal@gmail.com") == "personal"
    assert parse_sub_address_variable("JamesTinsley+EdgeHill@gmail.com") == "edgehill"
    assert parse_sub_address_variable(" jamestinsley+realestate@gmail.com ") == "realestate"
    assert parse_sub_address_variable("jamestinsley+traverse@gmail.com") == "traverse"
    assert parse_sub_address_variable("jamestinsley+trust@gmail.com") == "trust"
    assert parse_sub_address_variable("jamestinsley+nopa@gmail.com") == "nopa"


@pytest.mark.unit
def test_parse_sub_address_angle_brackets():
    """Angle-bracket-wrapped addresses (common in raw To: headers) parse correctly."""
    assert parse_sub_address_variable("<jamestinsley+traverse@gmail.com>") == "traverse"


@pytest.mark.unit
def test_parse_sub_address_unknown_category_returns_uncategorized():
    """Unrecognised sub-address token returns UNCATEGORIZED rather than raising."""
    result = parse_sub_address_variable("jamestinsley+unregisteredcategory@gmail.com")
    assert result == UNCATEGORIZED


@pytest.mark.unit
def test_parse_sub_address_missing_plus_raises():
    """Address without a '+' delimiter raises ValueError."""
    with pytest.raises(ValueError, match="Missing sub-address token delimiter"):
        parse_sub_address_variable("jamestinsley@gmail.com")


@pytest.mark.unit
def test_parse_sub_address_missing_at_raises():
    """Address without '@' raises ValueError."""
    with pytest.raises(ValueError, match="Missing sub-address token delimiter"):
        parse_sub_address_variable("jamestinsley+personal")


@pytest.mark.unit
def test_allowed_categories_contains_expected_set():
    """ALLOWED_CATEGORIES covers the expected property portfolio + personal."""
    expected = {"personal", "realestate", "traverse", "edgehill", "trust", "nopa"}
    assert expected == ALLOWED_CATEGORIES


# ── ReceiptExtraction schema ───────────────────────────────────────────────────

@pytest.mark.unit
def test_receipt_extraction_valid_payload():
    """A fully-populated payload maps cleanly to ReceiptExtraction."""
    payload = {
        "payee": "PG&E",
        "amount": 142.50,
        "date": "2026-05-14",
        "inferred_purpose": "Monthly electric utility charge split for Edgehill",
        "recurring_type": "ongoing",
        "payment_category": "utilities",
        "payment_detail": "Monthly electricity bill",
    }
    r = ReceiptExtraction(**payload)
    assert r.payee == "PG&E"
    assert r.amount == 142.50
    assert r.recurring_type == "ongoing"
    assert r.payment_category == "utilities"
    assert r.payment_detail == "Monthly electricity bill"


@pytest.mark.unit
def test_receipt_extraction_invalid_amount_raises():
    """Non-numeric amount triggers a Pydantic ValidationError."""
    payload = {
        "payee": "Home Depot",
        "amount": "not-a-float-amount",
        "date": "2026-05-14",
        "inferred_purpose": "Construction lumber",
        "recurring_type": "one_off",
        "payment_category": "construction",
        "payment_detail": "Lumber purchase",
    }
    with pytest.raises(ValidationError):
        ReceiptExtraction(**payload)


@pytest.mark.unit
def test_receipt_extraction_missing_required_fields_raises():
    """Omitting required fields raises ValidationError."""
    with pytest.raises(ValidationError):
        ReceiptExtraction(payee="Acme", amount=10.0)  # missing date, purpose, etc.


# ── DocumentParser (mocked Anthropic client) ──────────────────────────────────

def _make_tool_response(tool_name: str, tool_input: dict) -> MagicMock:
    """Build a minimal mock Anthropic Messages response with one tool_use block."""
    block = MagicMock()
    block.type = "tool_use"
    block.name = tool_name
    block.input = tool_input

    response = MagicMock()
    response.content = [block]
    return response


VALID_EXTRACTION_INPUT = {
    "payee": "Comcast",
    "amount": 54.20,
    "date": "2026-05-10",
    "inferred_purpose": "Internet service provider invoice statement",
    "recurring_type": "ongoing",
    "payment_category": "subscriptions",
    "payment_detail": "Monthly internet bill",
}


@pytest.mark.unit
def test_document_parser_extract_from_email_success():
    """extract_from_email returns ReceiptExtraction when LLM calls record_receipt."""
    with patch("app.services.document_parser.Anthropic") as MockAnthropic:
        MockAnthropic.return_value.messages.create.return_value = _make_tool_response(
            "record_receipt", VALID_EXTRACTION_INPUT
        )
        parser = DocumentParser()
        result = parser.extract_from_email(
            subject="Your Comcast bill is ready",
            body_text="Your invoice total for account 00392 is $54.20. Paid on 2026-05-10.",
        )

    assert isinstance(result, ReceiptExtraction)
    assert result.payee == "Comcast"
    assert result.amount == 54.20
    assert result.recurring_type == "ongoing"


@pytest.mark.unit
def test_document_parser_skip_email_raises_not_a_receipt():
    """extract_from_email raises NotAReceiptError when LLM calls skip_email."""
    with patch("app.services.document_parser.Anthropic") as MockAnthropic:
        MockAnthropic.return_value.messages.create.return_value = _make_tool_response(
            "skip_email", {"reason": "Marketing email with no transaction"}
        )
        parser = DocumentParser()
        with pytest.raises(NotAReceiptError, match="Marketing email"):
            parser.extract_from_email(
                subject="Check out our sale!",
                body_text="Big discounts this weekend only.",
            )


@pytest.mark.unit
def test_document_parser_no_tool_call_raises_runtime_error():
    """extract_from_email raises RuntimeError when Claude returns no tool call."""
    text_block = MagicMock()
    text_block.type = "text"
    response = MagicMock()
    response.content = [text_block]

    with patch("app.services.document_parser.Anthropic") as MockAnthropic:
        MockAnthropic.return_value.messages.create.return_value = response
        parser = DocumentParser()
        with pytest.raises(RuntimeError, match="did not include a tool call"):
            parser.extract_from_email(subject="Test", body_text="No tool here.")


@pytest.mark.unit
def test_document_parser_extract_from_email_with_attachments():
    """extract_from_email passes attachment bytes through without error."""
    with patch("app.services.document_parser.Anthropic") as MockAnthropic:
        MockAnthropic.return_value.messages.create.return_value = _make_tool_response(
            "record_receipt", VALID_EXTRACTION_INPUT
        )
        parser = DocumentParser()
        fake_pdf = b"%PDF-1.4 fake content"
        result = parser.extract_from_email(
            subject="Invoice attached",
            body_text="Please find your invoice attached.",
            attachments=[(fake_pdf, "application/pdf")],
        )

    assert result.payee == "Comcast"
    # Verify the API was called with content that includes a document block
    call_args = MockAnthropic.return_value.messages.create.call_args
    content = call_args.kwargs["messages"][0]["content"]
    types = [block["type"] for block in content if isinstance(block, dict)]
    assert "document" in types


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mock_ingestion_pipeline_run():
    """Simulates a full pipeline: sub-address parse → LLM extraction → validated record."""
    email_context = {
        "to": "jamestinsley+edgehill@gmail.com",
        "subject": "Your invoice",
        "body": "Your invoice total for account 00392 is $54.20. Paid on 2026-05-10.",
    }

    # Step 1: parse category from To header
    category = parse_sub_address_variable(email_context["to"])
    assert category == "edgehill"

    # Step 2: LLM extraction (mocked)
    with patch("app.services.document_parser.Anthropic") as MockAnthropic:
        MockAnthropic.return_value.messages.create.return_value = _make_tool_response(
            "record_receipt", VALID_EXTRACTION_INPUT
        )
        parser = DocumentParser()
        record = parser.extract_from_email(
            subject=email_context["subject"],
            body_text=email_context["body"],
        )

    assert record.amount == 54.20
    assert record.recurring_type == "ongoing"
    assert category == "edgehill"

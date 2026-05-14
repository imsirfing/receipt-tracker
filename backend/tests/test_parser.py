import pytest
from datetime import date
from typing import Dict, Any
from pydantic import BaseModel, ValidationError

# --- Components under test (To be mirrored in backend implementation) ---

class ReceiptExtraction(BaseModel):
    payee: str
    amount: float
    date: str
    inferred_purpose: str
    recurring_type: str

def parse_sub_address_variable(to_header: str) -> str:
    """
    Extracts variable from format: jamestinsley+[variable]@gmail.com
    Validates against allowed structural categories.
    """
    allowed_categories = {"personal", "realestate", "traverse", "edgehill"}
    
    clean_header = to_header.lower().strip()
    if "+" not in clean_header or "@" not in clean_header:
        raise ValueError("Invalid email format: Missing sub-address token delimiter.")
        
    try:
        parts = clean_header.split("+")[1]
        variable = parts.split("@")[0]
    except IndexError:
        raise ValueError("Malformed sub-address format string structure.")
        
    if variable not in allowed_categories:
        raise ValueError(f"Unauthorized variable token category rejected: {variable}")
        
    return variable

# --- Pytest Structural Test Framework Suite ---

def test_parse_sub_address_variable_success():
    """Verify clean string isolation and variable normalization mappings."""
    assert parse_sub_address_variable("jamestinsley+personal@gmail.com") == "personal"
    assert parse_sub_address_variable("JamesTinsley+EdgeHill@gmail.com") == "edgehill"
    assert parse_sub_address_variable(" jamestinsley+realestate@gmail.com ") == "realestate"
    assert parse_sub_address_variable("<jamestinsley+traverse@gmail.com>") == "traverse"


def test_parse_sub_address_variable_failures():
    """Verify execution logic rejects missing sub-addresses or unregistered terms."""
    with pytest.raises(ValueError, match="Missing sub-address token delimiter"):
        parse_sub_address_variable("jamestinsley@gmail.com")
        
    with pytest.raises(ValueError, match="Unauthorized variable token category rejected"):
        parse_sub_address_variable("jamestinsley+unregisteredcategory@gmail.com")


def test_anthropic_structured_output_schema_conformance():
    """Assert valid structured payloads map cleanly to Pydantic expectations."""
    valid_payload = {
        "payee": "PG&E",
        "amount": 142.50,
        "date": "2026-05-14",
        "inferred_purpose": "Monthly electric utility charge split for Edgehill",
        "recurring_type": "ongoing"
    }
    
    extracted_data = ReceiptExtraction(**valid_payload)
    assert extracted_data.payee == "PG&E"
    assert extracted_data.amount == 142.50
    assert extracted_data.recurring_type == "ongoing"


def test_anthropic_structured_output_schema_validation_failures():
    """Ensure typing mismatches inside extraction targets trigger data errors instantly."""
    invalid_payload = {
        "payee": "Home Depot",
        "amount": "not-a-float-amount",  # Triggers strict validation type fault
        "date": "2026-05-14",
        "inferred_purpose": "Construction lumber",
        "recurring_type": "one_off"
    }
    
    with pytest.raises(ValidationError):
        ReceiptExtraction(**invalid_payload)


@pytest.mark.asyncio
async def test_mock_ingestion_pipeline_run(monkeypatch):
    """
    Simulates a decoupled pipeline execution run.
    Ensures OpenClaw can trace state flow assertions safely.
    """
    mock_email_context = {
        "to": "jamestinsley+edgehill@gmail.com",
        "body": "Your invoice total for account 00392 is $54.20. Paid on 2026-05-10.",
        "message_id": "msg-123456789"
    }
    
    # 1. Pipeline step: Extract parameters
    target_category = parse_sub_address_variable(mock_email_context["to"])
    assert target_category == "edgehill"
    
    # 2. Pipeline step: Mock LLM output injection tracking
    mock_llm_json = {
        "payee": "Comcast",
        "amount": 54.20,
        "date": "2026-05-10",
        "inferred_purpose": "Internet service provider invoice statement",
        "recurring_type": "ongoing"
    }
    
    validated_record = ReceiptExtraction(**mock_llm_json)
    assert validated_record.amount == 54.20
    assert validated_record.recurring_type == "ongoing"

"""LLM-powered receipt extraction.

Calls Claude with a structured tool schema and returns a validated
`ReceiptExtraction` Pydantic model.
"""
from __future__ import annotations

import base64
import os
from typing import Optional

from anthropic import Anthropic
from google.cloud import storage
from pydantic import BaseModel


class ReceiptExtraction(BaseModel):
    payee: str
    amount: float
    date: str
    inferred_purpose: str
    recurring_type: str
    payment_category: str
    payment_detail: str


SYSTEM_PROMPT = (
    "You are an accounting clerk extracting structured data from receipts and invoices.\n"
    "Rules:\n"
    "- payee: clean legal entity name (e.g. 'Pacific Gas & Electric Co.', not 'PG&E Billing Dept').\n"
    "- amount: pure float, the total charged. Strip currency symbols and commas.\n"
    "- date: transaction or invoice date in YYYY-MM-DD.\n"
    "- inferred_purpose: 1-2 sentence explanation of what the payment is for and why it was made.\n"
    "- recurring_type: 'ongoing' for subscriptions, utilities, rent, insurance, "
    "or any recurring obligation; 'one_off' for isolated retail purchases.\n"
    "- payment_category: broad category of the expense. Use one of: "
    "'dining', 'groceries', 'utilities', 'rent/mortgage', 'insurance', 'healthcare', "
    "'transportation', 'fuel', 'travel', 'lodging', 'entertainment', 'sports/recreation', "
    "'education', 'childcare', 'subscriptions', 'software', 'office supplies', "
    "'home/garden', 'clothing', 'professional services', 'legal', 'taxes', "
    "'charitable giving', 'gifts', 'repairs/maintenance', 'construction', "
    "'real estate', 'investment', 'banking/fees', 'other'.\n"
    "- payment_detail: concise label for the specific line item or service "
    "(e.g. 'Fall 2026 soccer registration', 'Monthly electricity bill', 'Annual domain renewal').\n"
    "Always call the `record_receipt` tool exactly once."
)

EXTRACTION_TOOL = {
    "name": "record_receipt",
    "description": "Record extracted structured fields from a single receipt document.",
    "input_schema": {
        "type": "object",
        "properties": {
            "payee": {
                "type": "string",
                "description": "Clean legal entity name of the merchant or biller.",
            },
            "amount": {
                "type": "number",
                "description": "Total amount charged as a pure float, no currency symbols.",
            },
            "date": {
                "type": "string",
                "description": "Transaction date in YYYY-MM-DD format.",
            },
            "inferred_purpose": {
                "type": "string",
                "description": "1-2 sentence explanation of what the payment is for and why it was made.",
            },
            "recurring_type": {
                "type": "string",
                "enum": ["ongoing", "one_off"],
                "description": "'ongoing' for subscriptions/utilities/rent, otherwise 'one_off'.",
            },
            "payment_category": {
                "type": "string",
                "description": "Broad expense category (e.g. 'dining', 'utilities', 'sports/recreation', 'insurance', etc.).",
            },
            "payment_detail": {
                "type": "string",
                "description": "Concise label for the specific line item or service (e.g. 'Fall 2026 soccer registration').",
            },
        },
        "required": ["payee", "amount", "date", "inferred_purpose", "recurring_type", "payment_category", "payment_detail"],
    },
}


def _load_gcs_bytes(gcs_uri: str) -> tuple[bytes, str]:
    if not gcs_uri.startswith("gs://"):
        raise ValueError(f"expected gs:// URI, got {gcs_uri!r}")
    _, _, rest = gcs_uri.partition("gs://")
    bucket_name, _, blob_path = rest.partition("/")
    client = storage.Client(project=os.getenv("GCP_PROJECT_ID"))
    blob = client.bucket(bucket_name).blob(blob_path)
    data = blob.download_as_bytes()
    mime = blob.content_type or "application/pdf"
    return data, mime


class DocumentParser:
    def __init__(self, model: str = "claude-sonnet-4-5") -> None:
        self.model = model
        self.client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    def extract(
        self,
        document: bytes | str,
        *,
        mime_type: Optional[str] = None,
    ) -> ReceiptExtraction:
        """Extract from a binary attachment (PDF or image) optionally loaded from GCS."""
        if isinstance(document, str):
            data, detected_mime = _load_gcs_bytes(document)
            mime_type = mime_type or detected_mime
        else:
            data = document
            mime_type = mime_type or "application/pdf"

        encoded = base64.standard_b64encode(data).decode("ascii")

        if mime_type.startswith("image/"):
            content_block = {
                "type": "image",
                "source": {"type": "base64", "media_type": mime_type, "data": encoded},
            }
        else:
            content_block = {
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": encoded},
            }

        response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=[EXTRACTION_TOOL],
            tool_choice={"type": "tool", "name": "record_receipt"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        content_block,
                        {"type": "text", "text": "Extract the receipt fields."},
                    ],
                }
            ],
        )

        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "record_receipt":
                return ReceiptExtraction(**block.input)

        raise RuntimeError("Claude response did not include a record_receipt tool call")

    def extract_from_email(
        self,
        subject: str,
        body_text: str,
        attachments: Optional[list] = None,
    ) -> ReceiptExtraction:
        """Extract receipt data from email subject + body text, with optional attachment blobs.

        Args:
            subject: Email subject line.
            body_text: Plain-text or HTML-stripped email body.
            attachments: Optional list of (bytes, mime_type) tuples for attached files.
        """
        content: list = []

        # Primary source: email text
        content.append({
            "type": "text",
            "text": f"Subject: {subject}\n\n{body_text}",
        })

        # Supplement with attachments if present
        if attachments:
            for data, mime in attachments:
                encoded = base64.standard_b64encode(data).decode("ascii")
                if mime.startswith("image/"):
                    content.append({
                        "type": "image",
                        "source": {"type": "base64", "media_type": mime, "data": encoded},
                    })
                elif mime == "application/pdf":
                    content.append({
                        "type": "document",
                        "source": {"type": "base64", "media_type": "application/pdf", "data": encoded},
                    })

        content.append({"type": "text", "text": "Extract the receipt fields from the above email."})

        response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=[EXTRACTION_TOOL],
            tool_choice={"type": "tool", "name": "record_receipt"},
            messages=[{"role": "user", "content": content}],
        )

        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "record_receipt":
                return ReceiptExtraction(**block.input)

        raise RuntimeError("Claude response did not include a record_receipt tool call")

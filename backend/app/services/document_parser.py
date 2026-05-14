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


SYSTEM_PROMPT = (
    "You are an accounting clerk extracting structured data from receipts and invoices.\n"
    "Rules:\n"
    "- payee: clean legal entity name (e.g. 'Pacific Gas & Electric Co.', not 'PG&E Billing Dept').\n"
    "- amount: pure float, the total charged. Strip currency symbols and commas.\n"
    "- date: transaction or invoice date in YYYY-MM-DD.\n"
    "- inferred_purpose: short phrase describing what was purchased or billed.\n"
    "- recurring_type: 'ongoing' for subscriptions, utilities, rent, insurance, "
    "or any recurring obligation; 'one_off' for isolated retail purchases.\n"
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
                "description": "Short description of what the receipt is for.",
            },
            "recurring_type": {
                "type": "string",
                "enum": ["ongoing", "one_off"],
                "description": "'ongoing' for subscriptions/utilities/rent, otherwise 'one_off'.",
            },
        },
        "required": ["payee", "amount", "date", "inferred_purpose", "recurring_type"],
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
    def __init__(self, model: str = "claude-3-5-sonnet-20241022") -> None:
        self.model = model
        self.client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    def extract(
        self,
        document: bytes | str,
        *,
        mime_type: Optional[str] = None,
    ) -> ReceiptExtraction:
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

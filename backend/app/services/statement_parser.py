"""LLM-powered bank/credit card statement PDF extraction.

Calls Claude with a structured tool schema and returns a validated
`StatementExtractionResult` Pydantic model.
"""
from __future__ import annotations

import base64
import os
from typing import List

from anthropic import Anthropic
from pydantic import BaseModel


class StatementTransactionExtraction(BaseModel):
    date: str          # YYYY-MM-DD
    payee_raw: str     # exactly as on the statement
    amount: float      # absolute value, no negatives
    is_credit: bool    # True = money IN (refund, deposit, transfer in)


class StatementExtractionResult(BaseModel):
    account_label: str      # e.g. "Chase Sapphire ...5015"
    account_type: str       # "cc" | "bank"
    transactions: List[StatementTransactionExtraction]


SYSTEM_PROMPT = (
    "You are an accounting clerk extracting structured data from bank and credit card statement PDFs.\n"
    "Rules:\n"
    "- Extract ALL line-item transactions as individual records.\n"
    "- date: transaction date in YYYY-MM-DD format. Infer year from statement header if not on line.\n"
    "- payee_raw: exactly as it appears on the statement — do not clean or normalize.\n"
    "- amount: absolute value as a float (no negatives, no currency symbols, no commas).\n"
    "- is_credit: True if money is coming IN (refund, deposit, payment received, transfer in). "
    "False for purchases, fees, or any money going out.\n"
    "- account_label: infer from the statement header (e.g. 'Chase Sapphire Reserve ...5015', "
    "'Chase Total Checking ...8907'). Include the last 4 digits if visible.\n"
    "- account_type: 'cc' for credit cards, 'bank' for checking or savings accounts.\n"
    "- Do NOT skip any transaction. Include payments, fees, refunds, credits, and purchases.\n"
    "- Call the `record_transactions` tool exactly once with the full list."
)

RECORD_TOOL = {
    "name": "record_transactions",
    "description": "Record all extracted transactions from a single bank or credit card statement.",
    "input_schema": {
        "type": "object",
        "properties": {
            "account_label": {
                "type": "string",
                "description": "Account name/label inferred from the statement header, e.g. 'Chase Sapphire Reserve ...5015'.",
            },
            "account_type": {
                "type": "string",
                "enum": ["cc", "bank"],
                "description": "'cc' for credit card, 'bank' for checking/savings.",
            },
            "transactions": {
                "type": "array",
                "description": "All transactions found in the statement.",
                "items": {
                    "type": "object",
                    "properties": {
                        "date": {
                            "type": "string",
                            "description": "Transaction date in YYYY-MM-DD format.",
                        },
                        "payee_raw": {
                            "type": "string",
                            "description": "Payee/description exactly as it appears on the statement.",
                        },
                        "amount": {
                            "type": "number",
                            "description": "Transaction amount as absolute float (no negatives).",
                        },
                        "is_credit": {
                            "type": "boolean",
                            "description": "True if money is coming IN (refund, deposit, transfer in). False for purchases/payments going out.",
                        },
                    },
                    "required": ["date", "payee_raw", "amount", "is_credit"],
                },
            },
        },
        "required": ["account_label", "account_type", "transactions"],
    },
}


class StatementParser:
    def __init__(self, model: str = "claude-sonnet-4-5") -> None:
        self.model = model
        self.client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    def parse(self, pdf_bytes: bytes) -> StatementExtractionResult:
        """Parse a bank or CC statement PDF and return structured transaction data."""
        encoded = base64.standard_b64encode(pdf_bytes).decode("ascii")

        response = self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=[RECORD_TOOL],
            tool_choice={"type": "any"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": encoded,
                            },
                        },
                        {
                            "type": "text",
                            "text": "Extract all transactions from this statement.",
                        },
                    ],
                }
            ],
        )

        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "record_transactions":
                raw = block.input
                transactions = [
                    StatementTransactionExtraction(**t) for t in raw.get("transactions", [])
                ]
                return StatementExtractionResult(
                    account_label=raw["account_label"],
                    account_type=raw["account_type"],
                    transactions=transactions,
                )

        raise RuntimeError("Claude response did not include a record_transactions tool call")

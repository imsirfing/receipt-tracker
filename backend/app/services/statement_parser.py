"""LLM-powered bank/credit card statement PDF extraction.

Calls Claude with a structured tool schema and returns a validated
`StatementExtractionResult` Pydantic model.
"""
from __future__ import annotations

import base64
import csv
import io
import os
import re
from datetime import datetime
from typing import List, Optional

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


def _parse_amount(raw: str) -> Optional[float]:
    """Strip currency symbols/commas and return float, or None if unparseable."""
    cleaned = re.sub(r"[^\d.\-]", "", raw.strip())
    try:
        return abs(float(cleaned)) if cleaned else None
    except ValueError:
        return None


def _parse_date(raw: str) -> Optional[str]:
    """Try common date formats and return YYYY-MM-DD, or None."""
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_csv_statement(
    csv_bytes: bytes,
    filename: str = "",
) -> StatementExtractionResult:
    """Parse Chase (and compatible) CSV exports without needing an LLM.

    Chase CC CSV columns (typical):
        Transaction Date, Post Date, Description, Category, Type, Amount, Memo

    Chase Bank CSV columns (typical):
        Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #

    Amount conventions:
        CC  — negative = purchase (debit), positive = credit/refund
        Bank — positive = deposit (credit), negative = withdrawal (debit)
    """
    text = csv_bytes.decode("utf-8-sig", errors="replace")  # handle BOM
    reader = csv.DictReader(io.StringIO(text))
    headers = [h.strip().lower() for h in (reader.fieldnames or [])]

    # Detect Chase CC vs Chase Bank by column presence
    is_cc = "transaction date" in headers
    is_bank = "posting date" in headers and not is_cc

    # Infer account label from filename (e.g. Chase5015 → ...5015)
    last4_match = re.search(r"(\d{4})", filename)
    last4 = last4_match.group(1) if last4_match else "????"
    if is_bank:
        account_label = f"Chase Checking ...{last4}"
        account_type = "bank"
    else:
        account_label = f"Chase ...{last4}"
        account_type = "cc"

    transactions: List[StatementTransactionExtraction] = []

    for row in reader:
        row_clean = {k.strip().lower(): v.strip() for k, v in row.items() if k}

        if is_cc:
            date_str = _parse_date(row_clean.get("transaction date", ""))
            payee = row_clean.get("description", "").strip()
            raw_amt = row_clean.get("amount", "0")
            try:
                amt_signed = float(re.sub(r"[^\d.\-]", "", raw_amt))
            except ValueError:
                continue
            # Chase CC: negative = purchase, positive = credit
            is_credit = amt_signed > 0
            amount = abs(amt_signed)
        elif is_bank:
            date_str = _parse_date(row_clean.get("posting date", ""))
            payee = row_clean.get("description", "").strip()
            raw_amt = row_clean.get("amount", "0")
            try:
                amt_signed = float(re.sub(r"[^\d.\-]", "", raw_amt))
            except ValueError:
                continue
            # Chase Bank: positive = deposit (credit in), negative = debit/withdrawal
            is_credit = amt_signed > 0
            amount = abs(amt_signed)
        else:
            # Generic fallback: look for date/description/amount columns
            date_str = None
            for col in ("date", "transaction date", "posting date"):
                if col in row_clean:
                    date_str = _parse_date(row_clean[col])
                    break
            payee = ""
            for col in ("description", "payee", "memo", "details"):
                if col in row_clean and row_clean[col]:
                    payee = row_clean[col]
                    break
            raw_amt = ""
            for col in ("amount", "debit", "credit"):
                if col in row_clean and row_clean[col]:
                    raw_amt = row_clean[col]
                    break
            amt = _parse_amount(raw_amt)
            if amt is None:
                continue
            amount = amt
            is_credit = False

        if not date_str or not payee or amount == 0:
            continue

        transactions.append(StatementTransactionExtraction(
            date=date_str,
            payee_raw=payee,
            amount=amount,
            is_credit=is_credit,
        ))

    return StatementExtractionResult(
        account_label=account_label,
        account_type=account_type,
        transactions=transactions,
    )


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

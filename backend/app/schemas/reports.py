"""
Pydantic response schemas for the reports endpoints.

Kept in a separate module so tests can import them without pulling in the
full SQLAlchemy / Firebase / async-DB import chain.
"""
from __future__ import annotations

import uuid
from datetime import date as _Date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict


class ReportSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    total: float
    count: int
    avg: float
    oldest_date: Optional[_Date]
    newest_date: Optional[_Date]


class CategoryStat(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: str
    total: float
    count: int
    pct: float  # percentage of grand total


class MonthStat(BaseModel):
    model_config = ConfigDict(extra="forbid")
    month: str   # "2026-01"
    label: str   # "Jan 2026"
    total: float
    count: int


class ReceiptLine(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    payee: str
    amount: float
    date: _Date
    category_variable: str
    payment_category: Optional[str]
    inferred_purpose: Optional[str]
    notes: Optional[str]
    reimbursement_owner: Optional[str]
    reimbursement_note: Optional[str]
    created_at: datetime


class UnreimbursedReportOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # filter echo-back
    filter_by: Optional[str]
    filter_value: Optional[str]
    date_start: Optional[_Date]
    date_end: Optional[_Date]
    reimbursement_status: Optional[str] = None

    summary: ReportSummary
    by_category: List[CategoryStat]
    by_month: List[MonthStat]
    stacked_by_month: List[Dict[str, Any]]  # [{month: "Jan 2026", Travel: 150, ...}]
    categories: List[str]                    # ordered list of all category names

    # Payment-category drill-down (populated for all requests)
    by_payment_category: List[CategoryStat]
    stacked_by_month_payment: List[Dict[str, Any]]
    payment_categories: List[str]

    receipts: List[ReceiptLine]

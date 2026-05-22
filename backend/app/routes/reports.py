"""
Reports router — unreimbursed expense reporting endpoint.

GET /api/reports/unreimbursed
  Aggregates unreimbursed receipts with optional variable filtering.
  Returns summary stats, by-category breakdown, monthly trend,
  stacked monthly breakdown, and full receipt list.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date as _Date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models.receipt import Receipt

router = APIRouter(prefix="/api/reports", tags=["reports"])


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class ReportSummary(BaseModel):
    total: float
    count: int
    avg: float
    oldest_date: Optional[_Date]
    newest_date: Optional[_Date]


class CategoryStat(BaseModel):
    category: str
    total: float
    count: int
    pct: float  # percentage of grand total


class MonthStat(BaseModel):
    month: str         # "2026-01"
    label: str         # "Jan 2026"
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
    # filter echo-back
    filter_by: Optional[str]
    filter_value: Optional[str]
    date_start: Optional[_Date]
    date_end: Optional[_Date]

    summary: ReportSummary
    by_category: List[CategoryStat]
    by_month: List[MonthStat]
    stacked_by_month: List[Dict[str, Any]]  # [{month: "Jan 2026", Travel: 150, ...}]
    categories: List[str]                   # ordered list of all category names

    # Payment-category drill-down (populated for all requests)
    by_payment_category: List[CategoryStat]
    stacked_by_month_payment: List[Dict[str, Any]]
    payment_categories: List[str]

    receipts: List[ReceiptLine]


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _month_label(month_str: str) -> str:
    """Convert '2026-01' → 'Jan 2026'."""
    try:
        dt = datetime.strptime(month_str, "%Y-%m")
        return dt.strftime("%b %Y")
    except ValueError:
        return month_str


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/unreimbursed", response_model=UnreimbursedReportOut)
async def get_unreimbursed_report(
    # Primary filter variable
    filter_by: Optional[str] = Query(
        None,
        description="Filter dimension: category | payee | reimbursement_owner | payment_category",
    ),
    filter_value: Optional[str] = Query(
        None,
        description="Value for the selected filter_by dimension",
    ),
    # Date range always applies (independent of filter_by)
    date_start: Optional[_Date] = Query(None, description="Inclusive start date (YYYY-MM-DD)"),
    date_end: Optional[_Date] = Query(None, description="Inclusive end date (YYYY-MM-DD)"),
    # Pagination for receipts list only (aggregates always use full result set)
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> UnreimbursedReportOut:

    # --- Base filter: unreimbursed + not deleted ---
    conditions = [
        Receipt.is_reimbursed.is_(False),
        Receipt.deleted_at.is_(None),
    ]

    # Category-scoped access for non-owner users
    if not current_user["is_owner"] and "all" not in current_user["access_categories"]:
        conditions.append(Receipt.category_variable.in_(current_user["access_categories"]))

    # Date range
    if date_start:
        conditions.append(Receipt.date >= date_start)
    if date_end:
        conditions.append(Receipt.date <= date_end)

    # Primary variable filter
    FILTER_FIELD_MAP = {
        "category": Receipt.category_variable,
        "payee": Receipt.payee,
        "reimbursement_owner": Receipt.reimbursement_owner,
        "payment_category": Receipt.payment_category,
    }
    if filter_by and filter_value and filter_by in FILTER_FIELD_MAP:
        field = FILTER_FIELD_MAP[filter_by]
        conditions.append(field == filter_value)

    base_stmt = select(Receipt).where(and_(*conditions))

    # --- Fetch all matching receipts (for aggregations) ---
    all_result = await session.execute(base_stmt.order_by(Receipt.date.desc()))
    all_receipts = all_result.scalars().all()

    if not all_receipts:
        return UnreimbursedReportOut(
            filter_by=filter_by,
            filter_value=filter_value,
            date_start=date_start,
            date_end=date_end,
            summary=ReportSummary(total=0, count=0, avg=0, oldest_date=None, newest_date=None),
            by_category=[],
            by_month=[],
            stacked_by_month=[],
            categories=[],
            by_payment_category=[],
            stacked_by_month_payment=[],
            payment_categories=[],
            receipts=[],
        )

    # --- Summary ---
    grand_total = sum(float(r.amount) for r in all_receipts)
    count = len(all_receipts)
    avg = grand_total / count if count else 0
    dates = [r.date for r in all_receipts]
    oldest = min(dates)
    newest = max(dates)

    # --- By category ---
    cat_totals: Dict[str, float] = defaultdict(float)
    cat_counts: Dict[str, int] = defaultdict(int)
    for r in all_receipts:
        cat = r.category_variable or "Uncategorized"
        cat_totals[cat] += float(r.amount)
        cat_counts[cat] += 1

    by_category = [
        CategoryStat(
            category=cat,
            total=round(cat_totals[cat], 2),
            count=cat_counts[cat],
            pct=round((cat_totals[cat] / grand_total) * 100, 1) if grand_total else 0,
        )
        for cat in sorted(cat_totals, key=lambda c: cat_totals[c], reverse=True)
    ]
    categories = [s.category for s in by_category]

    # --- By month ---
    month_totals: Dict[str, float] = defaultdict(float)
    month_counts: Dict[str, int] = defaultdict(int)
    for r in all_receipts:
        month_key = r.date.strftime("%Y-%m")
        month_totals[month_key] += float(r.amount)
        month_counts[month_key] += 1

    by_month = [
        MonthStat(
            month=m,
            label=_month_label(m),
            total=round(month_totals[m], 2),
            count=month_counts[m],
        )
        for m in sorted(month_totals)
    ]

    # --- Stacked by month (category × month matrix for stacked bar chart) ---
    # Shape: [{ "month": "Jan 2026", "Travel": 150.00, "Meals": 80.00 }, ...]
    # Key by ISO month string for correct chronological sort, convert to label for display.
    stacked_map: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in all_receipts:
        iso_month = r.date.strftime("%Y-%m")
        cat = r.category_variable or "Uncategorized"
        stacked_map[iso_month][cat] += float(r.amount)

    stacked_by_month = []
    for iso_m in sorted(stacked_map):  # sorts chronologically as ISO strings
        row: Dict[str, Any] = {"month": _month_label(iso_m)}
        for cat in categories:
            row[cat] = round(stacked_map[iso_m].get(cat, 0), 2)
        stacked_by_month.append(row)

    # --- By payment_category ---
    _UNASSIGNED = "Unassigned"
    pay_totals: Dict[str, float] = defaultdict(float)
    pay_counts: Dict[str, int] = defaultdict(int)
    for r in all_receipts:
        pcat = r.payment_category or _UNASSIGNED
        pay_totals[pcat] += float(r.amount)
        pay_counts[pcat] += 1

    by_payment_category = [
        CategoryStat(
            category=pcat,
            total=round(pay_totals[pcat], 2),
            count=pay_counts[pcat],
            pct=round((pay_totals[pcat] / grand_total) * 100, 1) if grand_total else 0,
        )
        for pcat in sorted(pay_totals, key=lambda c: pay_totals[c], reverse=True)
    ]
    payment_categories = [s.category for s in by_payment_category]

    # --- Stacked by month × payment_category ---
    pay_stacked_map: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in all_receipts:
        iso_month = r.date.strftime("%Y-%m")
        pcat = r.payment_category or _UNASSIGNED
        pay_stacked_map[iso_month][pcat] += float(r.amount)

    stacked_by_month_payment = []
    for iso_m in sorted(pay_stacked_map):
        row_p: Dict[str, Any] = {"month": _month_label(iso_m)}
        for pcat in payment_categories:
            row_p[pcat] = round(pay_stacked_map[iso_m].get(pcat, 0), 2)
        stacked_by_month_payment.append(row_p)

    # --- Paginated receipt list ---
    paginated = all_receipts[offset: offset + limit]
    receipt_lines = [
        ReceiptLine(
            id=r.id,
            payee=r.payee,
            amount=float(r.amount),
            date=r.date,
            category_variable=r.category_variable,
            payment_category=r.payment_category,
            inferred_purpose=r.inferred_purpose,
            notes=r.notes,
            reimbursement_owner=r.reimbursement_owner,
            reimbursement_note=getattr(r, "reimbursement_note", None),
            created_at=r.created_at,
        )
        for r in paginated
    ]

    return UnreimbursedReportOut(
        filter_by=filter_by,
        filter_value=filter_value,
        date_start=date_start,
        date_end=date_end,
        summary=ReportSummary(
            total=round(grand_total, 2),
            count=count,
            avg=round(avg, 2),
            oldest_date=oldest,
            newest_date=newest,
        ),
        by_category=by_category,
        by_month=by_month,
        stacked_by_month=stacked_by_month,
        categories=categories,
        by_payment_category=by_payment_category,
        stacked_by_month_payment=stacked_by_month_payment,
        payment_categories=payment_categories,
        receipts=receipt_lines,
    )

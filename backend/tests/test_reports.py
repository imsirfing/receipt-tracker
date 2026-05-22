"""
Tests for /api/reports/unreimbursed endpoint and response model contract.

Split into two tiers:
  - unit:       No DB needed. Tests Pydantic schema contracts and pure logic.
  - integration: Mocked DB + auth. Tests the full FastAPI endpoint.

Run all:           pytest tests/test_reports.py -v
Run unit only:     pytest tests/test_reports.py -v -m unit
Run integration:   pytest tests/test_reports.py -v -m integration
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


# ── Unit tests: schema contract ───────────────────────────────────────────────

@pytest.mark.unit
def test_unreimbursed_report_out_declares_all_fields():
    """
    UnreimbursedReportOut must declare every field we return.
    This is the test that would have caught today's bug immediately —
    fields computed but not declared in the model are silently dropped by Pydantic.
    """
    from app.routes.reports import UnreimbursedReportOut

    required = [
        # Core
        "summary", "receipts",
        # Category-level
        "by_category", "stacked_by_month", "categories", "by_month",
        # Payment-type drill-down (these were missing and caused today's outage)
        "by_payment_category", "stacked_by_month_payment", "payment_categories",
        # Filter echo-back
        "filter_by", "filter_value", "date_start", "date_end",
    ]
    declared = set(UnreimbursedReportOut.model_fields.keys())
    missing = [f for f in required if f not in declared]
    assert not missing, (
        f"UnreimbursedReportOut is missing fields: {missing}\n"
        "Add them to the Pydantic model — Pydantic silently drops undeclared "
        "fields from constructor calls, which breaks both the JSON response "
        "and any server-side access (e.g. PDF builder)."
    )


@pytest.mark.unit
def test_response_models_forbid_extra():
    """
    All response models must have extra='forbid' so unexpected fields raise
    a ValidationError instead of being silently dropped.
    """
    from app.routes.reports import (
        CategoryStat,
        MonthStat,
        ReportSummary,
        UnreimbursedReportOut,
    )
    for model in (ReportSummary, CategoryStat, MonthStat, UnreimbursedReportOut):
        cfg = model.model_config
        assert cfg.get("extra") == "forbid", (
            f"{model.__name__}.model_config must set extra='forbid'. "
            "Without this, undeclared fields are silently dropped."
        )


@pytest.mark.unit
def test_unreimbursed_report_out_round_trips():
    """UnreimbursedReportOut can be instantiated and serialised with all fields."""
    from app.routes.reports import (
        CategoryStat,
        MonthStat,
        ReceiptLine,
        ReportSummary,
        UnreimbursedReportOut,
    )

    report = UnreimbursedReportOut(
        filter_by="category",
        filter_value="edgehill",
        date_start=None,
        date_end=None,
        summary=ReportSummary(
            total=225.50,
            count=2,
            avg=112.75,
            oldest_date=date(2026, 1, 10),
            newest_date=date(2026, 2, 5),
        ),
        by_category=[
            CategoryStat(category="edgehill", total=225.50, count=2, pct=100.0)
        ],
        by_month=[
            MonthStat(month="2026-01", label="Jan 2026", total=150.0, count=1),
            MonthStat(month="2026-02", label="Feb 2026", total=75.5, count=1),
        ],
        stacked_by_month=[{"month": "Jan 2026", "edgehill": 150.0}],
        categories=["edgehill"],
        by_payment_category=[
            CategoryStat(category="Amex", total=150.0, count=1, pct=66.7),
            CategoryStat(category="Chase", total=75.5, count=1, pct=33.3),
        ],
        stacked_by_month_payment=[
            {"month": "Jan 2026", "Amex": 150.0},
            {"month": "Feb 2026", "Chase": 75.5},
        ],
        payment_categories=["Amex", "Chase"],
        receipts=[],
    )

    data = report.model_dump()
    assert data["summary"]["total"] == 225.50
    assert data["summary"]["count"] == 2
    assert len(data["by_payment_category"]) == 2
    assert data["by_payment_category"][0]["category"] == "Amex"
    assert data["payment_categories"] == ["Amex", "Chase"]
    assert len(data["stacked_by_month_payment"]) == 2


# ── Integration tests: full endpoint with mocked DB + auth ───────────────────

@pytest.fixture
def app_with_overrides(mock_db_session):
    """FastAPI app with auth and DB dependencies replaced by test doubles."""
    from app.auth import get_current_user
    from app.db import get_session
    from app.main import app

    async def _fake_auth():
        return {"uid": "test-uid-123", "email": "test@example.com", "role": "owner"}

    async def _fake_session():
        yield mock_db_session

    app.dependency_overrides[get_current_user] = _fake_auth
    app.dependency_overrides[get_session] = _fake_session

    yield app

    app.dependency_overrides.clear()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_reports_endpoint_returns_200(app_with_overrides):
    """GET /api/reports/unreimbursed returns HTTP 200."""
    async with AsyncClient(
        transport=ASGITransport(app=app_with_overrides), base_url="http://test"
    ) as client:
        r = await client.get("/api/reports/unreimbursed")
    assert r.status_code == 200, r.text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_reports_endpoint_all_fields_present(app_with_overrides):
    """
    Response JSON must contain all UnreimbursedReportOut fields.
    Regression test for the 'fields declared but not in model' class of bug.
    """
    async with AsyncClient(
        transport=ASGITransport(app=app_with_overrides), base_url="http://test"
    ) as client:
        r = await client.get("/api/reports/unreimbursed")

    assert r.status_code == 200
    data = r.json()

    required_fields = [
        "summary", "by_category", "by_month", "stacked_by_month", "categories",
        "by_payment_category", "stacked_by_month_payment", "payment_categories",
        "receipts",
    ]
    missing = [f for f in required_fields if f not in data]
    assert not missing, f"API response missing fields: {missing}"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_reports_endpoint_summary_totals(app_with_overrides, sample_receipts):
    """Summary totals must match the synthetic receipt data (150.00 + 75.50 = 225.50)."""
    async with AsyncClient(
        transport=ASGITransport(app=app_with_overrides), base_url="http://test"
    ) as client:
        r = await client.get("/api/reports/unreimbursed")

    assert r.status_code == 200
    s = r.json()["summary"]
    assert s["count"] == len(sample_receipts)
    assert abs(s["total"] - 225.50) < 0.01
    assert abs(s["avg"] - 112.75) < 0.01


@pytest.mark.integration
@pytest.mark.asyncio
async def test_reports_endpoint_payment_categories_populated(app_with_overrides):
    """by_payment_category and payment_categories must be non-empty lists."""
    async with AsyncClient(
        transport=ASGITransport(app=app_with_overrides), base_url="http://test"
    ) as client:
        r = await client.get("/api/reports/unreimbursed")

    assert r.status_code == 200
    data = r.json()
    assert isinstance(data["by_payment_category"], list)
    assert isinstance(data["payment_categories"], list)
    assert len(data["by_payment_category"]) > 0, "by_payment_category should not be empty"
    assert len(data["payment_categories"]) > 0, "payment_categories should not be empty"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_reports_endpoint_filter_by_category(app_with_overrides, mock_db_session, sample_receipts):
    """filter_by=category&filter_value=personal returns only personal receipts."""
    # Return only the personal receipt
    personal_only = [r for r in sample_receipts if r.category_variable == "personal"]
    result = MagicMock()
    result.scalars.return_value.all.return_value = personal_only
    mock_db_session.execute.return_value = result

    async with AsyncClient(
        transport=ASGITransport(app=app_with_overrides), base_url="http://test"
    ) as client:
        r = await client.get("/api/reports/unreimbursed?filter_by=category&filter_value=personal")

    assert r.status_code == 200
    data = r.json()
    assert data["summary"]["count"] == 1
    assert abs(data["summary"]["total"] - 150.00) < 0.01
    assert data["filter_by"] == "category"
    assert data["filter_value"] == "personal"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_reports_endpoint_empty_returns_zero_summary(app_with_overrides, mock_db_session):
    """When no receipts match, summary fields should be zero/null."""
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    mock_db_session.execute.return_value = result

    async with AsyncClient(
        transport=ASGITransport(app=app_with_overrides), base_url="http://test"
    ) as client:
        r = await client.get("/api/reports/unreimbursed")

    assert r.status_code == 200
    data = r.json()
    assert data["summary"]["count"] == 0
    assert data["summary"]["total"] == 0
    assert data["by_category"] == []
    assert data["by_payment_category"] == []
    assert data["payment_categories"] == []

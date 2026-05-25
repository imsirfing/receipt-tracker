"""
Tests for /api/receipts endpoints.

Tiers:
  unit:        Schema contract checks — no DB, no HTTP.
  integration: Mocked DB + auth, full FastAPI endpoint round-trips.

Run all:        pytest tests/test_receipts.py -v
Run unit only:  pytest tests/test_receipts.py -v -m unit
Run integration: pytest tests/test_receipts.py -v -m integration
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_receipt_orm_mock(**overrides) -> MagicMock:
    """Return a MagicMock that looks like a Receipt ORM row."""
    defaults = dict(
        id=str(uuid.uuid4()),
        payee="Test Vendor",
        amount=Decimal("99.99"),
        date=date(2026, 3, 1),
        category_variable="personal",
        payment_category="Amex",
        payment_detail="card ending 1234",
        recurring_type="one_off",
        inferred_purpose="Test purchase",
        notes=None,
        is_tax_deductible=False,
        reimbursement_owner="james",
        is_reimbursed=False,
        reimbursed_at=None,
        reimbursed_by=None,
        reimbursement_note=None,
        reimbursement_status="none",
        raw_email_id=f"manual-{uuid.uuid4()}",
        source="manual",
        ingested_at=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        deleted_at=None,
        attachments=[],
        canonical_payee=None,
    )
    defaults.update(overrides)
    r = MagicMock()
    for k, v in defaults.items():
        setattr(r, k, v)
    # model_validate needs to call to_audit_dict or similar — stub it
    r.to_audit_dict.return_value = {}
    return r


WRITE_USER = {
    "uid": "james",
    "email": "james@test.com",
    "role": "write",
    "is_owner": True,
    "access_categories": ["all"],
}

READ_USER = {
    "uid": "viewer",
    "email": "viewer@test.com",
    "role": "read",
    "is_owner": False,
    "access_categories": ["personal"],
}


@pytest.fixture
def write_user():
    return WRITE_USER


@pytest.fixture
def read_user():
    return READ_USER


@pytest.fixture
def single_receipt():
    return make_receipt_orm_mock()


@pytest.fixture
def mock_db_session_receipts(single_receipt):
    """Session mock configured for list queries returning a single receipt."""
    session = AsyncMock()

    # list query: scalars().all()
    list_result = MagicMock()
    list_result.scalars.return_value.all.return_value = [single_receipt]

    # count query
    count_result = MagicMock()
    count_result.scalar.return_value = 1

    # single-item query: scalar_one_or_none()
    single_result = MagicMock()
    single_result.scalar_one_or_none.return_value = single_receipt
    single_result.scalars.return_value.all.return_value = [single_receipt]

    # Return count_result first (for list endpoint), then single_result for others
    session.execute.side_effect = [count_result, list_result]

    return session, single_receipt


@pytest.fixture
def app_with_overrides(mock_db_session_receipts, write_user):
    """FastAPI app with DB and auth overridden for testing."""
    from app.main import app
    from app.auth import get_current_user
    from app.db import get_session

    session, _ = mock_db_session_receipts

    async def _override_get_session():
        yield session

    async def _override_get_user():
        return write_user

    app.dependency_overrides[get_session] = _override_get_session
    app.dependency_overrides[get_current_user] = _override_get_user

    yield app, session

    app.dependency_overrides.clear()


def _override_user(app, user_dict):
    """Helper: swap the current_user override mid-test."""
    from app.auth import get_current_user

    async def _get_user():
        return user_dict

    app.dependency_overrides[get_current_user] = _get_user


def _reset_session_execute(session, *results):
    """Set session.execute side_effect to the given sequence of results."""
    session.execute.side_effect = list(results)


# ── Unit tests: schema contracts ──────────────────────────────────────────────

@pytest.mark.unit
def test_receipt_out_includes_reimbursement_status():
    from app.schemas.receipts import ReceiptOut
    assert "reimbursement_status" in ReceiptOut.model_fields


@pytest.mark.unit
def test_receipt_out_reimbursement_status_default():
    from app.schemas.receipts import ReceiptOut
    field = ReceiptOut.model_fields["reimbursement_status"]
    # Pydantic stores default in field.default
    assert field.default == "none"


@pytest.mark.unit
def test_receipt_update_has_reimbursement_status():
    from app.schemas.receipts import ReceiptUpdate
    assert "reimbursement_status" in ReceiptUpdate.model_fields


@pytest.mark.unit
def test_bulk_set_reimbursement_status_request_schema():
    from app.schemas.receipts import BulkSetReimbursementStatusRequest
    req = BulkSetReimbursementStatusRequest(ids=[], status="pending")
    assert req.status == "pending"
    assert req.ids == []


# ── Integration: GET /api/receipts ────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.asyncio
async def test_list_receipts_returns_200(app_with_overrides):
    app, session = app_with_overrides
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/receipts")
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data


@pytest.mark.integration
@pytest.mark.asyncio
async def test_list_receipts_reimbursement_status_in_response(app_with_overrides):
    """Every receipt item in the list response must include reimbursement_status."""
    app, session = app_with_overrides
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/receipts")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) > 0
    for item in items:
        assert "reimbursement_status" in item, f"reimbursement_status missing from item: {item}"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_list_receipts_read_user_allowed(app_with_overrides, read_user):
    """Read-only users can still list receipts in their categories."""
    app, session = app_with_overrides
    _override_user(app, read_user)

    # Re-set session side_effect for list query
    count_result = MagicMock()
    count_result.scalar.return_value = 0
    list_result = MagicMock()
    list_result.scalars.return_value.all.return_value = []
    session.execute.side_effect = [count_result, list_result]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/receipts")
    assert r.status_code == 200


# ── Integration: POST /api/receipts/{id}/reimburse ───────────────────────────

@pytest.mark.integration
@pytest.mark.asyncio
async def test_reimburse_sets_is_reimbursed_and_status(app_with_overrides):
    """Calling /reimburse must flip is_reimbursed=True and reimbursement_status='reimbursed'."""
    app, session = app_with_overrides

    receipt = make_receipt_orm_mock(is_reimbursed=False, reimbursement_status="none")
    single_result = MagicMock()
    single_result.scalar_one_or_none.return_value = receipt
    session.execute.side_effect = [single_result]

    receipt_id = receipt.id
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(f"/api/receipts/{receipt_id}/reimburse")

    assert r.status_code == 200
    assert receipt.is_reimbursed is True
    assert receipt.reimbursement_status == "reimbursed"
    assert receipt.reimbursed_at is not None
    session.commit.assert_awaited_once()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_reimburse_forbidden_for_read_user(app_with_overrides, read_user):
    app, session = app_with_overrides
    _override_user(app, read_user)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(f"/api/receipts/{uuid.uuid4()}/reimburse")
    assert r.status_code == 403


# ── Integration: POST /api/receipts/bulk-reimburse ───────────────────────────

@pytest.mark.integration
@pytest.mark.asyncio
async def test_bulk_reimburse_updates_count(app_with_overrides):
    app, session = app_with_overrides

    r1 = make_receipt_orm_mock(id=str(uuid.uuid4()), is_reimbursed=False, reimbursement_status="none")
    r2 = make_receipt_orm_mock(id=str(uuid.uuid4()), is_reimbursed=False, reimbursement_status="none")
    bulk_result = MagicMock()
    bulk_result.scalars.return_value.all.return_value = [r1, r2]
    session.execute.side_effect = [bulk_result]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/receipts/bulk-reimburse", json={"ids": [r1.id, r2.id]})

    assert r.status_code == 200
    assert r.json()["updated"] == 2


@pytest.mark.integration
@pytest.mark.asyncio
async def test_bulk_reimburse_syncs_reimbursement_status(app_with_overrides):
    """bulk-reimburse must set reimbursement_status='reimbursed' on each receipt."""
    app, session = app_with_overrides

    receipt = make_receipt_orm_mock(is_reimbursed=False, reimbursement_status="none")
    bulk_result = MagicMock()
    bulk_result.scalars.return_value.all.return_value = [receipt]
    session.execute.side_effect = [bulk_result]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/receipts/bulk-reimburse", json={"ids": [receipt.id]})

    assert receipt.reimbursement_status == "reimbursed"
    assert receipt.is_reimbursed is True


@pytest.mark.integration
@pytest.mark.asyncio
async def test_bulk_reimburse_forbidden_for_read_user(app_with_overrides, read_user):
    app, session = app_with_overrides
    _override_user(app, read_user)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/receipts/bulk-reimburse", json={"ids": [str(uuid.uuid4())]})
    assert r.status_code == 403


@pytest.mark.integration
@pytest.mark.asyncio
async def test_bulk_reimburse_empty_ids_returns_zero(app_with_overrides):
    app, session = app_with_overrides
    session.execute.side_effect = []  # should not be called

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/receipts/bulk-reimburse", json={"ids": []})

    assert r.status_code == 200
    assert r.json()["updated"] == 0


# ── Integration: POST /api/receipts/bulk-set-reimbursement-status ─────────────

@pytest.mark.integration
@pytest.mark.asyncio
async def test_bulk_set_status_pending(app_with_overrides):
    """Setting status=pending should set reimbursement_status='pending' and is_reimbursed=False."""
    app, session = app_with_overrides

    receipt = make_receipt_orm_mock(is_reimbursed=False, reimbursement_status="none")
    result = MagicMock()
    result.scalars.return_value.all.return_value = [receipt]
    session.execute.side_effect = [result]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/api/receipts/bulk-set-reimbursement-status",
            json={"ids": [receipt.id], "status": "pending"},
        )

    assert r.status_code == 200
    assert r.json()["updated"] == 1
    assert receipt.reimbursement_status == "pending"
    assert receipt.is_reimbursed is False


@pytest.mark.integration
@pytest.mark.asyncio
async def test_bulk_set_status_reimbursed(app_with_overrides):
    """Setting status=reimbursed should set is_reimbursed=True and reimbursement_status='reimbursed'."""
    app, session = app_with_overrides

    receipt = make_receipt_orm_mock(is_reimbursed=False, reimbursement_status="pending")
    result = MagicMock()
    result.scalars.return_value.all.return_value = [receipt]
    session.execute.side_effect = [result]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/api/receipts/bulk-set-reimbursement-status",
            json={"ids": [receipt.id], "status": "reimbursed"},
        )

    assert r.status_code == 200
    assert receipt.reimbursement_status == "reimbursed"
    assert receipt.is_reimbursed is True


@pytest.mark.integration
@pytest.mark.asyncio
async def test_bulk_set_status_none(app_with_overrides):
    """Setting status=none should clear is_reimbursed and reimbursed_at."""
    app, session = app_with_overrides

    receipt = make_receipt_orm_mock(
        is_reimbursed=True,
        reimbursement_status="reimbursed",
        reimbursed_at=datetime.now(timezone.utc),
    )
    result = MagicMock()
    result.scalars.return_value.all.return_value = [receipt]
    session.execute.side_effect = [result]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/api/receipts/bulk-set-reimbursement-status",
            json={"ids": [receipt.id], "status": "none"},
        )

    assert r.status_code == 200
    assert receipt.reimbursement_status == "none"
    assert receipt.is_reimbursed is False
    assert receipt.reimbursed_at is None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_bulk_set_status_invalid_status_returns_400(app_with_overrides):
    app, session = app_with_overrides
    session.execute.side_effect = []  # should not reach DB

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/api/receipts/bulk-set-reimbursement-status",
            json={"ids": [str(uuid.uuid4())], "status": "bogus"},
        )
    assert r.status_code == 400


@pytest.mark.integration
@pytest.mark.asyncio
async def test_bulk_set_status_forbidden_for_read_user(app_with_overrides, read_user):
    app, session = app_with_overrides
    _override_user(app, read_user)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/api/receipts/bulk-set-reimbursement-status",
            json={"ids": [str(uuid.uuid4())], "status": "pending"},
        )
    assert r.status_code == 403


@pytest.mark.integration
@pytest.mark.asyncio
async def test_bulk_set_status_empty_ids_returns_zero(app_with_overrides):
    app, session = app_with_overrides
    session.execute.side_effect = []

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/api/receipts/bulk-set-reimbursement-status",
            json={"ids": [], "status": "pending"},
        )

    assert r.status_code == 200
    assert r.json()["updated"] == 0

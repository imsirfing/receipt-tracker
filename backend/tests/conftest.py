"""
Shared pytest fixtures for receipt-tracker backend tests.

The app's db.py creates a SQLAlchemy engine at module-import time, so we
inject a mock into sys.modules BEFORE any app code is imported. This lets
unit tests run without a real database or any extra drivers (aiosqlite etc.).
"""
from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

# ── Environment stubs (must be set before app modules are imported) ────────────
os.environ.setdefault("ENVIRONMENT", "local")
os.environ.setdefault("FIREBASE_PROJECT_ID", "mock-receipts-project")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://mock:mock@localhost/mock")
os.environ.setdefault("GMAIL_CLIENT_ID", "mock-client-id")
os.environ.setdefault("GMAIL_CLIENT_SECRET", "mock-client-secret")
os.environ.setdefault("GMAIL_REFRESH_TOKEN", "mock-refresh-token")

# ── Stub app.db before SQLAlchemy tries to create a real engine ───────────────
if "app.db" not in sys.modules:
    _mock_db_module = MagicMock()

    async def _stub_get_session():  # matches the real generator signature
        yield MagicMock()

    _mock_db_module.get_session = _stub_get_session
    sys.modules["app.db"] = _mock_db_module

# ── Stub firebase_admin so it doesn't call GCP ────────────────────────────────
if "firebase_admin" not in sys.modules:
    _fa = MagicMock()
    _fa._apps = {"default": MagicMock()}          # pretend already initialized
    sys.modules["firebase_admin"] = _fa
    sys.modules["firebase_admin.auth"] = MagicMock()
    sys.modules["firebase_admin.credentials"] = MagicMock()


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_mock_receipt(**overrides) -> MagicMock:
    """Return a MagicMock that looks like a Receipt ORM row."""
    defaults = dict(
        id="00000000-0000-0000-0000-000000000001",
        payee="Acme Corp",
        amount=Decimal("123.45"),
        date=date(2026, 3, 15),
        category_variable="personal",
        payment_category="Amex",
        reimbursement_owner="james",
        inferred_purpose="Office supplies",
        notes=None,
        is_reimbursed=False,
        reimbursed_by=None,
        reimbursement_note=None,
        reimbursement_status="none",
    )
    defaults.update(overrides)
    r = MagicMock()
    for k, v in defaults.items():
        setattr(r, k, v)
    return r


@pytest.fixture
def sample_receipts():
    """Two synthetic unreimbursed receipts across different categories/months."""
    return [
        make_mock_receipt(
            id="00000000-0000-0000-0000-000000000002",
            payee="Vendor A",
            amount=Decimal("150.00"),
            date=date(2026, 1, 10),
            category_variable="personal",
            payment_category="Amex",
        ),
        make_mock_receipt(
            id="00000000-0000-0000-0000-000000000003",
            payee="Vendor B",
            amount=Decimal("75.50"),
            date=date(2026, 2, 5),
            category_variable="edgehill",
            payment_category="Chase",
        ),
    ]


@pytest.fixture
def mock_db_session(sample_receipts):
    """AsyncSession mock that returns sample_receipts on execute()."""
    session = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = sample_receipts
    session.execute.return_value = result
    return session

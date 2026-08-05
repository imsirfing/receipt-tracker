"""Duplicate receipt detection.

Compares receipts by invoice_number, amount+payee+date proximity, or amount+payee
and inserts ``DuplicateCandidate`` rows for newly-found pairs.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.receipt import DuplicateCandidate, Receipt

logger = logging.getLogger(__name__)


async def scan_for_duplicates(
    db: AsyncSession,
    receipt_id: Optional[UUID] = None,
) -> int:
    """Scan for duplicate receipt pairs and insert new ``DuplicateCandidate`` rows.

    Args:
        db: Async SQLAlchemy session.
        receipt_id: If provided, only compares that receipt against candidates.
                    If omitted, does a full cross-scan across all non-deleted receipts.

    Returns:
        Number of new ``DuplicateCandidate`` rows created.
    """
    new_count = 0

    if receipt_id is not None:
        # Targeted scan: load the specific receipt and compare against recent ones.
        result = await db.execute(
            select(Receipt).where(
                Receipt.id == receipt_id,
                Receipt.deleted_at.is_(None),
            )
        )
        anchor = result.scalar_one_or_none()
        if anchor is None:
            return 0

        cutoff = datetime.now(timezone.utc).date() - timedelta(days=90)
        candidates_result = await db.execute(
            select(Receipt).where(
                Receipt.id != receipt_id,
                Receipt.deleted_at.is_(None),
                Receipt.category_variable == anchor.category_variable,
                Receipt.date >= cutoff,
            )
        )
        others = candidates_result.scalars().all()
        anchors = [(anchor, others)]
    else:
        # Full scan: load all non-deleted receipts and compare every pair.
        result = await db.execute(
            select(Receipt).where(Receipt.deleted_at.is_(None))
        )
        all_receipts = result.scalars().all()
        anchors = []
        for i, r in enumerate(all_receipts):
            anchors.append((r, all_receipts[i + 1 :]))

    for anchor, others in anchors:
        for other in others:
            match_reason, confidence = _classify_pair(anchor, other)
            if match_reason is None:
                continue

            # Skip pairs that already have a candidate (any status).
            existing = await db.execute(
                select(DuplicateCandidate).where(
                    or_(
                        and_(
                            DuplicateCandidate.receipt_id_a == anchor.id,
                            DuplicateCandidate.receipt_id_b == other.id,
                        ),
                        and_(
                            DuplicateCandidate.receipt_id_a == other.id,
                            DuplicateCandidate.receipt_id_b == anchor.id,
                        ),
                    )
                )
            )
            if existing.scalar_one_or_none() is not None:
                continue

            db.add(
                DuplicateCandidate(
                    receipt_id_a=anchor.id,
                    receipt_id_b=other.id,
                    match_reason=match_reason,
                    confidence=confidence,
                    status="pending_review",
                    created_at=datetime.now(timezone.utc),
                )
            )
            new_count += 1

    # Retro-fix: dismiss any existing medium-confidence amount_payee_date
    # candidates where both receipts are recurring and dates are 8-30 days apart.
    # These are back-to-back monthly charges, not duplicates.
    stale = await db.execute(
        select(DuplicateCandidate).where(
            DuplicateCandidate.match_reason == "amount_payee_date",
            DuplicateCandidate.confidence == "medium",
            DuplicateCandidate.status == "pending_review",
        )
    )
    dismissed_count = 0
    for cand in stale.scalars().all():
        ra_result = await db.execute(select(Receipt).where(Receipt.id == cand.receipt_id_a))
        rb_result = await db.execute(select(Receipt).where(Receipt.id == cand.receipt_id_b))
        ra = ra_result.scalar_one_or_none()
        rb = rb_result.scalar_one_or_none()
        if ra is None or rb is None:
            continue
        if (
            getattr(ra, "recurring_type", None) == "ongoing"
            and getattr(rb, "recurring_type", None) == "ongoing"
            and 7 < _date_delta(ra, rb) <= 30
        ):
            cand.status = "dismissed"
            cand.notes = "auto-dismissed: recurring monthly charges are not duplicates"
            cand.reviewed_at = datetime.now(timezone.utc)
            dismissed_count += 1

    if new_count or dismissed_count:
        await db.commit()
        logger.info(
            "duplicate_scanner: created %d new candidate(s), auto-dismissed %d recurring false positives",
            new_count, dismissed_count,
        )

    return new_count


# ---------------------------------------------------------------------------
# Pair classification
# ---------------------------------------------------------------------------

def _normalize_amount(amount: float) -> int:
    """Convert float dollars to integer cents to avoid float equality issues."""
    return round(amount * 100)


def _date_delta(a: Receipt, b: Receipt) -> int:
    """Return absolute day difference between two receipts."""
    try:
        da = a.date if isinstance(a.date, __import__("datetime").date) else __import__("datetime").date.fromisoformat(str(a.date))
        db_ = b.date if isinstance(b.date, __import__("datetime").date) else __import__("datetime").date.fromisoformat(str(b.date))
        return abs((da - db_).days)
    except Exception:
        return 999


def _classify_pair(
    a: Receipt, b: Receipt
) -> tuple[Optional[str], Optional[str]]:
    """Return (match_reason, confidence) or (None, None) if no match."""

    # ── Invoice-number match ────────────────────────────────────────────────
    inv_a = (a.invoice_number or "").strip()
    inv_b = (b.invoice_number or "").strip()
    if inv_a and inv_b and inv_a.lower() == inv_b.lower():
        payee_a = (a.canonical_payee or a.payee or "").lower()
        payee_b = (b.canonical_payee or b.payee or "").lower()
        if payee_a and payee_b and payee_a == payee_b:
            return "invoice_number", "high"
        return "invoice_number", "medium"

    # ── Amount + payee + date window ────────────────────────────────────────
    if _normalize_amount(a.amount) == _normalize_amount(b.amount):
        canonical_a = (a.canonical_payee or "").strip().lower()
        canonical_b = (b.canonical_payee or "").strip().lower()
        raw_a = (a.payee or "").strip().lower()
        raw_b = (b.payee or "").strip().lower()
        days = _date_delta(a, b)

        # Same canonical payee
        if canonical_a and canonical_b and canonical_a == canonical_b:
            both_recurring = (
                getattr(a, "recurring_type", None) == "ongoing"
                and getattr(b, "recurring_type", None) == "ongoing"
            )
            if days <= 7:
                return "amount_payee_date", "high"
            # Skip the 30-day medium band for recurring charges — back-to-back
            # monthly payments are expected, not duplicates.
            if days <= 30 and not both_recurring:
                return "amount_payee_date", "medium"

        # Same raw (non-canonical) payee within 7 days
        if raw_a and raw_b and raw_a == raw_b and days <= 7:
            return "amount_payee", "low"

    return None, None

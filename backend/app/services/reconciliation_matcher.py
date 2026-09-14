"""Reconciliation matching engine.

Pairs receipts against statement transactions using amount, date, and fuzzy
payee similarity. Creates ReconciliationMatch rows for matched, unmatched
receipts, and unmatched statement charges.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from app.models.receipt import (
    Receipt,
    ReconciliationMatch,
    ReconciliationSession,
    StatementTransaction,
)


# ── Fuzzy helpers ────────────────────────────────────────────────────────────

_PUNCT_RE = re.compile(r"[^\w\s]")


def _normalize(text: str) -> Set[str]:
    """Lowercase, strip punctuation, split into words."""
    cleaned = _PUNCT_RE.sub(" ", text.lower())
    return set(cleaned.split())


def _jaccard(a: str, b: str) -> float:
    """Jaccard similarity of word sets."""
    wa = _normalize(a)
    wb = _normalize(b)
    if not wa or not wb:
        return 0.0
    intersection = wa & wb
    union = wa | wb
    return len(intersection) / len(union)


# ── Confidence tiers ─────────────────────────────────────────────────────────

def _confidence(
    receipt: Receipt,
    txn: StatementTransaction,
) -> Optional[str]:
    """
    Return confidence string or None if no match.
    - high:   amount within $0.01, date within 3 days, payee Jaccard > 0.6
    - medium: amount within $0.01, date within 7 days
    - low:    amount within $5.00, date within 5 days, payee Jaccard > 0.5
    """
    r_amount = float(receipt.amount)
    t_amount = float(txn.amount)
    date_delta = abs((receipt.date - txn.date).days)
    amount_delta = abs(r_amount - t_amount)
    payee_sim = _jaccard(receipt.payee, txn.payee_raw)

    if amount_delta <= 0.01 and date_delta <= 3 and payee_sim > 0.6:
        return "high"
    if amount_delta <= 0.01 and date_delta <= 7:
        return "medium"
    if amount_delta <= 5.00 and date_delta <= 5 and payee_sim > 0.5:
        return "low"
    return None


_CONFIDENCE_RANK: Dict[Optional[str], int] = {
    "high": 3,
    "medium": 2,
    "low": 1,
    None: 0,
}


# ── Main entry point ─────────────────────────────────────────────────────────

def run_matching(session_id: uuid.UUID, db: Session) -> List[ReconciliationMatch]:
    """
    Run greedy matching for a reconciliation session.

    1. Load receipts for the session's category/date range.
    2. Load statement transactions (non-excluded, non-credit).
    3. Delete existing matches for this session (re-run safe).
    4. Greedy best-confidence matching.
    5. Persist and return all ReconciliationMatch rows.
    """
    # ── Load session ─────────────────────────────────────────────────────────
    recon_session = db.execute(
        select(ReconciliationSession).where(ReconciliationSession.id == session_id)
    ).scalar_one_or_none()
    if recon_session is None:
        raise ValueError(f"ReconciliationSession {session_id} not found")

    # ── Load receipts ─────────────────────────────────────────────────────────
    receipts: List[Receipt] = list(
        db.execute(
            select(Receipt).where(
                Receipt.category_variable == recon_session.category_variable,
                Receipt.deleted_at.is_(None),
                Receipt.date >= recon_session.date_from,
                Receipt.date <= recon_session.date_to,
            )
        ).scalars().all()
    )

    # ── Load statement transactions ───────────────────────────────────────────
    txns: List[StatementTransaction] = list(
        db.execute(
            select(StatementTransaction).where(
                StatementTransaction.session_id == session_id,
                StatementTransaction.excluded == False,  # noqa: E712
                StatementTransaction.is_credit == False,  # noqa: E712
            )
        ).scalars().all()
    )

    # ── Delete existing matches ───────────────────────────────────────────────
    db.execute(
        delete(ReconciliationMatch).where(ReconciliationMatch.session_id == session_id)
    )
    db.flush()

    # ── Build candidate pairs ────────────────────────────────────────────────
    # List of (confidence_rank, receipt, txn)
    candidates: List[Tuple[int, Receipt, StatementTransaction]] = []
    for receipt in receipts:
        for txn in txns:
            conf = _confidence(receipt, txn)
            if conf is not None:
                candidates.append((_CONFIDENCE_RANK[conf], receipt, txn))

    # Sort descending by confidence rank so we greedily take the best first
    candidates.sort(key=lambda x: x[0], reverse=True)

    matched_receipt_ids: Set[uuid.UUID] = set()
    matched_txn_ids: Set[uuid.UUID] = set()
    match_rows: List[ReconciliationMatch] = []

    for rank, receipt, txn in candidates:
        if receipt.id in matched_receipt_ids or txn.id in matched_txn_ids:
            continue
        conf_label = next(k for k, v in _CONFIDENCE_RANK.items() if v == rank and k is not None)
        delta = float(receipt.amount) - float(txn.amount)
        row = ReconciliationMatch(
            id=uuid.uuid4(),
            session_id=session_id,
            receipt_id=receipt.id,
            statement_transaction_id=txn.id,
            status="pending",
            confidence=conf_label,
            amount_delta=round(delta, 2),
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        match_rows.append(row)
        matched_receipt_ids.add(receipt.id)
        matched_txn_ids.add(txn.id)

    # Unmatched receipts
    for receipt in receipts:
        if receipt.id not in matched_receipt_ids:
            row = ReconciliationMatch(
                id=uuid.uuid4(),
                session_id=session_id,
                receipt_id=receipt.id,
                statement_transaction_id=None,
                status="pending",
                confidence="none",
                amount_delta=None,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            match_rows.append(row)

    # Unmatched statement transactions
    for txn in txns:
        if txn.id not in matched_txn_ids:
            row = ReconciliationMatch(
                id=uuid.uuid4(),
                session_id=session_id,
                receipt_id=None,
                statement_transaction_id=txn.id,
                status="pending",
                confidence="none",
                amount_delta=None,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            match_rows.append(row)

    for row in match_rows:
        db.add(row)
    db.flush()

    return match_rows

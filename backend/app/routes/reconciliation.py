"""Reconciliation routes — statement upload and receipt matching."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models.receipt import (
    Receipt,
    ReconciliationMatch,
    ReconciliationSession,
    StatementTransaction,
)
from app.services.reconciliation_matcher import run_matching
from app.services.statement_parser import StatementParser, parse_csv_statement

router = APIRouter(prefix="/api/reconciliation", tags=["reconciliation"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class SessionCreateBody(BaseModel):
    category_variable: str


class SessionOut(BaseModel):
    id: str
    category_variable: str
    date_from: str
    date_to: str
    receipt_count: int
    total_amount_cents: int
    status: str
    notes: Optional[str]
    created_at: str
    updated_at: str


class SessionDetailOut(SessionOut):
    total_receipts: int
    matched: int
    unmatched_receipts: int
    unmatched_charges: int
    confirmed: int


class UploadResult(BaseModel):
    transactions_parsed: int
    matches_created: int


class ReceiptSnippet(BaseModel):
    id: str
    payee: str
    amount: float
    date: str
    payment_category: Optional[str]


class StatementTransactionOut(BaseModel):
    id: str
    date: str
    payee_raw: str
    amount: float
    account_label: Optional[str]
    account_type: str


class MatchOut(BaseModel):
    id: str
    session_id: str
    status: str
    confidence: Optional[str]
    amount_delta: Optional[float]
    notes: Optional[str]
    created_at: str
    updated_at: str
    receipt: Optional[ReceiptSnippet]
    statement_transaction: Optional[StatementTransactionOut]


class MatchPatchBody(BaseModel):
    status: Optional[str] = None
    statement_transaction_id: Optional[str] = None
    notes: Optional[str] = None


class ManualMatchBody(BaseModel):
    receipt_match_id: str
    charge_match_id: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _session_out(s: ReconciliationSession) -> Dict[str, Any]:
    return {
        "id": str(s.id),
        "category_variable": s.category_variable,
        "date_from": s.date_from.isoformat(),
        "date_to": s.date_to.isoformat(),
        "receipt_count": s.receipt_count,
        "total_amount_cents": s.total_amount_cents,
        "status": s.status,
        "notes": s.notes,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
    }


def _match_out(m: ReconciliationMatch) -> Dict[str, Any]:
    receipt_data = None
    if m.receipt:
        receipt_data = {
            "id": str(m.receipt.id),
            "payee": m.receipt.payee,
            "amount": float(m.receipt.amount),
            "date": m.receipt.date.isoformat(),
            "payment_category": m.receipt.payment_category,
        }
    txn_data = None
    if m.statement_transaction:
        t = m.statement_transaction
        txn_data = {
            "id": str(t.id),
            "date": t.date.isoformat(),
            "payee_raw": t.payee_raw,
            "amount": float(t.amount),
            "account_label": t.account_label,
            "account_type": t.account_type,
        }
    return {
        "id": str(m.id),
        "session_id": str(m.session_id),
        "status": m.status,
        "confidence": m.confidence,
        "amount_delta": float(m.amount_delta) if m.amount_delta is not None else None,
        "notes": m.notes,
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
        "receipt": receipt_data,
        "statement_transaction": txn_data,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/sessions", response_model=List[SessionOut])
async def list_sessions(
    db: AsyncSession = Depends(get_session),
    _user: Any = Depends(get_current_user),
):
    result = await db.execute(
        select(ReconciliationSession).order_by(ReconciliationSession.created_at.desc())
    )
    sessions = result.scalars().all()
    return [_session_out(s) for s in sessions]


@router.post("/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: SessionCreateBody,
    db: AsyncSession = Depends(get_session),
    _user: Any = Depends(get_current_user),
):
    # Date range and count: unreimbursed only (drives the "pull statements for this window" message)
    result = await db.execute(
        select(
            func.min(Receipt.date).label("date_from"),
            func.max(Receipt.date).label("date_to"),
            func.count(Receipt.id).label("receipt_count"),
        ).where(
            Receipt.category_variable == body.category_variable,
            Receipt.is_reimbursed == False,  # noqa: E712
            Receipt.deleted_at.is_(None),
        )
    )
    row = result.one()

    if row.receipt_count == 0 or row.date_from is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No unreimbursed receipts found for category '{body.category_variable}'",
        )

    # Total amount: unreimbursed only
    amount_result = await db.execute(
        select(Receipt.amount).where(
            Receipt.category_variable == body.category_variable,
            Receipt.is_reimbursed == False,  # noqa: E712
            Receipt.deleted_at.is_(None),
        )
    )
    amounts = amount_result.scalars().all()
    total_cents = int(round(sum(float(a) for a in amounts) * 100))

    now = datetime.now(timezone.utc)
    session_obj = ReconciliationSession(
        id=uuid.uuid4(),
        category_variable=body.category_variable,
        date_from=row.date_from,
        date_to=row.date_to,
        receipt_count=row.receipt_count,
        total_amount_cents=total_cents,
        status="uploading",
        created_at=now,
        updated_at=now,
    )
    db.add(session_obj)
    await db.commit()
    await db.refresh(session_obj)
    return _session_out(session_obj)


@router.get("/sessions/{session_id}", response_model=SessionDetailOut)
async def get_session_detail(
    session_id: str,
    db: AsyncSession = Depends(get_session),
    _user: Any = Depends(get_current_user),
):
    sid = uuid.UUID(session_id)
    result = await db.execute(
        select(ReconciliationSession).where(ReconciliationSession.id == sid)
    )
    session_obj = result.scalar_one_or_none()
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Match summary
    matches_result = await db.execute(
        select(ReconciliationMatch).where(ReconciliationMatch.session_id == sid)
    )
    matches = matches_result.scalars().all()

    total_receipts = sum(1 for m in matches if m.receipt_id is not None)
    matched = sum(
        1 for m in matches
        if m.receipt_id is not None and m.statement_transaction_id is not None
    )
    unmatched_receipts = sum(
        1 for m in matches
        if m.receipt_id is not None and m.statement_transaction_id is None
    )
    unmatched_charges = sum(
        1 for m in matches
        if m.receipt_id is None and m.statement_transaction_id is not None
    )
    confirmed = sum(1 for m in matches if m.status == "confirmed")

    out = _session_out(session_obj)
    out.update({
        "total_receipts": total_receipts,
        "matched": matched,
        "unmatched_receipts": unmatched_receipts,
        "unmatched_charges": unmatched_charges,
        "confirmed": confirmed,
    })
    return out


@router.post("/sessions/{session_id}/upload", response_model=UploadResult)
async def upload_statement(
    session_id: str,
    statement: UploadFile = File(...),
    account_label: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_session),
    _user: Any = Depends(get_current_user),
):
    sid = uuid.UUID(session_id)
    result = await db.execute(
        select(ReconciliationSession).where(ReconciliationSession.id == sid)
    )
    session_obj = result.scalar_one_or_none()
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session not found")

    file_bytes = await statement.read()
    filename = statement.filename or ""

    # Route to CSV parser or LLM PDF parser based on file type
    if filename.lower().endswith(".csv") or (statement.content_type or "").startswith("text/"):
        extraction = parse_csv_statement(file_bytes, filename=filename)
    else:
        parser = StatementParser()
        extraction = parser.parse(file_bytes)

    label = account_label or extraction.account_label
    now = datetime.now(timezone.utc)

    for t in extraction.transactions:
        from datetime import date as date_type
        txn_date = date_type.fromisoformat(t.date)
        txn = StatementTransaction(
            id=uuid.uuid4(),
            session_id=sid,
            account_label=label,
            account_type=extraction.account_type,
            date=txn_date,
            payee_raw=t.payee_raw[:1000],  # guard against unexpectedly long descriptions
            amount=t.amount,
            is_credit=t.is_credit,
            excluded=False,
            created_at=now,
        )
        db.add(txn)

    await db.flush()
    # Expunge all loaded ORM objects before handing the session to the sync matcher.
    # This prevents "Instance has been deleted" errors when the matcher issues a
    # bulk DELETE and then the outer async session tries to reconcile stale state.
    await db.run_sync(lambda s: s.expunge_all())

    # Run matching via run_sync so we can use the synchronous matcher with the async session
    match_rows = await db.run_sync(lambda sync_db: run_matching(sid, sync_db))

    transactions_parsed = len(extraction.transactions)
    matches_created = len(match_rows)

    # Update session status
    session_obj.status = "matching"
    session_obj.updated_at = now
    db.add(session_obj)
    await db.commit()

    return {"transactions_parsed": transactions_parsed, "matches_created": matches_created}


@router.get("/sessions/{session_id}/matches", response_model=List[MatchOut])
async def list_matches(
    session_id: str,
    match_status: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_session),
    _user: Any = Depends(get_current_user),
):
    sid = uuid.UUID(session_id)
    query = select(ReconciliationMatch).where(ReconciliationMatch.session_id == sid)
    if match_status:
        query = query.where(ReconciliationMatch.status == match_status)
    result = await db.execute(query)
    matches = result.scalars().all()
    return [_match_out(m) for m in matches]


@router.patch("/sessions/{session_id}/matches/{match_id}", response_model=MatchOut)
async def patch_match(
    session_id: str,
    match_id: str,
    body: MatchPatchBody,
    db: AsyncSession = Depends(get_session),
    _user: Any = Depends(get_current_user),
):
    sid = uuid.UUID(session_id)
    mid = uuid.UUID(match_id)
    result = await db.execute(
        select(ReconciliationMatch).where(
            ReconciliationMatch.id == mid,
            ReconciliationMatch.session_id == sid,
        )
    )
    match_obj = result.scalar_one_or_none()
    if match_obj is None:
        raise HTTPException(status_code=404, detail="Match not found")

    if body.status is not None:
        match_obj.status = body.status
    if body.notes is not None:
        match_obj.notes = body.notes
    if body.statement_transaction_id is not None:
        match_obj.statement_transaction_id = uuid.UUID(body.statement_transaction_id)
        match_obj.status = "manual"
    match_obj.updated_at = datetime.now(timezone.utc)

    db.add(match_obj)
    await db.commit()
    await db.refresh(match_obj)
    return _match_out(match_obj)


@router.post("/sessions/{session_id}/manual-match", response_model=MatchOut)
async def manual_match(
    session_id: str,
    body: ManualMatchBody,
    db: AsyncSession = Depends(get_session),
    _user: Any = Depends(get_current_user),
):
    sid = uuid.UUID(session_id)
    receipt_mid = uuid.UUID(body.receipt_match_id)
    charge_mid = uuid.UUID(body.charge_match_id)

    # Load and validate the receipt-side match row
    r_result = await db.execute(
        select(ReconciliationMatch).where(
            ReconciliationMatch.id == receipt_mid,
            ReconciliationMatch.session_id == sid,
        )
    )
    receipt_match = r_result.scalar_one_or_none()
    if receipt_match is None:
        raise HTTPException(status_code=404, detail="Receipt match row not found")
    if receipt_match.receipt_id is None or receipt_match.statement_transaction_id is not None:
        raise HTTPException(
            status_code=400,
            detail="receipt_match_id must be an unmatched receipt row (receipt set, no charge)",
        )

    # Load and validate the charge-side match row
    c_result = await db.execute(
        select(ReconciliationMatch).where(
            ReconciliationMatch.id == charge_mid,
            ReconciliationMatch.session_id == sid,
        )
    )
    charge_match = c_result.scalar_one_or_none()
    if charge_match is None:
        raise HTTPException(status_code=404, detail="Charge match row not found")
    if charge_match.statement_transaction_id is None or charge_match.receipt_id is not None:
        raise HTTPException(
            status_code=400,
            detail="charge_match_id must be an unmatched charge row (charge set, no receipt)",
        )

    # Compute amount_delta
    receipt_result = await db.execute(
        select(Receipt).where(Receipt.id == receipt_match.receipt_id)
    )
    receipt_obj = receipt_result.scalar_one_or_none()

    txn_result = await db.execute(
        select(StatementTransaction).where(
            StatementTransaction.id == charge_match.statement_transaction_id
        )
    )
    txn_obj = txn_result.scalar_one_or_none()

    amount_delta = None
    if receipt_obj is not None and txn_obj is not None:
        amount_delta = round(abs(float(receipt_obj.amount) - float(txn_obj.amount)), 2)

    now = datetime.now(timezone.utc)
    new_match = ReconciliationMatch(
        id=uuid.uuid4(),
        session_id=sid,
        receipt_id=receipt_match.receipt_id,
        statement_transaction_id=charge_match.statement_transaction_id,
        status="confirmed",
        confidence="manual",
        amount_delta=amount_delta,
        created_at=now,
        updated_at=now,
    )

    await db.delete(receipt_match)
    await db.delete(charge_match)
    db.add(new_match)
    await db.commit()
    await db.refresh(new_match)
    return _match_out(new_match)


@router.get("/sessions/{session_id}/export")
async def export_session(
    session_id: str,
    db: AsyncSession = Depends(get_session),
    _user: Any = Depends(get_current_user),
):
    sid = uuid.UUID(session_id)
    result = await db.execute(
        select(ReconciliationSession).where(ReconciliationSession.id == sid)
    )
    session_obj = result.scalar_one_or_none()
    if session_obj is None:
        raise HTTPException(status_code=404, detail="Session not found")

    matches_result = await db.execute(
        select(ReconciliationMatch).where(ReconciliationMatch.session_id == sid)
    )
    matches = matches_result.scalars().all()

    confirmed_matches = []
    pending_matches = []
    unmatched_receipts = []
    unmatched_charges = []

    for m in matches:
        if m.receipt_id is not None and m.statement_transaction_id is not None:
            data = _match_out(m)
            if m.status == "confirmed":
                confirmed_matches.append(data)
            elif m.status not in ("dismissed",):
                pending_matches.append(data)
        elif m.receipt_id is not None and m.statement_transaction_id is None:
            unmatched_receipts.append(_match_out(m))
        elif m.receipt_id is None and m.statement_transaction_id is not None:
            unmatched_charges.append(_match_out(m))

    return {
        "session": _session_out(session_obj),
        "confirmed_matches": confirmed_matches,
        "pending_matches": pending_matches,
        "unmatched_receipts": unmatched_receipts,
        "unmatched_charges": unmatched_charges,
        "summary": {
            "confirmed": len(confirmed_matches),
            "pending": len(pending_matches),
            "unmatched_receipts": len(unmatched_receipts),
            "unmatched_charges": len(unmatched_charges),
        },
    }

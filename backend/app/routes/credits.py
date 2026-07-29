"""
Reimbursement credits routes.

GET  /api/reimbursement-credits         — list credits (optional ?status=pending|applied)
POST /api/reimbursement-credits         — create credit
PATCH /api/reimbursement-credits/{id}   — update status/applied_at/notes
DELETE /api/reimbursement-credits/{id}  — hard delete (pending only)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models.receipt import ReimbursementCredit

router = APIRouter(prefix="/api/reimbursement-credits", tags=["credits"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreditCreate(BaseModel):
    original_receipt_id: Optional[uuid.UUID] = None
    amount_cents: int
    reason: str  # duplicate | refund | other
    notes: Optional[str] = None


class CreditUpdate(BaseModel):
    status: Optional[str] = None
    applied_at: Optional[datetime] = None
    notes: Optional[str] = None


class CreditOut(BaseModel):
    id: uuid.UUID
    original_receipt_id: Optional[uuid.UUID]
    amount_cents: int
    reason: str
    notes: Optional[str]
    status: str
    applied_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[CreditOut])
async def list_credits(
    status: Optional[str] = Query(None, description="Filter by status: pending or applied"),
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    stmt = select(ReimbursementCredit).order_by(ReimbursementCredit.created_at.desc())
    if status in ("pending", "applied"):
        stmt = stmt.where(ReimbursementCredit.status == status)
    result = await session.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=CreditOut, status_code=201)
async def create_credit(
    body: CreditCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "write":
        raise HTTPException(status_code=403, detail="Write access required")
    valid_reasons = {"duplicate", "refund", "other"}
    if body.reason not in valid_reasons:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid reason. Must be one of: {sorted(valid_reasons)}",
        )
    credit = ReimbursementCredit(
        id=uuid.uuid4(),
        original_receipt_id=body.original_receipt_id,
        amount_cents=body.amount_cents,
        reason=body.reason,
        notes=body.notes,
        status="pending",
    )
    session.add(credit)
    await session.commit()
    await session.refresh(credit)
    return credit


@router.patch("/{credit_id}", response_model=CreditOut)
async def update_credit(
    credit_id: uuid.UUID,
    body: CreditUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "write":
        raise HTTPException(status_code=403, detail="Write access required")
    credit = await session.get(ReimbursementCredit, credit_id)
    if not credit:
        raise HTTPException(status_code=404, detail="Credit not found")
    if body.status is not None:
        credit.status = body.status
    if body.applied_at is not None:
        credit.applied_at = body.applied_at
    if body.notes is not None:
        credit.notes = body.notes
    credit.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(credit)
    return credit


@router.delete("/{credit_id}", status_code=204)
async def delete_credit(
    credit_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "write":
        raise HTTPException(status_code=403, detail="Write access required")
    credit = await session.get(ReimbursementCredit, credit_id)
    if not credit:
        raise HTTPException(status_code=404, detail="Credit not found")
    if credit.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending credits can be deleted")
    await session.delete(credit)
    await session.commit()

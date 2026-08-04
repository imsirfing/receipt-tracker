"""
Petty cash routes.

GET  /api/cash-boxes                   — list all non-deleted boxes with computed balance
POST /api/cash-boxes                   — create box
PATCH /api/cash-boxes/{box_id}         — update name/notes/category_variable
DELETE /api/cash-boxes/{box_id}        — soft delete
GET  /api/cash-boxes/{box_id}/transactions — list transactions for a box
POST /api/cash-boxes/{box_id}/transactions — log a transaction
"""
from __future__ import annotations

import uuid
from datetime import date as _Date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models.receipt import CashBox, CashTransaction, Receipt

router = APIRouter(prefix="/api/cash-boxes", tags=["cash"])

DEDUCT_TYPES = {"expense", "reconciliation"}
ADD_TYPES = {"replenishment", "adjustment"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class CashBoxCreate(BaseModel):
    name: str
    category_variable: Optional[str] = None
    notes: Optional[str] = None


class CashBoxUpdate(BaseModel):
    name: Optional[str] = None
    category_variable: Optional[str] = None
    notes: Optional[str] = None


class CashBoxOut(BaseModel):
    id: uuid.UUID
    name: str
    category_variable: Optional[str]
    balance_cents: int
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TransactionCreate(BaseModel):
    type: str  # replenishment | expense | adjustment | reconciliation
    amount_cents: int
    date: _Date
    description: Optional[str] = None
    receipt_id: Optional[uuid.UUID] = None
    notes: Optional[str] = None


class TransactionOut(BaseModel):
    id: uuid.UUID
    cash_box_id: uuid.UUID
    type: str
    amount_cents: int
    date: _Date
    description: Optional[str]
    receipt_id: Optional[uuid.UUID]
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_box(box_id: uuid.UUID, session: AsyncSession) -> CashBox:
    result = await session.execute(
        select(CashBox).where(CashBox.id == box_id, CashBox.deleted_at.is_(None))
    )
    box = result.scalar_one_or_none()
    if not box:
        raise HTTPException(status_code=404, detail="Cash box not found")
    return box


def _compute_balance(transactions: list) -> int:
    balance = 0
    for t in transactions:
        if t.type in ADD_TYPES:
            balance += t.amount_cents
        elif t.type in DEDUCT_TYPES:
            balance -= t.amount_cents
    return balance


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[CashBoxOut])
async def list_cash_boxes(
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    result = await session.execute(
        select(CashBox).where(CashBox.deleted_at.is_(None)).order_by(CashBox.name)
    )
    boxes = result.scalars().all()
    out = []
    for box in boxes:
        balance = _compute_balance(box.transactions)
        out.append(CashBoxOut(
            id=box.id,
            name=box.name,
            category_variable=box.category_variable,
            balance_cents=balance,
            notes=box.notes,
            created_at=box.created_at,
            updated_at=box.updated_at,
        ))
    return out


@router.post("", response_model=CashBoxOut, status_code=201)
async def create_cash_box(
    body: CashBoxCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "write":
        raise HTTPException(status_code=403, detail="Write access required")
    box = CashBox(
        id=uuid.uuid4(),
        name=body.name,
        category_variable=body.category_variable,
        notes=body.notes,
    )
    session.add(box)
    await session.commit()
    await session.refresh(box)
    return CashBoxOut(
        id=box.id,
        name=box.name,
        category_variable=box.category_variable,
        balance_cents=0,
        notes=box.notes,
        created_at=box.created_at,
        updated_at=box.updated_at,
    )


@router.patch("/{box_id}", response_model=CashBoxOut)
async def update_cash_box(
    box_id: uuid.UUID,
    body: CashBoxUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "write":
        raise HTTPException(status_code=403, detail="Write access required")
    box = await _get_box(box_id, session)
    if body.name is not None:
        box.name = body.name
    if body.category_variable is not None:
        box.category_variable = body.category_variable
    if body.notes is not None:
        box.notes = body.notes
    box.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(box)
    balance = _compute_balance(box.transactions)
    return CashBoxOut(
        id=box.id,
        name=box.name,
        category_variable=box.category_variable,
        balance_cents=balance,
        notes=box.notes,
        created_at=box.created_at,
        updated_at=box.updated_at,
    )


@router.delete("/{box_id}", status_code=204)
async def delete_cash_box(
    box_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "write":
        raise HTTPException(status_code=403, detail="Write access required")
    box = await _get_box(box_id, session)
    box.deleted_at = datetime.now(timezone.utc)
    await session.commit()


@router.get("/{box_id}/transactions", response_model=List[TransactionOut])
async def list_transactions(
    box_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    await _get_box(box_id, session)
    result = await session.execute(
        select(CashTransaction)
        .where(CashTransaction.cash_box_id == box_id)
        .order_by(CashTransaction.date.desc(), CashTransaction.created_at.desc())
    )
    return result.scalars().all()


@router.post("/{box_id}/transactions", response_model=TransactionOut, status_code=201)
async def create_transaction(
    box_id: uuid.UUID,
    body: TransactionCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "write":
        raise HTTPException(status_code=403, detail="Write access required")
    await _get_box(box_id, session)

    valid_types = {"replenishment", "expense", "adjustment", "reconciliation"}
    if body.type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid transaction type. Must be one of: {sorted(valid_types)}",
        )

    if body.receipt_id:
        r = await session.get(Receipt, body.receipt_id)
        if not r:
            raise HTTPException(status_code=404, detail="Receipt not found")

    txn = CashTransaction(
        id=uuid.uuid4(),
        cash_box_id=box_id,
        type=body.type,
        amount_cents=body.amount_cents,
        date=body.date,
        description=body.description,
        receipt_id=body.receipt_id,
        notes=body.notes,
    )
    session.add(txn)
    await session.commit()
    await session.refresh(txn)
    return txn


@router.delete("/{box_id}/transactions/{txn_id}", status_code=204)
async def delete_transaction(
    box_id: uuid.UUID,
    txn_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "write":
        raise HTTPException(status_code=403, detail="Write access required")
    await _get_box(box_id, session)
    result = await session.execute(
        select(CashTransaction).where(
            CashTransaction.id == txn_id,
            CashTransaction.cash_box_id == box_id,
        )
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    await session.delete(txn)
    await session.commit()

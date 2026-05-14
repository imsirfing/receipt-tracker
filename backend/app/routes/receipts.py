from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.receipt import Attachment, Receipt, RecurringType

router = APIRouter(prefix="/api/receipts", tags=["receipts"])


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    gcs_uri: str
    file_type: str
    created_at: datetime


class ReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    payee: str
    amount: float
    date: date
    inferred_purpose: Optional[str]
    category_variable: str
    recurring_type: RecurringType
    is_reimbursed: bool
    reimbursed_at: Optional[datetime]
    raw_email_id: str
    created_at: datetime
    attachments: List[AttachmentOut] = []


class ReceiptUpdate(BaseModel):
    payee: Optional[str] = None
    amount: Optional[float] = None
    date: Optional[date] = None
    is_reimbursed: Optional[bool] = None
    reimbursed_at: Optional[datetime] = None


@router.get("", response_model=List[ReceiptOut])
async def list_receipts(
    category: Optional[str] = Query(None),
    is_reimbursed: Optional[bool] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> List[ReceiptOut]:
    stmt = select(Receipt)
    if category is not None:
        stmt = stmt.where(Receipt.category_variable == category)
    if is_reimbursed is not None:
        stmt = stmt.where(Receipt.is_reimbursed.is_(is_reimbursed))
    stmt = stmt.order_by(Receipt.date.desc()).limit(limit).offset(offset)
    result = await session.execute(stmt)
    return [ReceiptOut.model_validate(r) for r in result.scalars().all()]


@router.get("/{receipt_id}", response_model=ReceiptOut)
async def get_receipt(
    receipt_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> ReceiptOut:
    result = await session.execute(select(Receipt).where(Receipt.id == receipt_id))
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="receipt not found")
    return ReceiptOut.model_validate(receipt)


@router.patch("/{receipt_id}", response_model=ReceiptOut)
async def update_receipt(
    receipt_id: uuid.UUID,
    patch: ReceiptUpdate,
    session: AsyncSession = Depends(get_session),
) -> ReceiptOut:
    result = await session.execute(select(Receipt).where(Receipt.id == receipt_id))
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="receipt not found")

    for field, value in patch.model_dump(exclude_unset=True).items():
        setattr(receipt, field, value)

    await session.commit()
    await session.refresh(receipt)
    return ReceiptOut.model_validate(receipt)


@router.post("/{receipt_id}/reimburse", response_model=ReceiptOut)
async def reimburse_receipt(
    receipt_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> ReceiptOut:
    result = await session.execute(select(Receipt).where(Receipt.id == receipt_id))
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="receipt not found")

    receipt.is_reimbursed = True
    receipt.reimbursed_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(receipt)
    return ReceiptOut.model_validate(receipt)

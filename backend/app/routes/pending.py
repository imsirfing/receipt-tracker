from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.pending_email import PendingEmail
from app.models.receipt import Attachment, Receipt, RecurringType

router = APIRouter(prefix="/api/pending", tags=["pending"])


class PendingEmailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    gmail_message_id: str
    subject: str
    from_address: str
    body_preview: str
    category_variable: str
    skip_reason: str
    received_date: Optional[str]
    created_at: datetime


class ConvertRequest(BaseModel):
    payee: str
    amount: float
    date: str  # YYYY-MM-DD
    category_variable: str
    recurring_type: str  # "ongoing" | "one_off"
    payment_category: Optional[str] = None
    payment_detail: Optional[str] = None
    inferred_purpose: Optional[str] = None


@router.get("", response_model=List[PendingEmailOut])
async def list_pending(session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(PendingEmail).order_by(PendingEmail.created_at.desc())
    )
    return result.scalars().all()


@router.delete("/{pending_id}", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_pending(
    pending_id: uuid.UUID, session: AsyncSession = Depends(get_session)
):
    result = await session.execute(
        select(PendingEmail).where(PendingEmail.id == pending_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="pending email not found")
    await session.delete(row)
    await session.commit()


@router.post("/{pending_id}/convert", status_code=status.HTTP_201_CREATED)
async def convert_to_receipt(
    pending_id: uuid.UUID,
    body: ConvertRequest,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(PendingEmail).where(PendingEmail.id == pending_id)
    )
    pending = result.scalar_one_or_none()
    if pending is None:
        raise HTTPException(status_code=404, detail="pending email not found")

    try:
        parsed_date = date.fromisoformat(body.date)
    except ValueError:
        parsed_date = date.today()

    recurring = (
        RecurringType.ONGOING if body.recurring_type == "ongoing" else RecurringType.ONE_OFF
    )

    receipt = Receipt(
        id=uuid.uuid4(),
        payee=body.payee,
        amount=body.amount,
        date=parsed_date,
        inferred_purpose=body.inferred_purpose or "",
        payment_category=body.payment_category,
        payment_detail=body.payment_detail,
        category_variable=body.category_variable,
        recurring_type=recurring,
        raw_email_id=pending.gmail_message_id,
    )
    session.add(receipt)
    await session.delete(pending)
    await session.commit()
    await session.refresh(receipt)

    return receipt

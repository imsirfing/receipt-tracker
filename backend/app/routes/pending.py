from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from app.auth import get_current_user
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

import logging

from app.db import get_session
from app.models.pending_email import PendingEmail
from app.models.receipt import Attachment, Receipt, RecurringType
from app.workers.gmail_ingestion import archive_gmail_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pending", tags=["pending"])


class PendingListOut(BaseModel):
    items: list["PendingEmailOut"]
    total: int
    limit: int
    offset: int


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


@router.get("", response_model=PendingListOut)
async def list_pending(
    search: Optional[str] = Query(None),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> PendingListOut:
    if not current_user["is_owner"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    stmt = select(PendingEmail)
    if search is not None and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                PendingEmail.subject.ilike(term),
                PendingEmail.from_address.ilike(term),
                PendingEmail.body_preview.ilike(term),
            )
        )
    count_stmt = select(func.count()).select_from(stmt.subquery())
    count_result = await session.execute(count_stmt)
    total = count_result.scalar() or 0

    stmt = stmt.order_by(PendingEmail.created_at.desc()).limit(limit).offset(offset)
    result = await session.execute(stmt)
    items = result.scalars().all()
    return PendingListOut(items=items, total=total, limit=limit, offset=offset)


@router.delete("/{pending_id}", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_pending(
    pending_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    if not current_user["is_owner"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
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
    current_user: dict = Depends(get_current_user),
):
    if not current_user["is_owner"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
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

    from datetime import datetime, timezone as _tz
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
        source="gmail_auto",
        ingested_at=datetime.now(_tz.utc),
    )
    session.add(receipt)
    await session.delete(pending)
    try:
        await session.commit()
        await session.refresh(receipt)
        try:
            archive_gmail_message(pending.gmail_message_id)
        except Exception as exc:
            logger.warning("Failed to archive Gmail message %s: %s", pending.gmail_message_id, exc)
        return receipt
    except IntegrityError:
        # A receipt with this gmail_message_id already exists — clean up the
        # pending entry and return the existing receipt.
        await session.rollback()
        existing = await session.execute(
            select(Receipt).where(Receipt.raw_email_id == pending.gmail_message_id)
        )
        existing_receipt = existing.scalar_one_or_none()
        if existing_receipt is None:
            raise HTTPException(status_code=409, detail="Receipt already exists but could not be located.")
        # Delete the stale pending row
        stale = await session.execute(
            select(PendingEmail).where(PendingEmail.id == pending_id)
        )
        stale_row = stale.scalar_one_or_none()
        if stale_row:
            await session.delete(stale_row)
            await session.commit()
        return existing_receipt

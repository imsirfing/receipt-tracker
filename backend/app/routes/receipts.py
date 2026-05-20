from __future__ import annotations

import csv
import io
import os
import uuid
from datetime import date as _Date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.receipt import Attachment, Receipt, RecurringType

router = APIRouter(prefix="/api/receipts", tags=["receipts"])


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    gcs_uri: str
    file_type: str
    filename: Optional[str] = None
    created_at: datetime


class ReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    payee: str
    amount: float
    date: _Date
    inferred_purpose: Optional[str]
    payment_category: Optional[str]
    payment_detail: Optional[str]
    category_variable: str
    recurring_type: RecurringType
    is_reimbursed: bool
    reimbursed_at: Optional[datetime]
    notes: Optional[str] = None
    is_tax_deductible: bool = False
    reimbursement_owner: Optional[str] = None
    raw_email_id: str
    created_at: datetime
    attachments: List[AttachmentOut] = []


class ReceiptListOut(BaseModel):
    items: List[ReceiptOut]
    total: int
    limit: int
    offset: int


class ReceiptCreate(BaseModel):
    payee: str
    amount: float
    date: _Date
    category_variable: str
    recurring_type: str = "one_off"
    payment_category: Optional[str] = None
    payment_detail: Optional[str] = None
    inferred_purpose: Optional[str] = None
    notes: Optional[str] = None
    is_tax_deductible: bool = False
    reimbursement_owner: Optional[str] = None


class ReceiptUpdate(BaseModel):
    payee: Optional[str] = None
    amount: Optional[float] = None
    date: Optional[_Date] = None
    category_variable: Optional[str] = None
    is_reimbursed: Optional[bool] = None
    reimbursed_at: Optional[datetime] = None
    notes: Optional[str] = None
    is_tax_deductible: Optional[bool] = None
    reimbursement_owner: Optional[str] = None


@router.post("", response_model=ReceiptOut, status_code=201)
async def create_receipt(
    body: ReceiptCreate,
    session: AsyncSession = Depends(get_session),
) -> ReceiptOut:
    recurring = RecurringType.ONGOING if body.recurring_type == "ongoing" else RecurringType.ONE_OFF
    receipt = Receipt(
        id=uuid.uuid4(),
        payee=body.payee,
        amount=body.amount,
        date=body.date,
        inferred_purpose=body.inferred_purpose or "",
        payment_category=body.payment_category,
        payment_detail=body.payment_detail,
        category_variable=body.category_variable,
        recurring_type=recurring,
        notes=body.notes,
        is_tax_deductible=body.is_tax_deductible,
        reimbursement_owner=body.reimbursement_owner,
        raw_email_id=f"manual-{uuid.uuid4()}",
    )
    session.add(receipt)
    await session.commit()
    await session.refresh(receipt)
    return receipt


@router.get("", response_model=ReceiptListOut)
async def list_receipts(
    category: Optional[str] = Query(None),
    is_reimbursed: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> ReceiptListOut:
    stmt = select(Receipt)
    if category is not None:
        stmt = stmt.where(Receipt.category_variable == category)
    if is_reimbursed is not None:
        stmt = stmt.where(Receipt.is_reimbursed.is_(is_reimbursed))
    if search is not None and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Receipt.payee.ilike(term),
                Receipt.inferred_purpose.ilike(term),
                Receipt.payment_detail.ilike(term),
                Receipt.payment_category.ilike(term),
            )
        )

    count_stmt = select(func.count()).select_from(stmt.subquery())
    count_result = await session.execute(count_stmt)
    total = count_result.scalar()

    stmt = stmt.order_by(Receipt.date.desc()).limit(limit).offset(offset)
    result = await session.execute(stmt)
    receipts = [ReceiptOut.model_validate(r) for r in result.scalars().all()]
    return ReceiptListOut(items=receipts, total=total, limit=limit, offset=offset)


@router.get("/export")
async def export_receipts_csv(
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Receipt).order_by(Receipt.date.desc())
    )
    receipts = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "payee", "amount", "date", "category", "payment_category",
        "payment_detail", "purpose", "recurring_type", "is_reimbursed",
        "is_tax_deductible", "reimbursement_owner", "notes", "created_at"
    ])
    for r in receipts:
        writer.writerow([
            str(r.id), r.payee, str(r.amount), str(r.date),
            r.category_variable or "", r.payment_category or "",
            r.payment_detail or "", r.inferred_purpose or "",
            r.recurring_type or "", r.is_reimbursed,
            getattr(r, "is_tax_deductible", False),
            getattr(r, "reimbursement_owner", "") or "",
            getattr(r, "notes", "") or "",
            str(r.created_at)
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=receipts.csv"}
    )


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


from google.cloud import storage as gcs_storage


@router.get("/{receipt_id}/attachments/{attachment_id}/url")
async def get_attachment_url(
    receipt_id: uuid.UUID,
    attachment_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        select(Attachment).where(
            Attachment.id == attachment_id,
            Attachment.receipt_id == receipt_id,
        )
    )
    attachment = result.scalar_one_or_none()
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="attachment not found")

    gcs_uri = attachment.gcs_uri
    _, _, rest = gcs_uri.partition("gs://")
    bucket_name, _, blob_path = rest.partition("/")

    client = gcs_storage.Client(project=os.getenv("GCP_PROJECT_ID"))
    blob = client.bucket(bucket_name).blob(blob_path)
    url = blob.generate_signed_url(
        expiration=timedelta(hours=1),
        method="GET",
        version="v4",
    )
    filename = blob_path.split("/")[-1]
    return {"url": url, "file_type": attachment.file_type, "filename": filename}

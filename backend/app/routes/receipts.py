from __future__ import annotations

import csv
import io
import os
import uuid
from datetime import date as _Date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from google.cloud import storage as gcs_storage

from app.auth import get_current_user
from app.db import get_session
from app.models.pending_email import PendingEmail
from app.models.receipt import Attachment, Receipt, ReceiptAuditLog, RecurringType
from app.workers.gmail_ingestion import screenshot_gmail_message

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
    source: str = "manual"
    ingested_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
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
    inferred_purpose: Optional[str] = None
    payment_category: Optional[str] = None
    payment_detail: Optional[str] = None
    recurring_type: Optional[str] = None


@router.post("", response_model=ReceiptOut, status_code=201)
async def create_receipt(
    body: ReceiptCreate,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> ReceiptOut:
    if current_user["role"] != "write":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Write access required")
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
        source="manual",
    )
    session.add(receipt)
    await session.flush()
    session.add(ReceiptAuditLog(
        receipt_id=receipt.id,
        event_type="created",
        snapshot_after=receipt.to_audit_dict(),
    ))
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
    current_user: dict = Depends(get_current_user),
) -> ReceiptListOut:
    # Non-owner users are restricted to their granted category
    if current_user["access_category"] != "all":
        category = current_user["access_category"]
    stmt = select(Receipt).where(Receipt.deleted_at.is_(None))
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
                Receipt.notes.ilike(term),
                Receipt.category_variable.ilike(term),
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


# ---------------------------------------------------------------------------
# Image upload + parse endpoint
# ---------------------------------------------------------------------------

class AttachImageRequest(BaseModel):
    gcs_uri: str
    file_type: str
    filename: Optional[str] = None


@router.post("/parse-image")
async def parse_receipt_image(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Accept an image upload, run AI parsing, return extracted fields + GCS URI."""
    from app.services.document_parser import DocumentParser, NotAReceiptError

    content_type = file.content_type or ""
    allowed_types = {"image/jpeg", "image/png", "image/heic", "image/webp"}
    if content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"File must be an image (jpeg, png, heic, webp). Got: {content_type}",
        )

    image_bytes = await file.read()

    ext_map = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/heic": "heic",
        "image/webp": "webp",
    }
    ext = ext_map.get(content_type, "jpg")

    bucket_name = os.getenv("GCS_BUCKET_NAME")
    blob_path = f"manual-uploads/{uuid.uuid4()}.{ext}"
    gcs_client = gcs_storage.Client(project=os.getenv("GCP_PROJECT_ID"))
    blob = gcs_client.bucket(bucket_name).blob(blob_path)
    blob.upload_from_string(image_bytes, content_type=content_type)
    gcs_uri = f"gs://{bucket_name}/{blob_path}"

    try:
        extraction = DocumentParser().extract(image_bytes, mime_type=content_type)
    except NotAReceiptError as exc:
        raise HTTPException(status_code=400, detail=f"Not a receipt: {exc.reason}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Parsing failed: {exc}") from exc

    return {
        "payee": extraction.payee,
        "amount": extraction.amount,
        "date": extraction.date,
        "inferred_purpose": extraction.inferred_purpose,
        "recurring_type": extraction.recurring_type,
        "payment_category": extraction.payment_category,
        "payment_detail": extraction.payment_detail,
        "attachment_gcs_uri": gcs_uri,
        "attachment_file_type": content_type,
        "attachment_filename": file.filename,
    }


@router.get("/{receipt_id}", response_model=ReceiptOut)
async def get_receipt(
    receipt_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> ReceiptOut:
    result = await session.execute(
        select(Receipt).where(Receipt.id == receipt_id, Receipt.deleted_at.is_(None))
    )
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="receipt not found")
    # Enforce category-scoped access for non-owner users
    if current_user["access_category"] != "all" and receipt.category_variable != current_user["access_category"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return ReceiptOut.model_validate(receipt)


@router.patch("/{receipt_id}", response_model=ReceiptOut)
async def update_receipt(
    receipt_id: uuid.UUID,
    patch: ReceiptUpdate,
    edit_reason: Optional[str] = Query(None, description="Reason for this edit (logged in audit trail)"),
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> ReceiptOut:
    if current_user["role"] != "write":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Write access required")
    result = await session.execute(
        select(Receipt).where(Receipt.id == receipt_id, Receipt.deleted_at.is_(None))
    )
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="receipt not found")

    snapshot_before = receipt.to_audit_dict()
    changes = patch.model_dump(exclude_unset=True)
    changed_fields = []
    for field, value in changes.items():
        if getattr(receipt, field, None) != value:
            changed_fields.append(field)
        setattr(receipt, field, value)
    receipt.updated_at = datetime.now(timezone.utc)

    if changed_fields:
        session.add(ReceiptAuditLog(
            receipt_id=receipt.id,
            event_type="updated",
            fields_changed=changed_fields,
            snapshot_before=snapshot_before,
            snapshot_after=receipt.to_audit_dict(),
            edit_reason=edit_reason,
        ))

    await session.commit()
    await session.refresh(receipt)
    return ReceiptOut.model_validate(receipt)


@router.post("/{receipt_id}/reimburse", response_model=ReceiptOut)
async def reimburse_receipt(
    receipt_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> ReceiptOut:
    if current_user["role"] != "write":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Write access required")
    result = await session.execute(select(Receipt).where(Receipt.id == receipt_id))
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="receipt not found")

    receipt.is_reimbursed = True
    receipt.reimbursed_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(receipt)
    return ReceiptOut.model_validate(receipt)


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_receipt(
    receipt_id: uuid.UUID,
    reason: Optional[str] = Query(None, description="Reason for deletion (logged in audit trail)"),
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> Response:
    if current_user["role"] != "write":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Write access required")
    result = await session.execute(
        select(Receipt).where(Receipt.id == receipt_id, Receipt.deleted_at.is_(None))
    )
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="receipt not found")
    snapshot = receipt.to_audit_dict()
    receipt.deleted_at = datetime.now(timezone.utc)
    receipt.deleted_reason = reason
    receipt.updated_at = datetime.now(timezone.utc)
    session.add(ReceiptAuditLog(
        receipt_id=receipt.id,
        event_type="deleted",
        snapshot_before=snapshot,
        edit_reason=reason,
    ))
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{receipt_id}/attach-image", response_model=ReceiptOut)
async def attach_image_to_receipt(
    receipt_id: uuid.UUID,
    body: AttachImageRequest,
    session: AsyncSession = Depends(get_session),
) -> ReceiptOut:
    """Create an Attachment row linking a GCS image to the given receipt."""
    result = await session.execute(
        select(Receipt).where(Receipt.id == receipt_id, Receipt.deleted_at.is_(None))
    )
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="receipt not found")

    attachment = Attachment(
        id=uuid.uuid4(),
        gcs_uri=body.gcs_uri,
        file_type=body.file_type,
        filename=body.filename,
        receipt_id=receipt.id,
    )
    session.add(attachment)
    await session.commit()
    await session.refresh(receipt)
    return ReceiptOut.model_validate(receipt)


# ---------------------------------------------------------------------------
# Audit trail endpoint
# ---------------------------------------------------------------------------

class AuditLogOut(BaseModel):
    id: int
    receipt_id: Optional[uuid.UUID]
    event_type: str
    event_at: datetime
    actor: str
    fields_changed: Optional[List[str]] = None
    snapshot_before: Optional[dict] = None
    snapshot_after: Optional[dict] = None
    edit_reason: Optional[str] = None
    notes: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


@router.get("/{receipt_id}/audit", response_model=List[AuditLogOut])
async def get_receipt_audit(
    receipt_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> List[AuditLogOut]:
    result = await session.execute(
        select(ReceiptAuditLog)
        .where(ReceiptAuditLog.receipt_id == receipt_id)
        .order_by(ReceiptAuditLog.event_at.asc())
    )
    return [AuditLogOut.model_validate(row) for row in result.scalars().all()]


# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Evidence Package endpoint
# ---------------------------------------------------------------------------

@router.get("/{receipt_id}/evidence-package")
async def get_evidence_package(
    receipt_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    # 1. Fetch receipt
    result = await session.execute(
        select(Receipt).where(Receipt.id == receipt_id)
    )
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="receipt not found")

    # 2. Fetch audit log
    audit_result = await session.execute(
        select(ReceiptAuditLog)
        .where(ReceiptAuditLog.receipt_id == receipt_id)
        .order_by(ReceiptAuditLog.event_at.asc())
    )
    audit_entries = audit_result.scalars().all()

    # 3. Try to fetch email provenance
    email_provenance = None
    if receipt.raw_email_id and not receipt.raw_email_id.startswith("manual-"):
        prov_result = await session.execute(
            select(PendingEmail).where(PendingEmail.gmail_message_id == receipt.raw_email_id)
        )
        email_provenance = prov_result.scalar_one_or_none()

    # Fetch email screenshot if gmail-sourced
    email_screenshot_bytes: bytes | None = None
    if receipt.raw_email_id and email_provenance:
        email_screenshot_bytes = await screenshot_gmail_message(receipt.raw_email_id)

    # 4. Generate signed URLs for attachments
    signed_attachments = []
    try:
        from google.cloud import storage as gcs_storage
        gcs_client = gcs_storage.Client(project=os.getenv("GCP_PROJECT_ID"))
        for att in receipt.attachments:
            gcs_uri = att.gcs_uri
            _, _, rest = gcs_uri.partition("gs://")
            bucket_name, _, blob_path = rest.partition("/")
            blob = gcs_client.bucket(bucket_name).blob(blob_path)
            signed_url = blob.generate_signed_url(
                expiration=timedelta(hours=1),
                method="GET",
                version="v4",
            )
            filename = blob_path.split("/")[-1]
            signed_attachments.append({
                "id": att.id,
                "filename": att.filename or filename,
                "file_type": att.file_type,
                "signed_url": signed_url,
            })
    except Exception:
        # If GCS is unavailable, attach without signed URLs
        for att in receipt.attachments:
            filename = att.gcs_uri.split("/")[-1]
            signed_attachments.append({
                "id": att.id,
                "filename": att.filename or filename,
                "file_type": att.file_type,
                "signed_url": None,
            })

    # 5. Build PDF
    try:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, leftMargin=inch, rightMargin=inch, topMargin=inch, bottomMargin=inch)
        styles = getSampleStyleSheet()
        story = []

        now_utc = datetime.now(timezone.utc)
        source_label = "Gmail auto-parse" if (receipt.source == "gmail_auto" and not (receipt.raw_email_id or "").startswith("manual-")) else "Manual"

        # ── Page 1: Cover Sheet ──
        story.append(Paragraph("Evidence Package", styles["Title"]))
        story.append(Spacer(1, 0.15 * inch))
        story.append(HRFlowable(width="100%", thickness=1, color="#cccccc"))
        story.append(Spacer(1, 0.2 * inch))

        story.append(Paragraph("Receipt Summary", styles["Heading2"]))
        fields = [
            ("Payee", receipt.payee),
            ("Amount", f"${receipt.amount:.2f}"),
            ("Date", str(receipt.date)),
            ("Category", receipt.category_variable or "—"),
            ("Purpose", receipt.inferred_purpose or "—"),
            ("Source", source_label),
            ("Ingested at", str(receipt.ingested_at) if receipt.ingested_at else "—"),
            ("Created at", str(receipt.created_at)),
            ("Number of attachments", str(len(receipt.attachments))),
            ("Number of audit events", str(len(audit_entries))),
            ("Export generated at", now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")),
        ]
        for label, value in fields:
            story.append(Paragraph(f"<b>{label}:</b> {value}", styles["Normal"]))
            story.append(Spacer(1, 0.05 * inch))

        story.append(Spacer(1, 0.3 * inch))
        story.append(Paragraph("Generated by Sparticus Receipt Tracker", styles["Italic"]))

        # ── Page 2: Audit Trail ──
        from reportlab.platypus import PageBreak
        story.append(PageBreak())
        story.append(Paragraph("Audit Trail", styles["Title"]))
        story.append(Spacer(1, 0.15 * inch))
        story.append(HRFlowable(width="100%", thickness=1, color="#cccccc"))
        story.append(Spacer(1, 0.2 * inch))

        if not audit_entries:
            story.append(Paragraph("No audit events recorded.", styles["Normal"]))
        else:
            for entry in audit_entries:
                event_at_str = entry.event_at.strftime("%Y-%m-%d %H:%M:%S UTC") if entry.event_at else "—"
                story.append(Paragraph(f"<b>{entry.event_type.upper()}</b> — {event_at_str} — Actor: {entry.actor or '—'}", styles["Heading3"]))
                if entry.edit_reason:
                    story.append(Paragraph(f"Reason: {entry.edit_reason}", styles["Italic"]))
                if entry.event_type == "updated" and entry.fields_changed:
                    for field in entry.fields_changed:
                        before = (entry.snapshot_before or {}).get(field)
                        after = (entry.snapshot_after or {}).get(field)
                        story.append(Paragraph(
                            f"&nbsp;&nbsp;<b>{field}:</b> {before} → {after}",
                            styles["Normal"]
                        ))
                story.append(Spacer(1, 0.1 * inch))

        # ── Page 3: Email Provenance (if gmail-sourced) ──
        if email_provenance:
            story.append(PageBreak())
            story.append(Paragraph("Email Provenance", styles["Title"]))
            story.append(Spacer(1, 0.15 * inch))
            story.append(HRFlowable(width="100%", thickness=1, color="#cccccc"))
            story.append(Spacer(1, 0.2 * inch))

            gmail_link = f"https://mail.google.com/mail/u/0/#inbox/{receipt.raw_email_id}"
            prov_fields = [
                ("From", email_provenance.from_address or "—"),
                ("Subject", email_provenance.subject or "—"),
                ("Gmail Message ID", receipt.raw_email_id),
                ("Gmail link", f'<a href="{gmail_link}">{gmail_link}</a>'),
            ]
            for label, value in prov_fields:
                story.append(Paragraph(f"<b>{label}:</b> {value}", styles["Normal"]))
                story.append(Spacer(1, 0.05 * inch))

            if email_provenance.body_preview:
                story.append(Spacer(1, 0.15 * inch))
                story.append(Paragraph("Body Preview", styles["Heading3"]))
                preview = (email_provenance.body_preview or "")[:2000]
                story.append(Paragraph(preview.replace("\n", "<br/>"), styles["Normal"]))

        # ── Email Screenshot page ──
        if email_screenshot_bytes:
            from reportlab.platypus import Image as RLImage
            import io as _io
            story.append(PageBreak())
            story.append(Paragraph("Email Screenshot", styles["Title"]))
            story.append(Spacer(1, 0.15 * inch))
            story.append(HRFlowable(width="100%", thickness=1, color="#cccccc"))
            story.append(Spacer(1, 0.2 * inch))
            img_buf = _io.BytesIO(email_screenshot_bytes)
            img = RLImage(img_buf, width=6.5 * inch, kind="proportional")
            story.append(img)

        # ── Page 4+: Attachment Links ──
        if signed_attachments:
            story.append(PageBreak())
            story.append(Paragraph("Attachments", styles["Title"]))
            story.append(Spacer(1, 0.15 * inch))
            story.append(HRFlowable(width="100%", thickness=1, color="#cccccc"))
            story.append(Spacer(1, 0.2 * inch))
            story.append(Paragraph("Original files preserved in Google Cloud Storage.", styles["Italic"]))
            story.append(Spacer(1, 0.15 * inch))

            for att in signed_attachments:
                story.append(Paragraph(f"<b>Filename:</b> {att['filename']}", styles["Normal"]))
                story.append(Paragraph(f"<b>Type:</b> {att['file_type']}", styles["Normal"]))
                if att["signed_url"]:
                    url = att["signed_url"]
                    story.append(Paragraph(f'<b>URL (1 hour):</b> <a href="{url}">{url[:80]}...</a>', styles["Normal"]))
                else:
                    story.append(Paragraph("<b>URL:</b> unavailable", styles["Normal"]))
                story.append(Spacer(1, 0.15 * inch))

        doc.build(story)
        buffer.seek(0)

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {exc}") from exc

    # 7. Log exported event
    session.add(ReceiptAuditLog(
        receipt_id=receipt_id,
        event_type="exported",
        actor="james",
        notes="Evidence package exported as PDF",
    ))
    await session.commit()

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="evidence-{receipt_id}.pdf"'},
    )

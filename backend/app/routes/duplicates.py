"""Duplicate candidate review routes.

GET  /api/duplicate-candidates                  — list pending_review pairs (with inlined receipts)
POST /api/duplicate-scan                        — trigger full re-scan
POST /api/duplicate-candidates/{id}/merge       — merge (soft-delete non-primary)
POST /api/duplicate-candidates/{id}/link        — mark as linked (keep both)
POST /api/duplicate-candidates/{id}/dismiss     — dismiss the candidate
"""
from __future__ import annotations

import uuid
from datetime import date as _Date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.duplicate_scanner import scan_for_duplicates
from app.models.receipt import DuplicateCandidate, Receipt, ReceiptAuditLog
from app.schemas.receipts import ReceiptOut

router = APIRouter(tags=["duplicates"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ReceiptSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    payee: str
    canonical_payee: Optional[str] = None
    amount: float
    date: _Date
    invoice_number: Optional[str] = None
    inferred_purpose: Optional[str] = None
    category_variable: str
    source: str = "manual"
    created_at: datetime


class DuplicateCandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    receipt_id_a: uuid.UUID
    receipt_id_b: uuid.UUID
    match_reason: str
    confidence: str
    status: str
    merged_into_id: Optional[uuid.UUID] = None
    reviewed_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime
    receipt_a: ReceiptSummary
    receipt_b: ReceiptSummary


class MergeRequest(BaseModel):
    primary_receipt_id: uuid.UUID


class ActionRequest(BaseModel):
    notes: Optional[str] = None


class ScanResult(BaseModel):
    new_candidates: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_owner(current_user: dict) -> None:
    if not current_user.get("is_owner"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner access required",
        )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/api/duplicate-candidates", response_model=List[DuplicateCandidateOut])
async def list_duplicate_candidates(
    status_filter: Optional[str] = Query("pending_review", alias="status"),
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> List[DuplicateCandidateOut]:
    _require_owner(current_user)
    stmt = select(DuplicateCandidate).order_by(DuplicateCandidate.created_at.desc())
    if status_filter:
        stmt = stmt.where(DuplicateCandidate.status == status_filter)
    result = await session.execute(stmt)
    return result.scalars().all()


@router.post("/api/duplicate-candidates/scan", response_model=ScanResult)
async def trigger_duplicate_scan_v2(
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> ScanResult:
    _require_owner(current_user)
    new_candidates = await scan_for_duplicates(session)
    return ScanResult(new_candidates=new_candidates)


@router.post("/api/duplicate-scan", response_model=ScanResult, include_in_schema=False)
async def trigger_duplicate_scan_legacy(
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> ScanResult:
    """Legacy path — prefer /api/duplicate-candidates/scan."""
    _require_owner(current_user)
    new_candidates = await scan_for_duplicates(session)
    return ScanResult(new_candidates=new_candidates)


@router.post("/api/duplicate-candidates/{candidate_id}/merge", response_model=DuplicateCandidateOut)
async def merge_duplicate(
    candidate_id: uuid.UUID,
    body: MergeRequest,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> DuplicateCandidateOut:
    _require_owner(current_user)

    candidate = await _get_candidate(session, candidate_id)

    # Validate primary_receipt_id is one of the two
    valid_ids = {candidate.receipt_id_a, candidate.receipt_id_b}
    if body.primary_receipt_id not in valid_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="primary_receipt_id must be one of the two receipts in this candidate",
        )

    secondary_id = (
        candidate.receipt_id_b
        if body.primary_receipt_id == candidate.receipt_id_a
        else candidate.receipt_id_a
    )

    # Load both receipts
    primary = await _get_receipt(session, body.primary_receipt_id)
    secondary = await _get_receipt(session, secondary_id)

    now = datetime.now(timezone.utc)

    # Soft-delete the secondary
    secondary.deleted_at = now
    secondary.deleted_reason = "merged_duplicate"

    # Write audit entries
    actor = current_user.get("email", "james")
    session.add(
        ReceiptAuditLog(
            receipt_id=primary.id,
            event_type="merged_duplicate_kept",
            event_at=now,
            actor=actor,
            notes=f"Kept as primary; secondary {secondary_id} soft-deleted",
        )
    )
    session.add(
        ReceiptAuditLog(
            receipt_id=secondary.id,
            event_type="merged_duplicate_removed",
            event_at=now,
            actor=actor,
            notes=f"Merged into primary {body.primary_receipt_id}",
        )
    )

    # Update candidate
    candidate.status = "merged"
    candidate.merged_into_id = body.primary_receipt_id
    candidate.reviewed_at = now

    await session.commit()
    await session.refresh(candidate)
    return candidate


@router.post("/api/duplicate-candidates/{candidate_id}/link", response_model=DuplicateCandidateOut)
async def link_duplicate(
    candidate_id: uuid.UUID,
    body: ActionRequest = ActionRequest(),
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> DuplicateCandidateOut:
    _require_owner(current_user)
    candidate = await _get_candidate(session, candidate_id)
    now = datetime.now(timezone.utc)
    candidate.status = "linked"
    candidate.reviewed_at = now
    if body.notes is not None:
        candidate.notes = body.notes
    await session.commit()
    await session.refresh(candidate)
    return candidate


@router.post("/api/duplicate-candidates/{candidate_id}/dismiss", response_model=DuplicateCandidateOut)
async def dismiss_duplicate(
    candidate_id: uuid.UUID,
    body: ActionRequest = ActionRequest(),
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> DuplicateCandidateOut:
    _require_owner(current_user)
    candidate = await _get_candidate(session, candidate_id)
    now = datetime.now(timezone.utc)
    candidate.status = "dismissed"
    candidate.reviewed_at = now
    if body.notes is not None:
        candidate.notes = body.notes
    await session.commit()
    await session.refresh(candidate)
    return candidate


# ---------------------------------------------------------------------------
# Linked receipts endpoint (for ReceiptDetail page)
# ---------------------------------------------------------------------------

class LinkedReceiptOut(BaseModel):
    candidate_id: uuid.UUID
    match_reason: str
    reviewed_at: Optional[datetime] = None
    receipt: ReceiptSummary


@router.get("/api/receipts/{receipt_id}/linked", response_model=List[LinkedReceiptOut])
async def get_linked_receipts(
    receipt_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
) -> List[LinkedReceiptOut]:
    result = await session.execute(
        select(DuplicateCandidate).where(
            DuplicateCandidate.status == "linked",
            (DuplicateCandidate.receipt_id_a == receipt_id)
            | (DuplicateCandidate.receipt_id_b == receipt_id),
        )
    )
    candidates = result.scalars().all()

    out: List[LinkedReceiptOut] = []
    for c in candidates:
        other_id = c.receipt_id_b if c.receipt_id_a == receipt_id else c.receipt_id_a
        other = await _get_receipt(session, other_id, raise_on_missing=False)
        if other is None:
            continue
        out.append(
            LinkedReceiptOut(
                candidate_id=c.id,
                match_reason=c.match_reason,
                reviewed_at=c.reviewed_at,
                receipt=other,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

async def _get_candidate(session: AsyncSession, candidate_id: uuid.UUID) -> DuplicateCandidate:
    result = await session.execute(
        select(DuplicateCandidate).where(DuplicateCandidate.id == candidate_id)
    )
    candidate = result.scalar_one_or_none()
    if candidate is None:
        raise HTTPException(status_code=404, detail="Duplicate candidate not found")
    return candidate


async def _get_receipt(
    session: AsyncSession,
    receipt_id: uuid.UUID,
    raise_on_missing: bool = True,
) -> Optional[Receipt]:
    result = await session.execute(select(Receipt).where(Receipt.id == receipt_id))
    receipt = result.scalar_one_or_none()
    if receipt is None and raise_on_missing:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt

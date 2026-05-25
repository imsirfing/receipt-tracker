"""
Pydantic schema models for the receipts API.

Kept in a separate module so they can be imported by tests
without pulling in heavy route-level dependencies (reportlab, google.cloud, etc.).
"""
from __future__ import annotations

import uuid
from datetime import date as _Date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict

from app.models.receipt import RecurringType


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
    canonical_payee: Optional[str] = None
    amount: float
    date: _Date
    inferred_purpose: Optional[str]
    payment_category: Optional[str]
    payment_detail: Optional[str]
    category_variable: str
    recurring_type: RecurringType
    is_reimbursed: bool
    reimbursement_status: str = "none"
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
    reimbursement_status: Optional[str] = None
    reimbursed_at: Optional[datetime] = None
    notes: Optional[str] = None
    is_tax_deductible: Optional[bool] = None
    reimbursement_owner: Optional[str] = None
    inferred_purpose: Optional[str] = None
    payment_category: Optional[str] = None
    payment_detail: Optional[str] = None
    recurring_type: Optional[str] = None


class BulkSetReimbursementStatusRequest(BaseModel):
    ids: List[uuid.UUID]
    status: str

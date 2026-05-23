import uuid
from datetime import date, datetime, timezone
from enum import Enum as PyEnum
from typing import Any, Dict, List, Optional
from sqlalchemy import BigInteger, JSON, String, Numeric, Date, Boolean, DateTime, ForeignKey, Index, Text, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class RecurringType(str, PyEnum):
    ONE_OFF = "one_off"
    ONGOING = "ongoing"

class ReimbursementStatus(str, PyEnum):
    NONE = "none"
    PENDING = "pending"
    REIMBURSED = "reimbursed"

class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    payee: Mapped[str] = mapped_column(String(255), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    inferred_purpose: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    payment_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    payment_detail: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    category_variable: Mapped[str] = mapped_column(String(50), nullable=False)
    recurring_type: Mapped[str] = mapped_column(
        String(20),
        default=RecurringType.ONE_OFF.value,
        nullable=False
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_tax_deductible: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    reimbursement_owner: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_reimbursed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reimbursed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reimbursed_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    reimbursement_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reimbursement_status: Mapped[str] = mapped_column(String(20), default=ReimbursementStatus.NONE.value, server_default="none", nullable=False)
    raw_email_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="manual", server_default="manual")
    ingested_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Database relationships
    attachments: Mapped[List["Attachment"]] = relationship(
        "Attachment", back_populates="receipt", cascade="all, delete-orphan", lazy="selectin"
    )

    # Database query performance indices
    __table_args__ = (
        Index("idx_receipts_category_variable", "category_variable"),
        Index("idx_receipts_is_reimbursed", "is_reimbursed"),
        Index("idx_receipts_raw_email_id", "raw_email_id"),
        Index("idx_receipts_deleted_at", "deleted_at"),
        Index("idx_receipts_reimbursed_date_category", "is_reimbursed", "date", "category_variable"),
        Index("idx_receipts_reimbursement_status", "reimbursement_status"),
    )

    def to_audit_dict(self) -> Dict[str, Any]:
        """Serialize receipt fields to a JSON-safe dict for audit snapshots."""
        return {
            "id": str(self.id),
            "payee": self.payee,
            "amount": float(self.amount) if self.amount is not None else None,
            "date": self.date.isoformat() if self.date else None,
            "inferred_purpose": self.inferred_purpose,
            "payment_category": self.payment_category,
            "payment_detail": self.payment_detail,
            "category_variable": self.category_variable,
            "recurring_type": self.recurring_type,
            "notes": self.notes,
            "is_tax_deductible": self.is_tax_deductible,
            "reimbursement_owner": self.reimbursement_owner,
            "is_reimbursed": self.is_reimbursed,
            "reimbursement_status": self.reimbursement_status,
            "reimbursed_at": self.reimbursed_at.isoformat() if self.reimbursed_at else None,
            "raw_email_id": self.raw_email_id,
            "source": self.source,
            "ingested_at": self.ingested_at.isoformat() if self.ingested_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

class ReceiptAuditLog(Base):
    """Append-only log of all state-changing events on receipts."""
    __tablename__ = "receipt_audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    receipt_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # ENUM: 'created' | 'updated' | 'deleted' | 'restored' | 'exported'
    event_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    actor: Mapped[str] = mapped_column(String(100), nullable=False, default="james")
    fields_changed: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    snapshot_before: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    snapshot_after: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    edit_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("idx_audit_log_receipt_id", "receipt_id"),
        Index("idx_audit_log_event_at", "event_at"),
    )


class UserAccess(Base):
    """Grants a non-owner user read or write access to a specific receipt category."""
    __tablename__ = "user_access"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False)  # category name or "all"
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="read")  # "read" | "write"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_user_access_email", "email"),
        UniqueConstraint("email", "category", name="uq_user_access_email_category"),
    )


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    receipt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("receipts.id", ondelete="CASCADE"), nullable=False)
    gcs_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_type: Mapped[str] = mapped_column(String(100), nullable=False)
    filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    receipt: Mapped["Receipt"] = relationship("Receipt", back_populates="attachments")

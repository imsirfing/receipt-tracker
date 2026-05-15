import uuid
from datetime import date, datetime
from enum import Enum as PyEnum
from typing import List, Optional
from sqlalchemy import String, Numeric, Date, Boolean, DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class RecurringType(str, PyEnum):
    ONE_OFF = "one_off"
    ONGOING = "ongoing"

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
    raw_email_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    # Database relationships
    attachments: Mapped[List["Attachment"]] = relationship(
        "Attachment", back_populates="receipt", cascade="all, delete-orphan", lazy="selectin"
    )

    # Database query performance indices
    __table_args__ = (
        Index("idx_receipts_category_variable", "category_variable"),
        Index("idx_receipts_is_reimbursed", "is_reimbursed"),
        Index("idx_receipts_raw_email_id", "raw_email_id"),
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

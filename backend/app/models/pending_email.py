from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.receipt import Base


class PendingEmail(Base):
    __tablename__ = "pending_emails"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    gmail_message_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    subject: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    from_address: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    body_preview: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    category_variable: Mapped[str] = mapped_column(String(50), nullable=False, default="uncategorized")
    skip_reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    received_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

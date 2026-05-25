from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.receipt import Base


class PayeeAlias(Base):
    """Custom payee normalization rules managed by the owner."""
    __tablename__ = "payee_aliases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    pattern: Mapped[str] = mapped_column(String(500), nullable=False)
    canonical: Mapped[str] = mapped_column(String(255), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="true")
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

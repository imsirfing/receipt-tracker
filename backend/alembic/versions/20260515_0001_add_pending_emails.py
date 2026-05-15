"""add pending_emails table

Revision ID: 20260515_0001
Revises: 20260514_0002
Create Date: 2026-05-15
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "20260515_0001"
down_revision = "20260514_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pending_emails",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("gmail_message_id", sa.String(100), unique=True, nullable=False),
        sa.Column("subject", sa.String(500), nullable=False, server_default=""),
        sa.Column("from_address", sa.String(255), nullable=False, server_default=""),
        sa.Column("body_preview", sa.String(2000), nullable=False, server_default=""),
        sa.Column("category_variable", sa.String(50), nullable=False, server_default="uncategorized"),
        sa.Column("skip_reason", sa.String(500), nullable=False, server_default=""),
        sa.Column("received_date", sa.String(10), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("pending_emails")

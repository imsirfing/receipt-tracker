"""add payment_category and payment_detail columns

Revision ID: 20260514_0002
Revises: 20260514_0001
Create Date: 2026-05-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260514_0002"
down_revision = "20260514_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("receipts", sa.Column("payment_category", sa.String(length=100), nullable=True))
    op.add_column("receipts", sa.Column("payment_detail", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("receipts", "payment_detail")
    op.drop_column("receipts", "payment_category")

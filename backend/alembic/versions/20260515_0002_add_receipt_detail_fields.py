"""add receipt detail fields

Revision ID: 20260515_0002
Revises: 20260515_0001
Create Date: 2026-05-15
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260515_0002"
down_revision = "20260515_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("receipts", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("receipts", sa.Column("is_tax_deductible", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("receipts", sa.Column("reimbursement_owner", sa.String(100), nullable=True))
    op.add_column("attachments", sa.Column("filename", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("receipts", "notes")
    op.drop_column("receipts", "is_tax_deductible")
    op.drop_column("receipts", "reimbursement_owner")
    op.drop_column("attachments", "filename")

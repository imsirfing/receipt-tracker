"""add invoice_number to receipts

Revision ID: 20260728_0004
Revises: 20260728_0003
Create Date: 2026-07-28
"""

from alembic import op
import sqlalchemy as sa

revision = "20260728_0004"
down_revision = "20260728_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "receipts",
        sa.Column("invoice_number", sa.String(100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("receipts", "invoice_number")

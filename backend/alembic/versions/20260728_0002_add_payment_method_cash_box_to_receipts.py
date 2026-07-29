"""add payment_method and cash_box_id to receipts

Revision ID: 20260728_0002
Revises: 20260728_0001
Create Date: 2026-07-28
"""

from alembic import op
import sqlalchemy as sa

revision = "20260728_0002"
down_revision = "20260728_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE receipts ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20)")
    op.execute(
        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS cash_box_id UUID REFERENCES cash_box(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.drop_column("receipts", "cash_box_id")
    op.drop_column("receipts", "payment_method")

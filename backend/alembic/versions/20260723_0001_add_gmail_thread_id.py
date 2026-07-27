"""add gmail_thread_id to receipts

Revision ID: 20260723_0001
Revises: 20260525_0001
Create Date: 2026-07-23
"""

from alembic import op
import sqlalchemy as sa

revision = "20260723_0001"
down_revision = "20260525_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS — safe to re-run if column was added out-of-band
    op.execute(
        "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS gmail_thread_id VARCHAR(255)"
    )


def downgrade() -> None:
    op.drop_column("receipts", "gmail_thread_id")

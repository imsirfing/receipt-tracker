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
    op.add_column(
        "receipts",
        sa.Column("gmail_thread_id", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("receipts", "gmail_thread_id")

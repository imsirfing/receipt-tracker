"""expand body_preview to 10000 chars

Revision ID: 20260519_0001
Revises: 20260515_0002
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa

revision = "20260519_0001"
down_revision = "20260515_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "pending_emails",
        "body_preview",
        existing_type=sa.String(2000),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "pending_emails",
        "body_preview",
        existing_type=sa.Text(),
        type_=sa.String(2000),
        existing_nullable=False,
    )

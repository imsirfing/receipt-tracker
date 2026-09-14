"""widen statement_transactions.payee_raw to Text

Revision ID: 20260914_0002
Revises: 20260914_0001
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa

revision = "20260914_0002"
down_revision = "20260914_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "statement_transaction",
        "payee_raw",
        type_=sa.Text,
        existing_type=sa.String(255),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "statement_transaction",
        "payee_raw",
        type_=sa.String(255),
        existing_type=sa.Text,
        existing_nullable=False,
    )

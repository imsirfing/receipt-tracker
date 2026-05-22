"""add_reimbursement_report_fields: reimbursed_by, reimbursement_note, composite index

Revision ID: 20260522_0001
Revises: 20260520_0002
Create Date: 2026-05-22
"""
from alembic import op
import sqlalchemy as sa

revision = "20260522_0001"
down_revision = "20260520_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add reimbursed_by — who processed/approved the reimbursement
    op.add_column("receipts", sa.Column("reimbursed_by", sa.String(100), nullable=True))

    # Add reimbursement_note — free-text note about the reimbursement
    op.add_column("receipts", sa.Column("reimbursement_note", sa.Text, nullable=True))

    # Composite index for the unreimbursed report query: filters on is_reimbursed,
    # date range, and category_variable — dramatically speeds up the report endpoint
    op.create_index(
        "idx_receipts_reimbursed_date_category",
        "receipts",
        ["is_reimbursed", "date", "category_variable"],
    )


def downgrade() -> None:
    op.drop_index("idx_receipts_reimbursed_date_category", table_name="receipts")
    op.drop_column("receipts", "reimbursement_note")
    op.drop_column("receipts", "reimbursed_by")

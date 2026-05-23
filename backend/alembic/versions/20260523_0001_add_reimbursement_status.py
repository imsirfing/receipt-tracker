"""add_reimbursement_status: intermediate reimbursement state (none -> pending -> reimbursed)

Revision ID: 20260523_0001
Revises: 20260522_0001
Create Date: 2026-05-23
"""
from alembic import op
import sqlalchemy as sa

revision = "20260523_0001"
down_revision = "20260522_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add reimbursement_status — tracks the none -> pending -> reimbursed flow
    op.add_column(
        "receipts",
        sa.Column(
            "reimbursement_status",
            sa.String(20),
            nullable=False,
            server_default="none",
        ),
    )

    # Backfill: existing reimbursed receipts get the terminal status
    op.execute(
        "UPDATE receipts SET reimbursement_status = 'reimbursed' WHERE is_reimbursed = TRUE"
    )

    op.create_index(
        "idx_receipts_reimbursement_status",
        "receipts",
        ["reimbursement_status"],
    )


def downgrade() -> None:
    op.drop_index("idx_receipts_reimbursement_status", table_name="receipts")
    op.drop_column("receipts", "reimbursement_status")

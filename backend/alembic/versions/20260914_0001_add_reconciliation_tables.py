"""add reconciliation tables

Revision ID: 20260914_0001
Revises: 20260728_0005
Create Date: 2026-09-14
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260914_0001"
down_revision = "20260728_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # reconciliation_session
    op.create_table(
        "reconciliation_session",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("category_variable", sa.String(50), nullable=False),
        sa.Column("date_from", sa.Date(), nullable=False),
        sa.Column("date_to", sa.Date(), nullable=False),
        sa.Column("receipt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_amount_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="uploading"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # statement_transaction
    op.create_table(
        "statement_transaction",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_label", sa.String(100), nullable=True),
        sa.Column("account_type", sa.String(10), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("payee_raw", sa.String(255), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("is_credit", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("excluded", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["reconciliation_session.id"], ondelete="CASCADE"
        ),
    )
    op.create_index("idx_stmt_txn_session_id", "statement_transaction", ["session_id"])

    # reconciliation_match
    op.create_table(
        "reconciliation_match",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("receipt_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("statement_transaction_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("confidence", sa.String(10), nullable=True),
        sa.Column("amount_delta", sa.Numeric(10, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["reconciliation_session.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["receipt_id"], ["receipts.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["statement_transaction_id"], ["statement_transaction.id"], ondelete="CASCADE"
        ),
    )
    op.create_index("idx_recon_match_session_id", "reconciliation_match", ["session_id"])
    op.create_index("idx_recon_match_receipt_id", "reconciliation_match", ["receipt_id"])
    op.create_index("idx_recon_match_stmt_txn_id", "reconciliation_match", ["statement_transaction_id"])
    op.create_index("idx_recon_match_status", "reconciliation_match", ["status"])


def downgrade() -> None:
    op.drop_index("idx_recon_match_status", table_name="reconciliation_match")
    op.drop_index("idx_recon_match_stmt_txn_id", table_name="reconciliation_match")
    op.drop_index("idx_recon_match_receipt_id", table_name="reconciliation_match")
    op.drop_index("idx_recon_match_session_id", table_name="reconciliation_match")
    op.drop_table("reconciliation_match")

    op.drop_index("idx_stmt_txn_session_id", table_name="statement_transaction")
    op.drop_table("statement_transaction")

    op.drop_table("reconciliation_session")

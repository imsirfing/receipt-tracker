"""Add audit trail: receipt_audit_log table, soft-delete + source fields on receipts

Revision ID: 20260519_0002
Revises: 20260519_0001
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa

revision = "20260519_0002"
down_revision = "20260519_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Add columns to receipts ---
    op.add_column("receipts", sa.Column("source", sa.String(50), nullable=False, server_default="manual"))
    op.add_column("receipts", sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("receipts", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")))
    op.add_column("receipts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("receipts", sa.Column("deleted_reason", sa.Text, nullable=True))

    op.create_index("idx_receipts_deleted_at", "receipts", ["deleted_at"])

    # --- Create receipt_audit_log table ---
    op.create_table(
        "receipt_audit_log",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("receipt_id", sa.UUID(as_uuid=True), sa.ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("event_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("actor", sa.String(100), nullable=False, server_default="james"),
        sa.Column("fields_changed", sa.JSON, nullable=True),
        sa.Column("snapshot_before", sa.JSON, nullable=True),
        sa.Column("snapshot_after", sa.JSON, nullable=True),
        sa.Column("edit_reason", sa.Text, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
    )
    op.create_index("idx_audit_log_receipt_id", "receipt_audit_log", ["receipt_id"])
    op.create_index("idx_audit_log_event_at", "receipt_audit_log", ["event_at"])


def downgrade() -> None:
    op.drop_index("idx_audit_log_event_at", table_name="receipt_audit_log")
    op.drop_index("idx_audit_log_receipt_id", table_name="receipt_audit_log")
    op.drop_table("receipt_audit_log")

    op.drop_index("idx_receipts_deleted_at", table_name="receipts")
    op.drop_column("receipts", "deleted_reason")
    op.drop_column("receipts", "deleted_at")
    op.drop_column("receipts", "updated_at")
    op.drop_column("receipts", "ingested_at")
    op.drop_column("receipts", "source")

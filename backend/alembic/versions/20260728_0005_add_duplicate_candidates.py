"""add duplicate_candidate table

Revision ID: 20260728_0005
Revises: 20260728_0004
Create Date: 2026-07-28
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260728_0005"
down_revision = "20260728_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "duplicate_candidate",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("receipt_id_a", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("receipt_id_b", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("match_reason", sa.String(50), nullable=False),
        sa.Column("confidence", sa.String(10), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending_review"),
        sa.Column("merged_into_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["receipt_id_a"], ["receipts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["receipt_id_b"], ["receipts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["merged_into_id"], ["receipts.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_dup_candidate_receipt_a", "duplicate_candidate", ["receipt_id_a"])
    op.create_index("idx_dup_candidate_receipt_b", "duplicate_candidate", ["receipt_id_b"])
    op.create_index("idx_dup_candidate_status", "duplicate_candidate", ["status"])


def downgrade() -> None:
    op.drop_index("idx_dup_candidate_status", table_name="duplicate_candidate")
    op.drop_index("idx_dup_candidate_receipt_b", table_name="duplicate_candidate")
    op.drop_index("idx_dup_candidate_receipt_a", table_name="duplicate_candidate")
    op.drop_table("duplicate_candidate")

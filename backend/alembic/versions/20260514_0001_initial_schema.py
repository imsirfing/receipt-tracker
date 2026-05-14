"""initial_schema

Revision ID: 20260514_0001
Revises:
Create Date: 2026-05-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260514_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    recurring_type_enum = sa.Enum("one_off", "ongoing", name="recurring_type_enum")
    recurring_type_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "receipts",
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
        sa.Column("payee", sa.String(length=255), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("inferred_purpose", sa.String(length=1000), nullable=True),
        sa.Column("category_variable", sa.String(length=50), nullable=False),
        sa.Column(
            "recurring_type",
            sa.Enum("one_off", "ongoing", name="recurring_type_enum", create_type=False),
            nullable=False,
            server_default="one_off",
        ),
        sa.Column("is_reimbursed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("reimbursed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_email_id", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("raw_email_id", name="uq_receipts_raw_email_id"),
    )
    op.create_index("idx_receipts_category_variable", "receipts", ["category_variable"])
    op.create_index("idx_receipts_is_reimbursed", "receipts", ["is_reimbursed"])
    op.create_index("idx_receipts_raw_email_id", "receipts", ["raw_email_id"])

    op.create_table(
        "attachments",
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
        sa.Column("receipt_id", sa.UUID(), nullable=False),
        sa.Column("gcs_uri", sa.String(length=1024), nullable=False),
        sa.Column("file_type", sa.String(length=100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["receipt_id"], ["receipts.id"], ondelete="CASCADE"),
    )


def downgrade() -> None:
    op.drop_table("attachments")
    op.drop_index("idx_receipts_raw_email_id", table_name="receipts")
    op.drop_index("idx_receipts_is_reimbursed", table_name="receipts")
    op.drop_index("idx_receipts_category_variable", table_name="receipts")
    op.drop_table("receipts")
    sa.Enum(name="recurring_type_enum").drop(op.get_bind(), checkfirst=True)

"""payee normalization: payee_aliases table + canonical_payee on receipts

Revision ID: 20260525_0001
Revises: 20260523_0001
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa

revision = "20260525_0001"
down_revision = "20260523_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payee_aliases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("pattern", sa.String(500), nullable=False),
        sa.Column("canonical", sa.String(255), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column(
        "receipts",
        sa.Column("canonical_payee", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("receipts", "canonical_payee")
    op.drop_table("payee_aliases")

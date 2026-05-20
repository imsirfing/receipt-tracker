"""user_access table

Revision ID: 20260520_0001
Revises: 20260519_0002
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as pg

revision = "20260520_0001"
down_revision = "20260519_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_access",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="read"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_user_access_email", "user_access", ["email"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_user_access_email", table_name="user_access")
    op.drop_table("user_access")

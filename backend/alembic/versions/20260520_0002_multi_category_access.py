"""multi_category_access: one row per email+category

Revision ID: 20260520_0002
Revises: 20260520_0001
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa

revision = "20260520_0002"
down_revision = "20260520_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old unique index on email (was created as ix_user_access_email with unique=True)
    op.drop_index("ix_user_access_email", table_name="user_access")

    # Re-create as a non-unique index on email (for fast lookups)
    op.create_index("idx_user_access_email", "user_access", ["email"], unique=False)

    # Add composite unique constraint on (email, category)
    op.create_unique_constraint(
        "uq_user_access_email_category",
        "user_access",
        ["email", "category"],
    )


def downgrade() -> None:
    # Remove composite unique constraint
    op.drop_constraint("uq_user_access_email_category", "user_access", type_="unique")

    # Remove the non-unique email index
    op.drop_index("idx_user_access_email", table_name="user_access")

    # Restore the original unique index on email
    op.create_index("ix_user_access_email", "user_access", ["email"], unique=True)

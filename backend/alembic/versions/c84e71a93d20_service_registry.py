"""Add workspace-scoped service registry."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c84e71a93d20"
down_revision: Union[str, None] = "b0a21a8413c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "services",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("service_key", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=2000), nullable=True),
        sa.Column("owner_team", sa.String(length=160), nullable=True),
        sa.Column("environment", sa.String(length=80), nullable=True),
        sa.Column("repository_url", sa.String(length=2048), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "archived", name="service_status", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_service_name_nonempty"),
        sa.CheckConstraint("length(trim(service_key)) > 0", name="ck_service_key_nonempty"),
        sa.CheckConstraint("service_key = lower(service_key)", name="ck_service_key_lowercase"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "id", name="uq_service_workspace_id"),
        sa.UniqueConstraint("workspace_id", "service_key", name="uq_service_workspace_key"),
    )
    op.create_index(
        "ix_service_workspace_status_name",
        "services",
        ["workspace_id", "status", "name", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_service_workspace_status_name", table_name="services")
    op.drop_table("services")

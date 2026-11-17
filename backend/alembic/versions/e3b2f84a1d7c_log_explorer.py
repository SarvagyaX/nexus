"""Add workspace-scoped log records.

Revision ID: e3b2f84a1d7c
Revises: d7f4c12a9b60
Create Date: 2026-11-14 21:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "e3b2f84a1d7c"
down_revision: Union[str, None] = "d7f4c12a9b60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "log_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("service_id", sa.Uuid(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "severity",
            sa.Enum("DEBUG", "INFO", "WARN", "ERROR", "FATAL", name="log_severity", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("trace_id", sa.String(length=64), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("attributes", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(trim(message)) > 0", name="ck_log_record_message_nonempty"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "service_id"],
            ["services.workspace_id", "services.id"],
            name="fk_log_record_workspace_service",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "id", name="uq_log_record_workspace_id"),
    )
    op.create_index(
        "ix_log_record_workspace_timestamp_id",
        "log_records",
        ["workspace_id", "timestamp", "id"],
        unique=False,
    )
    op.create_index(
        "ix_log_record_workspace_service_timestamp",
        "log_records",
        ["workspace_id", "service_id", "timestamp", "id"],
        unique=False,
    )
    op.create_index(
        "ix_log_record_workspace_severity_timestamp",
        "log_records",
        ["workspace_id", "severity", "timestamp", "id"],
        unique=False,
    )
    op.create_index(
        "ix_log_record_workspace_trace_timestamp",
        "log_records",
        ["workspace_id", "trace_id", "timestamp"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_log_record_workspace_trace_timestamp", table_name="log_records")
    op.drop_index("ix_log_record_workspace_severity_timestamp", table_name="log_records")
    op.drop_index("ix_log_record_workspace_service_timestamp", table_name="log_records")
    op.drop_index("ix_log_record_workspace_timestamp_id", table_name="log_records")
    op.drop_table("log_records")

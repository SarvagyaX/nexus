"""Add real-time alert rules, alerts, and alert events tables.

Revision ID: a5b8c3d1e2f4
Revises: f4c18a2d9e3b
Create Date: 2026-11-14 22:42:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a5b8c3d1e2f4"
down_revision: Union[str, None] = "f4c18a2d9e3b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. alert_rules
    op.create_table(
        "alert_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("service_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "severity",
            sa.Enum("SEV1", "SEV2", "SEV3", "SEV4", name="incident_severity", native_enum=False, create_constraint=False),
            nullable=False,
            server_default="SEV2",
        ),
        sa.Column(
            "condition_type",
            sa.Enum("error_count", "fatal_log", "error_rate", "repeated_failures", name="alert_rule_condition", native_enum=False, create_constraint=True),
            nullable=False,
            server_default="error_count",
        ),
        sa.Column("threshold", sa.Float(), nullable=False, server_default="5.0"),
        sa.Column("window_minutes", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("cooldown_minutes", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "service_id"],
            ["services.workspace_id", "services.id"],
            name="fk_alert_rule_workspace_service",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "id", name="uq_alert_rule_workspace_id"),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_alert_rule_name_nonempty"),
        sa.CheckConstraint("threshold > 0", name="ck_alert_rule_threshold_positive"),
        sa.CheckConstraint("window_minutes >= 1 AND window_minutes <= 1440", name="ck_alert_rule_window_valid"),
        sa.CheckConstraint("cooldown_minutes >= 1 AND cooldown_minutes <= 1440", name="ck_alert_rule_cooldown_valid"),
    )
    op.create_index(
        "ix_alert_rule_workspace_enabled",
        "alert_rules",
        ["workspace_id", "enabled"],
        unique=False,
    )
    op.create_index(
        "ix_alert_rule_workspace_service",
        "alert_rules",
        ["workspace_id", "service_id"],
        unique=False,
    )

    # 2. alerts
    op.create_table(
        "alerts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("rule_id", sa.Uuid(), nullable=True),
        sa.Column("service_id", sa.Uuid(), nullable=True),
        sa.Column("incident_id", sa.Uuid(), nullable=True),
        sa.Column("fingerprint", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "severity",
            sa.Enum("SEV1", "SEV2", "SEV3", "SEV4", name="incident_severity", native_enum=False, create_constraint=False),
            nullable=False,
            server_default="SEV2",
        ),
        sa.Column(
            "status",
            sa.Enum("open", "acknowledged", "snoozed", "resolved", name="alert_status", native_enum=False, create_constraint=True),
            nullable=False,
            server_default="open",
        ),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "rule_id"],
            ["alert_rules.workspace_id", "alert_rules.id"],
            name="fk_alert_workspace_rule",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "service_id"],
            ["services.workspace_id", "services.id"],
            name="fk_alert_workspace_service",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "incident_id"],
            ["incidents.workspace_id", "incidents.id"],
            name="fk_alert_workspace_incident",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["acknowledged_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "id", name="uq_alert_workspace_id"),
        sa.CheckConstraint("length(trim(title)) > 0", name="ck_alert_title_nonempty"),
        sa.CheckConstraint("occurrence_count >= 1", name="ck_alert_occurrence_count_positive"),
    )
    op.create_index(
        "ix_alert_workspace_status_last_seen",
        "alerts",
        ["workspace_id", "status", "last_seen_at"],
        unique=False,
    )
    op.create_index(
        "ix_alert_workspace_severity_last_seen",
        "alerts",
        ["workspace_id", "severity", "last_seen_at"],
        unique=False,
    )
    op.create_index(
        "ix_alert_workspace_fingerprint",
        "alerts",
        ["workspace_id", "fingerprint"],
        unique=False,
    )
    op.create_index(
        "ix_alert_workspace_service_status",
        "alerts",
        ["workspace_id", "service_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_alert_workspace_incident",
        "alerts",
        ["workspace_id", "incident_id"],
        unique=False,
    )

    # 3. alert_events
    op.create_table(
        "alert_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("alert_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "alert_id"],
            ["alerts.workspace_id", "alerts.id"],
            name="fk_alert_event_workspace_alert",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "id", name="uq_alert_event_workspace_id"),
    )
    op.create_index(
        "ix_alert_event_workspace_alert_created",
        "alert_events",
        ["workspace_id", "alert_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("alert_events")
    op.drop_table("alerts")
    op.drop_table("alert_rules")

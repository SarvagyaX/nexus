"""Workflow automation and playbook engine.

Revision ID: c9d3e5f2a1b4
Revises: b7c2d4e8f1a3
Create Date: 2026-11-16 11:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "c9d3e5f2a1b4"
down_revision: Union[str, None] = "b7c2d4e8f1a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. playbooks
    op.create_table(
        "playbooks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=64), nullable=False, server_default="general"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("trigger_type", sa.String(length=50), nullable=False, server_default="manual"),
        sa.Column("trigger_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("severity_applicability", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("is_template", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("template_id", sa.String(length=80), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("execution_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_playbooks_workspace_status", "playbooks", ["workspace_id", "status"])
    op.create_index("ix_playbooks_workspace_trigger", "playbooks", ["workspace_id", "trigger_type"])

    # 2. playbook_steps
    op.create_table(
        "playbook_steps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("playbook_id", sa.Uuid(), nullable=False),
        sa.Column("step_order", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("action_type", sa.String(length=50), nullable=False),
        sa.Column("action_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("continue_on_failure", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["playbook_id"], ["playbooks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_playbook_steps_playbook_order", "playbook_steps", ["playbook_id", "step_order"])

    # 3. playbook_executions
    op.create_table(
        "playbook_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("playbook_id", sa.Uuid(), nullable=False),
        sa.Column("trigger_type", sa.String(length=50), nullable=False, server_default="manual"),
        sa.Column("trigger_event_id", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("incident_id", sa.Uuid(), nullable=True),
        sa.Column("alert_id", sa.Uuid(), nullable=True),
        sa.Column("triggered_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("current_step_order", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("context", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["alert_id"], ["alerts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["playbook_id"], ["playbooks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["triggered_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_playbook_executions_workspace_status", "playbook_executions", ["workspace_id", "status"])
    op.create_index("ix_playbook_executions_playbook", "playbook_executions", ["playbook_id"])
    op.create_index("ix_playbook_executions_dedup", "playbook_executions", ["workspace_id", "playbook_id", "trigger_event_id"])

    # 4. playbook_step_executions
    op.create_table(
        "playbook_step_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("execution_id", sa.Uuid(), nullable=False),
        sa.Column("step_id", sa.Uuid(), nullable=True),
        sa.Column("step_order", sa.Integer(), nullable=False),
        sa.Column("step_name", sa.String(length=200), nullable=False),
        sa.Column("action_type", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("input_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("output_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["execution_id"], ["playbook_executions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["step_id"], ["playbook_steps.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_playbook_step_executions_exec_order", "playbook_step_executions", ["execution_id", "step_order"])

    # 5. playbook_approval_requests
    op.create_table(
        "playbook_approval_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("execution_id", sa.Uuid(), nullable=False),
        sa.Column("step_execution_id", sa.Uuid(), nullable=False),
        sa.Column("prompt", sa.String(length=1000), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("approver_user_id", sa.Uuid(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["approver_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["execution_id"], ["playbook_executions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["step_execution_id"], ["playbook_step_executions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_playbook_approval_requests_exec_status", "playbook_approval_requests", ["execution_id", "status"])


def downgrade() -> None:
    op.drop_table("playbook_approval_requests")
    op.drop_table("playbook_step_executions")
    op.drop_table("playbook_executions")
    op.drop_table("playbook_steps")
    op.drop_table("playbooks")

"""Add workspace-scoped incident management and append-only timeline."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "d7f4c12a9b60"
down_revision: Union[str, None] = "c84e71a93d20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workspace_incident_counters",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("last_value", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("last_value >= 0", name="ck_incident_counter_nonnegative"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("workspace_id"),
    )
    op.create_table(
        "incidents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("service_id", sa.Uuid(), nullable=False),
        sa.Column("reference", sa.String(32), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("summary", sa.String(4000)),
        sa.Column("severity", sa.Enum("SEV1", "SEV2", "SEV3", "SEV4", name="incident_severity", native_enum=False, create_constraint=True), nullable=False),
        sa.Column("status", sa.Enum("open", "investigating", "monitoring", "resolved", name="incident_status", native_enum=False, create_constraint=True), nullable=False),
        sa.Column("severity_source", sa.Enum("human", "agent", "demo", name="severity_source", native_enum=False, create_constraint=True), nullable=False),
        sa.Column("assignee_user_id", sa.Uuid()),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolution_summary", sa.String(4000)),
        sa.Column("created_by_user_id", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("length(trim(title)) > 0", name="ck_incident_title_nonempty"),
        sa.CheckConstraint("length(trim(reference)) > 0", name="ck_incident_reference_nonempty"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workspace_id", "service_id"], ["services.workspace_id", "services.id"], name="fk_incident_workspace_service", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workspace_id", "assignee_user_id"], ["workspace_memberships.workspace_id", "workspace_memberships.user_id"], name="fk_incident_workspace_assignee", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "reference", name="uq_incident_workspace_reference"),
        sa.UniqueConstraint("workspace_id", "id", name="uq_incident_workspace_id"),
    )
    op.create_index("ix_incident_workspace_status_detected", "incidents", ["workspace_id", "status", "detected_at", "id"])
    op.create_index("ix_incident_workspace_service_detected", "incidents", ["workspace_id", "service_id", "detected_at", "id"])
    op.create_index("ix_incident_workspace_assignee_status", "incidents", ["workspace_id", "assignee_user_id", "status"])
    op.create_table(
        "incident_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("incident_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid()),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("body", sa.String(4000)),
        sa.Column("payload", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workspace_id", "incident_id"], ["incidents.workspace_id", "incidents.id"], name="fk_incident_event_workspace_incident", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_incident_event_workspace_incident_created", "incident_events", ["workspace_id", "incident_id", "created_at", "id"])
    op.execute("""
        CREATE FUNCTION prevent_incident_event_mutation() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'incident timeline events are append-only'; END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER trg_incident_events_append_only
        BEFORE UPDATE OR DELETE ON incident_events
        FOR EACH ROW EXECUTE FUNCTION prevent_incident_event_mutation()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_incident_events_append_only ON incident_events")
    op.execute("DROP FUNCTION IF EXISTS prevent_incident_event_mutation()")
    op.drop_index("ix_incident_event_workspace_incident_created", table_name="incident_events")
    op.drop_table("incident_events")
    op.drop_index("ix_incident_workspace_assignee_status", table_name="incidents")
    op.drop_index("ix_incident_workspace_service_detected", table_name="incidents")
    op.drop_index("ix_incident_workspace_status_detected", table_name="incidents")
    op.drop_table("incidents")
    op.drop_table("workspace_incident_counters")

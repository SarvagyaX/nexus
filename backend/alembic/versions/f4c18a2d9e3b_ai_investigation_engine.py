"""Add agentic AI investigation tables.

Revision ID: f4c18a2d9e3b
Revises: e3b2f84a1d7c
Create Date: 2026-11-14 21:25:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "f4c18a2d9e3b"
down_revision: Union[str, None] = "e3b2f84a1d7c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. investigations
    op.create_table(
        "investigations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("incident_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "running", "completed", "failed", name="investigation_status", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("confidence_score", sa.Float(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "incident_id"],
            ["incidents.workspace_id", "incidents.id"],
            name="fk_investigation_workspace_incident",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "id", name="uq_investigation_workspace_id"),
    )
    op.create_index(
        "ix_investigation_workspace_status_created",
        "investigations",
        ["workspace_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_investigation_workspace_incident_created",
        "investigations",
        ["workspace_id", "incident_id", "created_at"],
        unique=False,
    )

    # 2. investigation_evidence
    op.create_table(
        "investigation_evidence",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("investigation_id", sa.Uuid(), nullable=False),
        sa.Column(
            "evidence_type",
            sa.Enum("log", "incident", "service", "metric", name="evidence_type", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("data", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "investigation_id"],
            ["investigations.workspace_id", "investigations.id"],
            name="fk_evidence_workspace_investigation",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "id", name="uq_investigation_evidence_workspace_id"),
    )
    op.create_index(
        "ix_evidence_workspace_investigation_collected",
        "investigation_evidence",
        ["workspace_id", "investigation_id", "collected_at"],
        unique=False,
    )

    # 3. investigation_hypotheses
    op.create_table(
        "investigation_hypotheses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("investigation_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("likelihood", sa.String(length=32), nullable=False),
        sa.Column("confidence_score", sa.Float(), nullable=False),
        sa.Column("supporting_evidence", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("contradicting_evidence", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "investigation_id"],
            ["investigations.workspace_id", "investigations.id"],
            name="fk_hypothesis_workspace_investigation",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "id", name="uq_investigation_hypothesis_workspace_id"),
    )
    op.create_index(
        "ix_hypothesis_workspace_investigation_primary",
        "investigation_hypotheses",
        ["workspace_id", "investigation_id", "is_primary"],
        unique=False,
    )

    # 4. investigation_recommendations
    op.create_table(
        "investigation_recommendations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("investigation_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("action_type", sa.String(length=64), nullable=False),
        sa.Column("priority", sa.String(length=16), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending_approval", "approved", "rejected", name="recommendation_status", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("reviewed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "investigation_id"],
            ["investigations.workspace_id", "investigations.id"],
            name="fk_recommendation_workspace_investigation",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "id", name="uq_investigation_recommendation_workspace_id"),
    )
    op.create_index(
        "ix_recommendation_workspace_investigation_status",
        "investigation_recommendations",
        ["workspace_id", "investigation_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_recommendation_workspace_investigation_status", table_name="investigation_recommendations")
    op.drop_table("investigation_recommendations")
    op.drop_index("ix_hypothesis_workspace_investigation_primary", table_name="investigation_hypotheses")
    op.drop_table("investigation_hypotheses")
    op.drop_index("ix_evidence_workspace_investigation_collected", table_name="investigation_evidence")
    op.drop_table("investigation_evidence")
    op.drop_index("ix_investigation_workspace_incident_created", table_name="investigations")
    op.drop_index("ix_investigation_workspace_status_created", table_name="investigations")
    op.drop_table("investigations")

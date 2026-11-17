"""Comprehensive tests for Agentic AI Investigation Engine (Milestone 7)."""

import asyncio
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.ai.provider import MockLLMClient, OllamaClient, LLMProviderStatus
from app.ai.service import decode_investigation_cursor, encode_investigation_cursor
from app.ai.workflow import (
    InvestigationState,
    build_investigation_graph,
    collector_node,
    hypothesis_evaluator_node,
    hypothesis_generator_node,
    impact_analyzer_node,
    log_analyzer_node,
    planner_node,
    recommendation_engine_node,
    summary_generator_node,
)
from app.models.identity import Membership, User, UserStatus, WorkspaceRole
from app.models.incident import Incident, IncidentSeverity, IncidentStatus
from app.models.investigation import (
    Investigation,
    InvestigationStatus,
    RecommendationStatus,
)
from app.models.log import LogRecord, LogSeverity
from app.models.service import Service, ServiceStatus
from app.schemas.investigation import (
    InvestigationCreate,
    RecommendationReviewRequest,
)


def _client(auth_environment, login):
    client = auth_environment["client"]
    response = login()
    client.headers.update(
        {
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": response.json()["csrf_token"],
        }
    )
    return client


def _create_service(auth_environment, name="checkout-service", key=None):
    key = key or f"svc-{uuid4().hex[:8]}"
    with auth_environment["factory"]() as db:
        service = Service(
            workspace_id=auth_environment["workspace_id"],
            name=name,
            service_key=key,
            status=ServiceStatus.ACTIVE,
        )
        db.add(service)
        db.commit()
        return service.id


def _create_incident(auth_environment, service_id, title="Checkout Failure Spike", severity=IncidentSeverity.SEV1):
    with auth_environment["factory"]() as db:
        incident = Incident(
            workspace_id=auth_environment["workspace_id"],
            service_id=service_id,
            reference=f"INC-{uuid4().hex[:4].upper()}",
            title=title,
            summary="Multiple customers reporting payment timeouts at checkout step.",
            severity=severity,
            status=IncidentStatus.INVESTIGATING,
            detected_at=datetime.now(timezone.utc),
        )
        db.add(incident)
        db.commit()
        return incident.id


# ============================================================================
# 1. Schemas & Cursor Unit Tests
# ============================================================================

def test_investigation_schemas_validation():
    inc_id = uuid4()
    req = InvestigationCreate(incident_id=inc_id)
    assert req.incident_id == inc_id

    # Reject unexpected fields
    with pytest.raises(ValidationError):
        InvestigationCreate(incident_id=inc_id, invalid_field="forbidden")

    review = RecommendationReviewRequest(status=RecommendationStatus.APPROVED, review_notes="LGTM")
    assert review.status == RecommendationStatus.APPROVED
    assert review.review_notes == "LGTM"


def test_investigation_cursor_encoding():
    inv_id = uuid4()
    now = datetime(2026, 11, 14, 16, 0, 0, tzinfo=timezone.utc)
    mock_inv = Investigation(id=inv_id, created_at=now)
    cursor = encode_investigation_cursor(mock_inv)
    assert isinstance(cursor, str)

    decoded = decode_investigation_cursor(cursor)
    assert decoded is not None
    ts, dec_id = decoded
    assert ts == now
    assert dec_id == inv_id
    assert decode_investigation_cursor(None) is None


# ============================================================================
# 2. LangGraph Workflow Node Unit Tests
# ============================================================================

def test_workflow_nodes_and_execution():
    async def _run():
        state: InvestigationState = {
            "workspace_id": str(uuid4()),
            "incident_id": str(uuid4()),
            "incident": {
                "id": str(uuid4()),
                "title": "Database connection pool saturated",
                "summary": "Application failing to acquire PostgreSQL connection",
                "severity": "SEV1",
                "status": "investigating",
                "detected_at": datetime.now(timezone.utc).isoformat(),
            },
            "service": {
                "id": str(uuid4()),
                "name": "order-api",
                "slug": "order-api",
                "tier": "tier_1",
                "health_status": "degraded",
            },
            "raw_logs": [
                {
                    "id": str(uuid4()),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "severity": "ERROR",
                    "message": "ConnectionRefused: pool exhaustion on db host",
                    "trace_id": "tr-pool-01",
                    "attributes": {},
                },
                {
                    "id": str(uuid4()),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "severity": "ERROR",
                    "message": "HTTP 500: Database timeout after 30000ms",
                    "trace_id": "tr-pool-01",
                    "attributes": {},
                },
            ],
            "timeline_events": [
                {
                    "id": str(uuid4()),
                    "event_type": "status_changed",
                    "message": "Incident transitioned to investigating",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ],
            "related_incidents": [],
        }

        # 1. Planner
        p_res = planner_node(state)
        assert "plan" in p_res
        state.update(p_res)

        # 2. Collector
        c_res = collector_node(state)
        assert len(c_res["evidence"]) >= 3
        state.update(c_res)

        # 3. Log Analyzer
        l_res = log_analyzer_node(state)
        assert l_res["log_analysis"]["error_count"] == 2
        assert "tr-pool-01" in l_res["log_analysis"]["correlated_trace_ids"]
        state.update(l_res)

        # 4. Hypothesis Generator
        mock_llm = MockLLMClient()
        h_res = await hypothesis_generator_node(state, mock_llm)
        assert len(h_res["hypotheses"]) >= 2
        state.update(h_res)

        # 5. Hypothesis Evaluator
        e_res = hypothesis_evaluator_node(state)
        assert e_res["confidence_score"] > 0.5
        assert any(h["is_primary"] for h in e_res["hypotheses"])
        state.update(e_res)

        # 6. Impact Analyzer
        i_res = impact_analyzer_node(state)
        assert "order-api" in i_res["impact"]["affected_services"]
        state.update(i_res)

        # 7. Recommendation Engine
        r_res = recommendation_engine_node(state)
        assert len(r_res["recommendations"]) == 3
        assert r_res["recommendations"][0]["status"] == "pending_approval"
        state.update(r_res)

        # 8. Summary Generator
        s_res = summary_generator_node(state)
        assert "Primary Root Cause" in s_res["summary"]
        state.update(s_res)

        # Test compiled LangGraph execution
        graph = build_investigation_graph(mock_llm)
        compiled_result = await graph.ainvoke(state)
        assert compiled_result.get("error") is None
        assert "summary" in compiled_result
        assert len(compiled_result["recommendations"]) == 3

    asyncio.run(_run())


# ============================================================================
# 3. Provider Availability and Explicit Failure Tests
# ============================================================================

def test_ollama_unavailable_reports_explicit_status():
    async def _run():
        # Points to non-existent local port
        client = OllamaClient(base_url="http://127.0.0.1:59999", model="llama3.2")
        status = await client.check_health()
        assert not status.is_available
        assert "unreachable" in status.message.lower()

    asyncio.run(_run())


def test_provider_status_api(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    res = client.get(f"/api/v1/workspaces/{workspace_id}/investigations/provider-status")
    assert res.status_code == 200
    data = res.json()
    assert "provider" in data
    assert "is_available" in data


# ============================================================================
# 4. Investigation API Flow Tests (Create, Detail, List, Review, Retry)
# ============================================================================

def test_full_investigation_lifecycle(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment, name="billing-service")
    incident_id = _create_incident(auth_environment, service_id, title="Recurring 504 Gateway Timeouts")

    # Seed some logs for this service
    with auth_environment["factory"]() as db:
        db.add(
            LogRecord(
                workspace_id=workspace_id,
                service_id=service_id,
                timestamp=datetime.now(timezone.utc),
                severity=LogSeverity.ERROR,
                message="Gateway timeout connecting to payment vault",
                trace_id="tr-test-001",
            )
        )
        db.commit()

    # 1. Start Investigation
    start_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/investigations",
        json={"incident_id": str(incident_id)},
    )
    assert start_res.status_code == 201, start_res.text
    inv_data = start_res.json()
    inv_id = inv_data["id"]

    assert inv_data["status"] == "completed"
    assert inv_data["confidence_score"] is not None
    assert inv_data["incident_title"] == "Recurring 504 Gateway Timeouts"
    assert len(inv_data["evidence"]) >= 2
    assert len(inv_data["hypotheses"]) >= 2
    assert len(inv_data["recommendations"]) == 3

    # Primary hypothesis is identified
    primary_hyp = next(h for h in inv_data["hypotheses"] if h["is_primary"])
    assert primary_hyp["likelihood"] in {"high", "medium"}

    # 2. Get Detail
    detail_res = client.get(f"/api/v1/workspaces/{workspace_id}/investigations/{inv_id}")
    assert detail_res.status_code == 200
    assert detail_res.json()["id"] == inv_id

    # 3. List Investigations
    list_res = client.get(f"/api/v1/workspaces/{workspace_id}/investigations")
    assert list_res.status_code == 200
    items = list_res.json()["items"]
    assert any(item["id"] == inv_id for item in items)

    # 4. Human-in-the-loop Recommendation Review (Approve)
    rec = inv_data["recommendations"][0]
    rec_id = rec["id"]
    assert rec["status"] == "pending_approval"

    approve_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/investigations/{inv_id}/recommendations/{rec_id}/review",
        json={"status": "approved", "review_notes": "Approved by On-Call Commander"},
    )
    assert approve_res.status_code == 200
    assert approve_res.json()["status"] == "approved"
    assert approve_res.json()["review_notes"] == "Approved by On-Call Commander"

    # Reject second recommendation
    rec_2_id = inv_data["recommendations"][1]["id"]
    reject_res = client.post(
        f"/api/v1/workspaces/{workspace_id}/investigations/{inv_id}/recommendations/{rec_2_id}/review",
        json={"status": "rejected", "review_notes": "Not applicable in current environment"},
    )
    assert reject_res.status_code == 200
    assert reject_res.json()["status"] == "rejected"

    # 5. Retry Investigation
    retry_res = client.post(f"/api/v1/workspaces/{workspace_id}/investigations/{inv_id}/retry")
    assert retry_res.status_code == 200
    assert retry_res.json()["status"] == "completed"


# ============================================================================
# 5. RBAC & Workspace Isolation Tests
# ============================================================================

def test_rbac_investigation_permissions(auth_environment):
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment)
    incident_id = _create_incident(auth_environment, service_id)

    # Verify RBAC permission mappings
    from app.security.rbac import ROLE_PERMISSIONS, Permission
    assert Permission.INVESTIGATION_START not in ROLE_PERMISSIONS[WorkspaceRole.VIEWER]
    assert Permission.RECOMMENDATION_APPROVE not in ROLE_PERMISSIONS[WorkspaceRole.VIEWER]
    assert Permission.INVESTIGATION_START in ROLE_PERMISSIONS[WorkspaceRole.RESPONDER]
    assert Permission.RECOMMENDATION_APPROVE not in ROLE_PERMISSIONS[WorkspaceRole.RESPONDER]
    assert Permission.RECOMMENDATION_APPROVE in ROLE_PERMISSIONS[WorkspaceRole.COMMANDER]
    assert Permission.RECOMMENDATION_APPROVE in ROLE_PERMISSIONS[WorkspaceRole.ADMIN]


def test_investigation_workspace_isolation(auth_environment, login):
    client = _client(auth_environment, login)
    workspace_id = auth_environment["workspace_id"]
    service_id = _create_service(auth_environment)
    incident_id = _create_incident(auth_environment, service_id)

    # Create investigation in workspace 1
    res = client.post(
        f"/api/v1/workspaces/{workspace_id}/investigations",
        json={"incident_id": str(incident_id)},
    )
    assert res.status_code == 201
    inv_id = res.json()["id"]

    # Query from completely different workspace
    other_workspace_id = uuid4()
    other_res = client.get(f"/api/v1/workspaces/{other_workspace_id}/investigations/{inv_id}")
    # Must be 403 or 404
    assert other_res.status_code in {403, 404}

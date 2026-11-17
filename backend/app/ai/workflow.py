"""LangGraph agentic AI investigation workflow with 8 modular nodes."""

from datetime import datetime, timezone
import re
from typing import Any
from typing_extensions import TypedDict

from langgraph.graph import StateGraph, START, END

from app.ai.provider import BaseLLMClient, MockLLMClient


class InvestigationState(TypedDict, total=False):
    workspace_id: str
    incident_id: str
    incident: dict[str, Any]
    service: dict[str, Any] | None
    raw_logs: list[dict[str, Any]]
    timeline_events: list[dict[str, Any]]
    related_incidents: list[dict[str, Any]]
    plan: dict[str, Any]
    evidence: list[dict[str, Any]]
    log_analysis: dict[str, Any]
    hypotheses: list[dict[str, Any]]
    impact: dict[str, Any]
    recommendations: list[dict[str, Any]]
    summary: str
    confidence_score: float
    error: str | None


def planner_node(state: InvestigationState) -> dict[str, Any]:
    """Node 1: Investigation Planner - determines evidence scope and search strategy."""
    incident = state.get("incident", {})
    service = state.get("service")
    severity = incident.get("severity", "SEV3")

    plan = {
        "strategy": f"Grounded multi-source root-cause investigation for {severity} incident",
        "focus_areas": [
            "Log pattern and anomaly detection within incident detection window",
            "Service operational health, dependencies, and tier status",
            "Timeline audit event transitions",
            "Cross-service correlation and blast radius estimation",
        ],
        "target_service": service.get("name") if service else "Unknown Service",
        "service_tier": service.get("tier") if service else "N/A",
        "log_window_minutes": 60 if severity in {"SEV1", "SEV2"} else 30,
        "planned_hypotheses_target": 2,
    }
    return {"plan": plan}


def collector_node(state: InvestigationState) -> dict[str, Any]:
    """Node 2: Evidence Collector - structures observed facts from logs, service, and incident."""
    incident = state.get("incident", {})
    service = state.get("service")
    raw_logs = state.get("raw_logs", [])
    timeline_events = state.get("timeline_events", [])
    related_incidents = state.get("related_incidents", [])

    evidence: list[dict[str, Any]] = []

    # 1. Incident Context Evidence
    evidence.append({
        "evidence_type": "incident",
        "source_id": str(incident.get("id", "incident-root")),
        "title": f"Incident Record: {incident.get('title', 'Unknown')}",
        "summary": incident.get("summary") or f"Detected at {incident.get('detected_at')}, severity {incident.get('severity')}.",
        "data": {
            "severity": incident.get("severity"),
            "status": incident.get("status"),
            "detected_at": incident.get("detected_at"),
            "started_at": incident.get("started_at"),
        },
    })

    # 2. Service Context Evidence
    if service:
        evidence.append({
            "evidence_type": "service",
            "source_id": str(service.get("id", "service-root")),
            "title": f"Service Topology: {service.get('name')}",
            "summary": f"Health status: {service.get('health_status', 'unknown')}, Tier: {service.get('tier', 'tier_3')}, Criticality: {service.get('tier', 'standard')}.",
            "data": {
                "id": str(service.get("id")),
                "name": service.get("name"),
                "slug": service.get("slug"),
                "tier": service.get("tier"),
                "health_status": service.get("health_status"),
            },
        })

    # 3. Log Evidence
    error_logs = [log for log in raw_logs if log.get("severity") in {"ERROR", "FATAL", "WARN"}]
    # Collect up to 5 representative error logs
    for log in error_logs[:5]:
        evidence.append({
            "evidence_type": "log",
            "source_id": str(log.get("id")),
            "title": f"Log {log.get('severity')}: {log.get('message', '')[:64]}",
            "summary": f"Observed at {log.get('timestamp')}. Trace: {log.get('trace_id') or 'none'}. {log.get('message', '')[:140]}",
            "data": {
                "id": str(log.get("id")),
                "severity": log.get("severity"),
                "timestamp": log.get("timestamp"),
                "trace_id": log.get("trace_id"),
                "message": log.get("message"),
                "attributes": log.get("attributes", {}),
            },
        })

    if not error_logs and raw_logs:
        evidence.append({
            "evidence_type": "log",
            "source_id": "logs-sample",
            "title": f"Log Sample ({len(raw_logs)} records inspected)",
            "summary": f"Inspected {len(raw_logs)} logs. No high-severity FATAL or ERROR logs observed in the sample window.",
            "data": {"inspected_count": len(raw_logs)},
        })

    # 4. Timeline Evidence
    if timeline_events:
        recent_events = timeline_events[:3]
        evidence.append({
            "evidence_type": "incident",
            "source_id": "timeline-events",
            "title": f"Incident Timeline ({len(timeline_events)} state transitions)",
            "summary": f"Latest event: {recent_events[0].get('message', 'State updated')} at {recent_events[0].get('created_at')}.",
            "data": {"events": recent_events},
        })

    # 5. Related Incidents Evidence
    if related_incidents:
        evidence.append({
            "evidence_type": "incident",
            "source_id": "related-incidents",
            "title": f"Concurrent Incidents ({len(related_incidents)} active)",
            "summary": f"Observed {len(related_incidents)} other active incidents in workspace that may share infrastructure dependencies.",
            "data": {"related_incident_ids": [str(i.get("id")) for i in related_incidents]},
        })

    return {"evidence": evidence}


def log_analyzer_node(state: InvestigationState) -> dict[str, Any]:
    """Node 3: Log Analyzer - identifies error clusters, trace correlations, and anomalies."""
    raw_logs = state.get("raw_logs", [])
    total_logs = len(raw_logs)

    severity_counts: dict[str, int] = {}
    traces: set[str] = set()
    error_patterns: dict[str, int] = {}

    for log in raw_logs:
        sev = log.get("severity", "INFO")
        severity_counts[sev] = severity_counts.get(sev, 0) + 1

        tid = log.get("trace_id")
        if tid:
            traces.add(tid)

        if sev in {"ERROR", "FATAL"}:
            msg = log.get("message", "")
            # Extract common error patterns (e.g., Timeout, ConnectionRefused, 500, Database, etc.)
            pattern = "General Error"
            msg_lower = msg.lower()
            if "timeout" in msg_lower or "timed out" in msg_lower:
                pattern = "Timeout / Latency Exceeded"
            elif "connection" in msg_lower or "refused" in msg_lower or "reset" in msg_lower:
                pattern = "Connection Refused / Network Partition"
            elif "database" in msg_lower or "postgres" in msg_lower or "pool" in msg_lower:
                pattern = "Database Connection Exhaustion"
            elif "500" in msg_lower or "internal server error" in msg_lower:
                pattern = "HTTP 500 Internal Server Error"
            elif "502" in msg_lower or "503" in msg_lower or "504" in msg_lower:
                pattern = "Upstream Gateway / Service Unavailable"
            elif "memory" in msg_lower or "oom" in msg_lower:
                pattern = "Out of Memory / Resource Saturation"
            elif "auth" in msg_lower or "unauthorized" in msg_lower or "403" in msg_lower:
                pattern = "Authentication / Authorization Failure"
            else:
                # Use first 35 chars
                pattern = msg[:35].strip() or "Unhandled Exception"

            error_patterns[pattern] = error_patterns.get(pattern, 0) + 1

    top_patterns = sorted(
        [{"pattern": k, "occurrences": v} for k, v in error_patterns.items()],
        key=lambda x: x["occurrences"],
        reverse=True,
    )

    error_count = severity_counts.get("ERROR", 0) + severity_counts.get("FATAL", 0)
    warn_count = severity_counts.get("WARN", 0)

    log_analysis = {
        "total_logs": total_logs,
        "error_count": error_count,
        "warn_count": warn_count,
        "severity_distribution": severity_counts,
        "top_error_patterns": top_patterns[:4],
        "correlated_trace_ids": list(traces)[:5],
        "has_error_spike": error_count > 0,
    }
    return {"log_analysis": log_analysis}


async def hypothesis_generator_node(state: InvestigationState, llm_client: BaseLLMClient) -> dict[str, Any]:
    """Node 4: Hypothesis Generator - formulates possible root causes from observed evidence."""
    incident = state.get("incident", {})
    service = state.get("service") or {}
    log_analysis = state.get("log_analysis", {})
    evidence = state.get("evidence", [])

    # If LLM client is not mock, query provider
    if not isinstance(llm_client, MockLLMClient):
        prompt = (
            f"You are an AI Incident Investigation Specialist in NEXUS.\n"
            f"Incident: '{incident.get('title')}' (Severity: {incident.get('severity')})\n"
            f"Service: '{service.get('name', 'N/A')}' (Tier: {service.get('tier', 'N/A')}, Health: {service.get('health_status', 'N/A')})\n"
            f"Log Analysis: {len(state.get('raw_logs', []))} logs, {log_analysis.get('error_count', 0)} errors. "
            f"Top patterns: {log_analysis.get('top_error_patterns', [])}\n"
            f"Evidence: {[{'type': e['evidence_type'], 'title': e['title']} for e in evidence[:6]]}\n\n"
            f"Based strictly on this observed data, generate a JSON object with a list of 2 or 3 root-cause hypotheses:\n"
            f'{{"hypotheses": [{{"title": "string", "description": "string", "likelihood": "high|medium|low"}}]}}\n'
            f"Do not invent facts or external components not mentioned."
        )
        try:
            res = await llm_client.generate_json(prompt=prompt)
            hypotheses = res.get("hypotheses", [])
            if hypotheses and isinstance(hypotheses, list):
                return {"hypotheses": hypotheses}
        except Exception:
            # Fall back to analytical engine below if LLM generation fails
            pass

    # Deterministic analytical hypothesis generator grounded in actual facts
    hypotheses: list[dict[str, Any]] = []
    top_patterns = log_analysis.get("top_error_patterns", [])

    if top_patterns:
        primary_pattern = top_patterns[0]["pattern"]
        hypotheses.append({
            "title": f"Service Degradation due to {primary_pattern}",
            "description": (
                f"Observed {top_patterns[0]['occurrences']} occurrences of '{primary_pattern}' in logs for service "
                f"{service.get('name', 'target service')}, triggering service health degradation."
            ),
            "likelihood": "high",
        })

        if len(top_patterns) > 1:
            sec_pattern = top_patterns[1]["pattern"]
            hypotheses.append({
                "title": f"Cascading Dependency Failure ({sec_pattern})",
                "description": (
                    f"Correlated secondary error pattern '{sec_pattern}' indicates potential downstream or "
                    f"database response latency compounding initial failures."
                ),
                "likelihood": "medium",
            })
        else:
            hypotheses.append({
                "title": "Resource Contention or Transient Concurrency Spike",
                "description": (
                    f"Traffic or background worker volume exceeded service capacity, triggering intermittent "
                    f"failures for {service.get('name', 'the service')}."
                ),
                "likelihood": "medium",
            })
    else:
        # No high-severity logs found
        hypotheses.append({
            "title": "Transient Upstream Network Disruption or Silent Drop",
            "description": (
                f"Incident '{incident.get('title')}' triggered without local fatal error log volume, "
                f"suggesting upstream network partition or client-side timeout."
            ),
            "likelihood": "medium",
        })
        hypotheses.append({
            "title": "Configuration Drift or External Dependency Degradation",
            "description": (
                f"Service {service.get('name', 'service')} operational anomaly likely caused by downstream "
                f"dependency latency or unlogged external API failure."
            ),
            "likelihood": "low",
        })

    return {"hypotheses": hypotheses}


def hypothesis_evaluator_node(state: InvestigationState) -> dict[str, Any]:
    """Node 5: Hypothesis Evaluator - scores hypotheses against supporting/contradicting evidence."""
    hypotheses = state.get("hypotheses", [])
    evidence = state.get("evidence", [])
    log_analysis = state.get("log_analysis", {})

    evaluated: list[dict[str, Any]] = []
    for idx, hyp in enumerate(hypotheses):
        title = hyp.get("title", "")
        desc = hyp.get("description", "")
        base_likelihood = hyp.get("likelihood", "medium")

        supporting: list[str] = []
        contradicting: list[str] = []

        # Correlate with logs
        error_count = log_analysis.get("error_count", 0)
        if error_count > 0:
            supporting.append(f"Supported by {error_count} high-severity error logs detected in incident timeframe.")
        else:
            contradicting.append("Absence of fatal error log records in local service logs.")

        # Correlate with traces
        traces = log_analysis.get("correlated_trace_ids", [])
        if traces:
            supporting.append(f"Correlated trace activity identified across {len(traces)} distinct traces.")

        # Correlate with service status
        service_ev = next((e for e in evidence if e["evidence_type"] == "service"), None)
        if service_ev:
            health = service_ev.get("data", {}).get("health_status", "healthy")
            if health in {"degraded", "unhealthy"}:
                supporting.append(f"Service health check confirms '{health}' status.")
            else:
                contradicting.append(f"Service health check currently reports '{health}'.")

        # Score confidence
        if base_likelihood == "high" or idx == 0:
            score = 0.82 if error_count > 0 else 0.65
            likelihood = "high" if score >= 0.75 else "medium"
        elif base_likelihood == "medium":
            score = 0.62 if error_count > 0 else 0.48
            likelihood = "medium"
        else:
            score = 0.38
            likelihood = "low"

        evaluated.append({
            "title": title,
            "description": desc,
            "likelihood": likelihood,
            "confidence_score": round(score, 2),
            "supporting_evidence": supporting,
            "contradicting_evidence": contradicting,
            "is_primary": False,  # Will set primary below
        })

    # Pick the highest confidence as primary
    if evaluated:
        evaluated.sort(key=lambda x: x["confidence_score"], reverse=True)
        evaluated[0]["is_primary"] = True
        overall_confidence = evaluated[0]["confidence_score"]
    else:
        overall_confidence = 0.50

    return {
        "hypotheses": evaluated,
        "confidence_score": overall_confidence,
    }


def impact_analyzer_node(state: InvestigationState) -> dict[str, Any]:
    """Node 6: Impact Analyzer - determines blast radius and affected dependencies."""
    incident = state.get("incident", {})
    service = state.get("service") or {}
    related_incidents = state.get("related_incidents", [])

    tier = service.get("tier", "tier_3")
    severity = incident.get("severity", "SEV3")

    affected_services = [service.get("name", "Target Service")] if service.get("name") else []
    blast_radius = "service_isolated"

    if len(related_incidents) > 1:
        blast_radius = "cross_service"
        for inc in related_incidents:
            svc_name = inc.get("service_name")
            if svc_name and svc_name not in affected_services:
                affected_services.append(svc_name)
    elif tier == "tier_1" and severity in {"SEV1", "SEV2"}:
        blast_radius = "critical_tier_exposure"

    business_impact = (
        f"Critical operational impact on {tier.upper()} core service {service.get('name', 'Service')}."
        if tier == "tier_1"
        else f"Localized disruption on {tier.upper()} service {service.get('name', 'Service')}."
    )

    impact = {
        "blast_radius": blast_radius,
        "affected_services": affected_services,
        "business_impact": business_impact,
        "related_incident_count": len(related_incidents),
    }
    return {"impact": impact}


def recommendation_engine_node(state: InvestigationState) -> dict[str, Any]:
    """Node 7: Recommendation Engine - produces prioritized remediation actions."""
    hypotheses = state.get("hypotheses", [])
    service = state.get("service") or {}
    svc_name = service.get("name", "service")

    primary_hyp = next((h for h in hypotheses if h.get("is_primary")), hypotheses[0] if hypotheses else {})
    prim_title = primary_hyp.get("title", "Observed Incident")

    recommendations: list[dict[str, Any]] = []

    # Recommendation 1: Immediate Mitigation (P1)
    recommendations.append({
        "title": f"Restart & Scale Connection Pool for {svc_name}",
        "description": (
            f"Gracefully restart worker pods/containers for {svc_name} and temporarily increase connection "
            f"pool capacity to alleviate connection backpressure."
        ),
        "action_type": "mitigation",
        "priority": "P1",
        "rationale": f"Directly addresses primary root-cause hypothesis: '{prim_title}'.",
        "status": "pending_approval",
    })

    # Recommendation 2: Deep Diagnostic Inspection (P2)
    recommendations.append({
        "title": f"Execute Diagnostic Trace & Log Query on {svc_name}",
        "description": (
            f"Query distributed tracing spans for {svc_name} over the last 60 minutes to isolate slowest database "
            f"or upstream network queries."
        ),
        "action_type": "investigation",
        "priority": "P2",
        "rationale": "Verifies whether downstream database or external API latency triggered client timeouts.",
        "status": "pending_approval",
    })

    # Recommendation 3: Architectural Prevention (P3)
    recommendations.append({
        "title": f"Tune Circuit Breakers & Timeout Thresholds",
        "description": (
            f"Review and adjust timeout thresholds and circuit breaker tripping limits on {svc_name} ingress "
            f"and database clients to prevent cascading thread starvation."
        ),
        "action_type": "prevention",
        "priority": "P3",
        "rationale": "Prevents recurring degradation when upstream services experience transient latency.",
        "status": "pending_approval",
    })

    return {"recommendations": recommendations}


def summary_generator_node(state: InvestigationState) -> dict[str, Any]:
    """Node 8: Investigation Summary - compiles structured executive report."""
    incident = state.get("incident", {})
    service = state.get("service") or {}
    hypotheses = state.get("hypotheses", [])
    log_analysis = state.get("log_analysis", {})
    impact = state.get("impact", {})
    confidence = state.get("confidence_score", 0.75)

    primary_hyp = next((h for h in hypotheses if h.get("is_primary")), hypotheses[0] if hypotheses else {})

    summary = (
        f"Automated AI investigation completed for incident '{incident.get('title')}' on service "
        f"'{service.get('name', 'N/A')}'.\n\n"
        f"**Primary Root Cause:** {primary_hyp.get('title', 'Service Anomaly')} (Confidence: {int(confidence * 100)}%).\n"
        f"{primary_hyp.get('description', '')}\n\n"
        f"**Evidence Inspected:** {log_analysis.get('total_logs', 0)} logs analyzed ({log_analysis.get('error_count', 0)} high-severity errors). "
        f"Blast radius identified as '{impact.get('blast_radius', 'service_isolated')}'.\n\n"
        f"**Remediation Guidance:** 3 actionable steps formulated and placed into human-in-the-loop approval queue."
    )

    return {"summary": summary}


def build_investigation_graph(llm_client: BaseLLMClient):
    """Build and compile the 8-node LangGraph investigation workflow."""
    builder = StateGraph(InvestigationState)

    # Add nodes
    builder.add_node("planner", planner_node)
    builder.add_node("collector", collector_node)
    builder.add_node("log_analyzer", log_analyzer_node)

    async def hypothesis_gen(state: InvestigationState):
        return await hypothesis_generator_node(state, llm_client)

    builder.add_node("hypothesis_generator", hypothesis_gen)
    builder.add_node("hypothesis_evaluator", hypothesis_evaluator_node)
    builder.add_node("impact_analyzer", impact_analyzer_node)
    builder.add_node("recommendation_engine", recommendation_engine_node)
    builder.add_node("summary_generator", summary_generator_node)

    # Wire linear pipeline: START -> planner -> collector -> log_analyzer -> hypothesis_generator ->
    # hypothesis_evaluator -> impact_analyzer -> recommendation_engine -> summary_generator -> END
    builder.add_edge(START, "planner")
    builder.add_edge("planner", "collector")
    builder.add_edge("collector", "log_analyzer")
    builder.add_edge("log_analyzer", "hypothesis_generator")
    builder.add_edge("hypothesis_generator", "hypothesis_evaluator")
    builder.add_edge("hypothesis_evaluator", "impact_analyzer")
    builder.add_edge("impact_analyzer", "recommendation_engine")
    builder.add_edge("recommendation_engine", "summary_generator")
    builder.add_edge("summary_generator", END)

    return builder.compile()

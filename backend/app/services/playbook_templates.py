"""Built-in operational playbook templates."""

from app.models.playbook import PlaybookActionType, PlaybookTriggerType
from app.schemas.playbook import PlaybookStepCreate, PlaybookTemplateResponse

BUILTIN_TEMPLATES: list[PlaybookTemplateResponse] = [
    PlaybookTemplateResponse(
        id="critical-alert-response",
        name="Critical Alert Response",
        description="Automated triage, team notification, and external bridge dispatch for SEV1/Critical operational alerts.",
        category="alert_remediation",
        trigger_type=PlaybookTriggerType.ALERT_CREATED,
        trigger_config={"severities": ["critical", "SEV1"]},
        severity_applicability=["critical", "SEV1"],
        steps=[
            PlaybookStepCreate(
                name="Notify On-Call Responders",
                action_type=PlaybookActionType.SEND_NOTIFICATION,
                action_config={
                    "title": "Critical Alert Fired",
                    "message": "Immediate operational attention required for critical alert.",
                    "severity": "critical",
                    "category": "alert",
                },
                step_order=1,
            ),
            PlaybookStepCreate(
                name="Dispatch External Webhook Bridge",
                action_type=PlaybookActionType.SEND_WEBHOOK,
                action_config={
                    "webhook_url": "https://httpbin.org/post",
                    "event_name": "critical_alert_bridge",
                },
                step_order=2,
            ),
            PlaybookStepCreate(
                name="Require Commander Remediation Approval",
                action_type=PlaybookActionType.REQUIRE_APPROVAL,
                action_config={
                    "prompt": "Approve automated mitigation actions for critical alert response.",
                },
                step_order=3,
            ),
            PlaybookStepCreate(
                name="Log Incident Remediation Note",
                action_type=PlaybookActionType.CREATE_INCIDENT_NOTE,
                action_config={
                    "body": "Automated Critical Alert Response playbook completed successfully following commander authorization.",
                },
                step_order=4,
            ),
        ],
    ),
    PlaybookTemplateResponse(
        id="repeated-failure-investigation",
        name="Repeated Failure Investigation",
        description="Initiates automated root-cause investigation and log telemetry collection upon repeated service errors.",
        category="investigation",
        trigger_type=PlaybookTriggerType.ALERT_CREATED,
        trigger_config={"severities": ["error", "warning", "SEV2", "SEV3"]},
        severity_applicability=["error", "warning", "SEV2", "SEV3"],
        steps=[
            PlaybookStepCreate(
                name="Log Diagnostics Start Note",
                action_type=PlaybookActionType.CREATE_INCIDENT_NOTE,
                action_config={
                    "body": "Repeated failure detected. Diagnostic telemetry collection and AI investigation triggered.",
                },
                step_order=1,
            ),
            PlaybookStepCreate(
                name="Launch Autonomous AI Investigation",
                action_type=PlaybookActionType.TRIGGER_INVESTIGATION,
                action_config={},
                step_order=2,
            ),
            PlaybookStepCreate(
                name="Telemetry Collection Stabilization Wait",
                action_type=PlaybookActionType.WAIT_DURATION,
                action_config={"duration_seconds": 5},
                step_order=3,
            ),
            PlaybookStepCreate(
                name="Broadcast Diagnostics Ready Notification",
                action_type=PlaybookActionType.SEND_NOTIFICATION,
                action_config={
                    "title": "Failure Investigation Evidence Ready",
                    "message": "AI investigation and diagnostic log collection complete for repeated failure.",
                    "severity": "info",
                    "category": "investigation",
                },
                step_order=4,
            ),
        ],
    ),
    PlaybookTemplateResponse(
        id="incident-assignment-notification",
        name="Incident Assignment & Notification",
        description="Standard triage playbook that updates incident note and broadcasts multi-channel notification to responders.",
        category="incident_response",
        trigger_type=PlaybookTriggerType.INCIDENT_CREATED,
        trigger_config={"severities": ["SEV1", "SEV2", "SEV3"]},
        severity_applicability=["SEV1", "SEV2", "SEV3"],
        steps=[
            PlaybookStepCreate(
                name="Record Initial Triage Event",
                action_type=PlaybookActionType.CREATE_INCIDENT_NOTE,
                action_config={
                    "body": "Incident registered in operational queue. Playbook initiated standard response workflow.",
                },
                step_order=1,
            ),
            PlaybookStepCreate(
                name="Alert Responders via Notification",
                action_type=PlaybookActionType.SEND_NOTIFICATION,
                action_config={
                    "title": "New Incident In Triage Queue",
                    "message": "Operational incident opened. Please review priority and acknowledge response.",
                    "severity": "warning",
                    "category": "incident",
                },
                step_order=2,
            ),
        ],
    ),
    PlaybookTemplateResponse(
        id="ai-assisted-incident-investigation",
        name="AI-Assisted Incident Investigation",
        description="Launches NEXUS Agentic AI Investigation upon incident opening, halting for human approval before remediation.",
        category="investigation",
        trigger_type=PlaybookTriggerType.INCIDENT_CREATED,
        trigger_config={"severities": ["SEV1", "SEV2", "SEV3", "SEV4"]},
        severity_applicability=["SEV1", "SEV2", "SEV3", "SEV4"],
        steps=[
            PlaybookStepCreate(
                name="Log Autonomous Investigation Initiation",
                action_type=PlaybookActionType.CREATE_INCIDENT_NOTE,
                action_config={
                    "body": "NEXUS Agentic AI Investigation initiated to analyze root cause hypotheses, logs, and service health.",
                },
                step_order=1,
            ),
            PlaybookStepCreate(
                name="Run AI Investigation Workflow",
                action_type=PlaybookActionType.TRIGGER_INVESTIGATION,
                action_config={},
                step_order=2,
            ),
            PlaybookStepCreate(
                name="Require Human Verification of AI Remediation",
                action_type=PlaybookActionType.REQUIRE_APPROVAL,
                action_config={
                    "prompt": "Verify and approve AI-generated remediation recommendations before executing runbook actions.",
                },
                step_order=3,
            ),
            PlaybookStepCreate(
                name="Record Remediation Review Approval Note",
                action_type=PlaybookActionType.CREATE_INCIDENT_NOTE,
                action_config={
                    "body": "AI Investigation findings reviewed and remediation approval confirmed by incident responder.",
                },
                step_order=4,
            ),
        ],
    ),
]


def get_all_templates() -> list[PlaybookTemplateResponse]:
    """Returns the list of built-in templates."""
    return BUILTIN_TEMPLATES


def get_template_by_id(template_id: str) -> PlaybookTemplateResponse | None:
    """Finds a built-in template by its identifier."""
    for template in BUILTIN_TEMPLATES:
        if template.id == template_id:
            return template
    return None

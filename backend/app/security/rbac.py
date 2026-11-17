"""Deny-by-default workspace role and permission policy."""

from enum import Enum

from app.models.identity import WorkspaceRole


class Permission(str, Enum):
    WORKSPACE_READ = "workspace.read"
    MEMBERS_MANAGE = "workspace.members.manage"
    SETTINGS_MANAGE = "workspace.settings.manage"
    INCIDENT_READ = "incident.read"
    INCIDENT_WRITE = "incident.write"
    INVESTIGATION_START = "investigation.start"
    RECOMMENDATION_APPROVE = "recommendation.approve"
    AUDIT_READ = "audit.read"
    SERVICE_READ = "service.read"
    SERVICE_MANAGE = "service.manage"
    LOG_READ = "log.read"
    LOG_WRITE = "log.write"
    ALERT_READ = "alert.read"
    ALERT_WRITE = "alert.write"
    ALERT_MANAGE = "alert.manage"
    NOTIFICATION_READ = "notification.read"
    NOTIFICATION_WRITE = "notification.write"
    ONCALL_READ = "oncall.read"
    ONCALL_MANAGE = "oncall.manage"
    ESCALATION_READ = "escalation.read"
    ESCALATION_MANAGE = "escalation.manage"
    PLAYBOOK_READ = "playbook.read"
    PLAYBOOK_MANAGE = "playbook.manage"
    PLAYBOOK_EXECUTE = "playbook.execute"
    PLAYBOOK_APPROVE = "playbook.approve"


ROLE_PERMISSIONS: dict[WorkspaceRole, frozenset[Permission]] = {
    WorkspaceRole.ADMIN: frozenset(Permission),
    WorkspaceRole.COMMANDER: frozenset(
        {
            Permission.WORKSPACE_READ,
            Permission.SERVICE_READ,
            Permission.INCIDENT_READ,
            Permission.INCIDENT_WRITE,
            Permission.INVESTIGATION_START,
            Permission.RECOMMENDATION_APPROVE,
            Permission.LOG_READ,
            Permission.LOG_WRITE,
            Permission.ALERT_READ,
            Permission.ALERT_WRITE,
            Permission.ALERT_MANAGE,
            Permission.NOTIFICATION_READ,
            Permission.NOTIFICATION_WRITE,
            Permission.ONCALL_READ,
            Permission.ONCALL_MANAGE,
            Permission.ESCALATION_READ,
            Permission.ESCALATION_MANAGE,
            Permission.PLAYBOOK_READ,
            Permission.PLAYBOOK_MANAGE,
            Permission.PLAYBOOK_EXECUTE,
            Permission.PLAYBOOK_APPROVE,
        }
    ),
    WorkspaceRole.RESPONDER: frozenset(
        {
            Permission.WORKSPACE_READ,
            Permission.SERVICE_READ,
            Permission.INCIDENT_READ,
            Permission.INCIDENT_WRITE,
            Permission.INVESTIGATION_START,
            Permission.LOG_READ,
            Permission.LOG_WRITE,
            Permission.ALERT_READ,
            Permission.ALERT_WRITE,
            Permission.NOTIFICATION_READ,
            Permission.NOTIFICATION_WRITE,
            Permission.ONCALL_READ,
            Permission.ESCALATION_READ,
            Permission.PLAYBOOK_READ,
            Permission.PLAYBOOK_EXECUTE,
            Permission.PLAYBOOK_APPROVE,
        }
    ),
    # The API specification maps the read-only auditor capability to viewer.
    WorkspaceRole.VIEWER: frozenset(
        {
            Permission.WORKSPACE_READ,
            Permission.SERVICE_READ,
            Permission.INCIDENT_READ,
            Permission.AUDIT_READ,
            Permission.LOG_READ,
            Permission.ALERT_READ,
            Permission.NOTIFICATION_READ,
            Permission.ONCALL_READ,
            Permission.ESCALATION_READ,
            Permission.PLAYBOOK_READ,
        }
    ),
}


def has_permission(role: WorkspaceRole, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, frozenset())

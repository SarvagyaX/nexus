"""Explicit, repeatable development/demo identity bootstrap command."""

from sqlalchemy import select
from sqlalchemy.orm import Session
import re

from app.auth.passwords import hash_password
from app.core.config import Settings, get_settings
from app.db.session import SessionLocal
from app.models.identity import Membership, User, UserStatus, Workspace, WorkspaceRole, WorkspaceStatus


class SeedConflict(RuntimeError):
    """A configured demo key collides with a non-demo record."""


def seed_demo_identity(db: Session, settings: Settings) -> tuple[Workspace, User, Membership]:
    if settings.app_env != "development" or not settings.demo_auth_enabled:
        raise RuntimeError("Demo seeding requires APP_ENV=development and DEMO_AUTH_ENABLED=true.")
    if not settings.demo_admin_email or not settings.demo_admin_password:
        raise RuntimeError("DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD must be configured.")
    password = settings.demo_admin_password.get_secret_value()
    if len(password) < 14:
        raise RuntimeError("DEMO_ADMIN_PASSWORD must be at least 14 characters.")

    email = settings.demo_admin_email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise RuntimeError("DEMO_ADMIN_EMAIL must be a valid email address.")

    workspace = db.scalar(select(Workspace).where(Workspace.slug == settings.demo_workspace_slug))
    if workspace is None:
        workspace = Workspace(
            name=settings.demo_workspace_name,
            slug=settings.demo_workspace_slug,
            status=WorkspaceStatus.ACTIVE,
            is_demo=True,
        )
        db.add(workspace)
        db.flush()
    elif not workspace.is_demo:
        raise SeedConflict("Configured demo workspace slug is already in use by a non-demo workspace.")

    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            display_name=settings.demo_admin_display_name,
            password_hash=hash_password(password),
            status=UserStatus.ACTIVE,
            is_demo=True,
        )
        db.add(user)
        db.flush()
    elif not user.is_demo:
        raise SeedConflict("Configured demo administrator email is already in use by a non-demo user.")

    membership = db.scalar(
        select(Membership).where(Membership.workspace_id == workspace.id, Membership.user_id == user.id)
    )
    if membership is None:
        membership = Membership(
            workspace_id=workspace.id,
            user_id=user.id,
            role=WorkspaceRole.ADMIN,
            is_seeded=True,
        )
        db.add(membership)
    elif not membership.is_seeded:
        raise SeedConflict("Demo administrator already has a non-seed membership in the configured workspace.")

    db.commit()
    db.refresh(workspace)
    db.refresh(user)
    db.refresh(membership)
    return workspace, user, membership


def main() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        seed_demo_identity(db, settings)
    print("NEXUS demo workspace identity is ready.")


if __name__ == "__main__":
    main()

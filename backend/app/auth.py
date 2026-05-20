"""
Centralised authentication / authorisation helpers.

Imported by main.py, routes/receipts.py, routes/admin.py, and routes/chat.py
to avoid circular imports.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from firebase_admin import auth
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.receipt import UserAccess

OWNER_EMAIL = "jamestinsley@gmail.com"


async def get_current_user(
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    FastAPI dependency that verifies the Firebase Bearer token and resolves
    the caller's access level.

    Returns a dict with keys:
        uid               – Firebase UID (or "local-dev" in local mode)
        email             – caller's email address
        is_owner          – True for jamestinsley@gmail.com
        access_categories – ["all"] for owner; list of granted categories for guests
        role              – "write" for owner; "read" or "write" for guests
    """
    # ── Local dev bypass ────────────────────────────────────────────────────
    if os.getenv("ENVIRONMENT") == "local":
        return {
            "uid": "local-dev",
            "email": OWNER_EMAIL,
            "is_owner": True,
            "access_categories": ["all"],
            "role": "write",
        }

    # ── Validate Bearer token ────────────────────────────────────────────────
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed auth token",
        )

    token = authorization.split("Bearer ")[1]
    try:
        decoded_token = auth.verify_id_token(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
        )

    email: str = decoded_token.get("email", "")
    uid: str = decoded_token.get("uid", "")

    # ── Owner check ──────────────────────────────────────────────────────────
    if email == OWNER_EMAIL:
        return {
            "uid": uid,
            "email": email,
            "is_owner": True,
            "access_categories": ["all"],
            "role": "write",
        }

    # ── Guest access grant lookup ────────────────────────────────────────────
    result = await session.execute(
        select(UserAccess).where(UserAccess.email == email)
    )
    rows = result.scalars().all()
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    access_categories: list[str] = [row.category for row in rows]
    role = "write" if any(row.role == "write" for row in rows) else "read"

    return {
        "uid": uid,
        "email": email,
        "is_owner": False,
        "access_categories": access_categories,
        "role": role,
    }

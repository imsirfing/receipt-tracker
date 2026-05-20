"""
Admin routes: manage user access grants (owner-only).
"""
from __future__ import annotations

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models.receipt import UserAccess

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class AccessGrant(BaseModel):
    email: str
    category: str   # "all" or a specific category name
    role: str = "read"  # "read" | "write"


class AccessOut(BaseModel):
    id: str
    email: str
    category: str
    role: str


class MeOut(BaseModel):
    is_owner: bool
    access_category: str
    role: str


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------

def require_owner(current_user: dict = Depends(get_current_user)) -> dict:
    if not current_user.get("is_owner"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner access required",
        )
    return current_user


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/me", response_model=MeOut)
async def get_me(current_user: dict = Depends(get_current_user)) -> MeOut:
    """Returns the calling user's access level. Safe for all authenticated users."""
    return MeOut(
        is_owner=current_user["is_owner"],
        access_category=current_user["access_category"],
        role=current_user["role"],
    )


@router.get("/access", response_model=List[AccessOut])
async def list_access(
    session: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_owner),
) -> List[AccessOut]:
    result = await session.execute(select(UserAccess))
    rows = result.scalars().all()
    return [
        AccessOut(id=str(r.id), email=r.email, category=r.category, role=r.role)
        for r in rows
    ]


@router.post("/access", response_model=AccessOut, status_code=201)
async def grant_access(
    body: AccessGrant,
    session: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_owner),
) -> AccessOut:
    """Grant (or update) access for the given email."""
    result = await session.execute(
        select(UserAccess).where(UserAccess.email == body.email)
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.category = body.category
        existing.role = body.role
        await session.commit()
        return AccessOut(
            id=str(existing.id),
            email=existing.email,
            category=existing.category,
            role=existing.role,
        )

    access = UserAccess(
        id=uuid.uuid4(),
        email=body.email,
        category=body.category,
        role=body.role,
    )
    session.add(access)
    await session.commit()
    return AccessOut(
        id=str(access.id),
        email=access.email,
        category=access.category,
        role=access.role,
    )


@router.delete("/access/{access_id}", status_code=204)
async def revoke_access(
    access_id: str,
    session: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_owner),
) -> None:
    result = await session.execute(
        select(UserAccess).where(UserAccess.id == uuid.UUID(access_id))
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await session.delete(row)
    await session.commit()

"""
Payee normalization routes (owner-only).
"""
from __future__ import annotations
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models.payee_alias import PayeeAlias
from app.models.receipt import Receipt
from app.routes.admin import require_owner
from app.services.payee_normalizer import normalize_payee, BUILTIN_RULES

router = APIRouter(prefix="/api/payees", tags=["payees"])


class AliasIn(BaseModel):
    pattern: str
    canonical: str
    priority: int = 5
    note: Optional[str] = None


class AliasOut(BaseModel):
    id: str
    pattern: str
    canonical: str
    priority: int
    enabled: bool
    note: Optional[str]
    created_at: str


class BuiltinRule(BaseModel):
    priority: int
    pattern: str
    canonical: str


class NormalizeResult(BaseModel):
    updated: int


class PreviewIn(BaseModel):
    payee: str


class PreviewOut(BaseModel):
    raw: str
    canonical: Optional[str]
    matched: bool


async def _load_custom_rules(session: AsyncSession) -> list[tuple[int, str, str]]:
    result = await session.execute(
        select(PayeeAlias).where(PayeeAlias.enabled == True)
    )
    rows = result.scalars().all()
    return [(r.priority, r.pattern, r.canonical) for r in rows]


@router.get("/builtin", response_model=List[BuiltinRule])
async def list_builtin_rules(
    _user: dict = Depends(require_owner),
) -> List[BuiltinRule]:
    return [BuiltinRule(priority=p, pattern=pat, canonical=c) for p, pat, c in BUILTIN_RULES]


@router.get("/aliases", response_model=List[AliasOut])
async def list_aliases(
    session: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_owner),
) -> List[AliasOut]:
    result = await session.execute(select(PayeeAlias).order_by(PayeeAlias.priority, PayeeAlias.created_at))
    rows = result.scalars().all()
    return [
        AliasOut(
            id=str(r.id),
            pattern=r.pattern,
            canonical=r.canonical,
            priority=r.priority,
            enabled=r.enabled,
            note=r.note,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]


@router.post("/aliases", response_model=AliasOut, status_code=201)
async def create_alias(
    body: AliasIn,
    session: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_owner),
) -> AliasOut:
    alias = PayeeAlias(
        id=uuid.uuid4(),
        pattern=body.pattern,
        canonical=body.canonical,
        priority=body.priority,
        note=body.note,
    )
    session.add(alias)
    await session.commit()
    await session.refresh(alias)
    return AliasOut(
        id=str(alias.id),
        pattern=alias.pattern,
        canonical=alias.canonical,
        priority=alias.priority,
        enabled=alias.enabled,
        note=alias.note,
        created_at=alias.created_at.isoformat(),
    )


@router.delete("/aliases/{alias_id}", status_code=204)
async def delete_alias(
    alias_id: str,
    session: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_owner),
) -> None:
    result = await session.execute(
        select(PayeeAlias).where(PayeeAlias.id == uuid.UUID(alias_id))
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    await session.delete(row)
    await session.commit()


@router.patch("/aliases/{alias_id}", response_model=AliasOut)
async def toggle_alias(
    alias_id: str,
    body: dict,
    session: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_owner),
) -> AliasOut:
    result = await session.execute(
        select(PayeeAlias).where(PayeeAlias.id == uuid.UUID(alias_id))
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    if "enabled" in body:
        row.enabled = body["enabled"]
    await session.commit()
    await session.refresh(row)
    return AliasOut(
        id=str(row.id),
        pattern=row.pattern,
        canonical=row.canonical,
        priority=row.priority,
        enabled=row.enabled,
        note=row.note,
        created_at=row.created_at.isoformat(),
    )


@router.post("/preview", response_model=PreviewOut)
async def preview_normalize(
    body: PreviewIn,
    session: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_owner),
) -> PreviewOut:
    custom_rules = await _load_custom_rules(session)
    result = normalize_payee(body.payee, custom_rules)
    return PreviewOut(raw=body.payee, canonical=result, matched=result is not None)


@router.post("/normalize-all", response_model=NormalizeResult)
async def normalize_all(
    session: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_owner),
) -> NormalizeResult:
    """Apply normalization rules to all receipts and store canonical_payee."""
    custom_rules = await _load_custom_rules(session)

    result = await session.execute(select(Receipt).where(Receipt.deleted_at == None))
    receipts = result.scalars().all()

    updated = 0
    for r in receipts:
        canonical = normalize_payee(r.payee, custom_rules)
        if canonical != r.canonical_payee:
            r.canonical_payee = canonical
            updated += 1

    if updated > 0:
        await session.commit()

    return NormalizeResult(updated=updated)

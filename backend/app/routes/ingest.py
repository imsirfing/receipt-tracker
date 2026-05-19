"""On-demand Gmail ingestion trigger endpoint."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.workers.gmail_ingestion import poll_inbox_once

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# ---------------------------------------------------------------------------
# In-memory sync state (single instance is fine — Cloud Run min-instances=1)
# ---------------------------------------------------------------------------
class _SyncState:
    running: bool = False
    started_at: Optional[datetime] = None
    last_completed_at: Optional[datetime] = None
    last_processed: Optional[int] = None
    last_error: Optional[str] = None

_state = _SyncState()


class IngestStarted(BaseModel):
    status: str
    message: str


class IngestStatus(BaseModel):
    running: bool
    started_at: Optional[datetime]
    last_completed_at: Optional[datetime]
    last_processed: Optional[int]
    last_error: Optional[str]


async def _run_ingest() -> None:
    _state.running = True
    _state.started_at = datetime.now(timezone.utc)
    _state.last_error = None
    try:
        count = await poll_inbox_once()
        _state.last_processed = count
        _state.last_completed_at = datetime.now(timezone.utc)
        logger.info("Ingest complete: %d new receipts", count)
    except Exception as exc:
        _state.last_error = str(exc)
        logger.exception("Ingest background task failed")
    finally:
        _state.running = False


@router.post("", response_model=IngestStarted)
async def trigger_ingest(background_tasks: BackgroundTasks) -> IngestStarted:
    """Kick off Gmail ingestion in the background and return immediately."""
    if _state.running:
        return IngestStarted(status="already_running", message="Sync already in progress.")
    background_tasks.add_task(_run_ingest)
    return IngestStarted(status="started", message="Sync started in background.")


@router.get("/status", response_model=IngestStatus)
async def ingest_status() -> IngestStatus:
    """Check the current or last sync status."""
    return IngestStatus(
        running=_state.running,
        started_at=_state.started_at,
        last_completed_at=_state.last_completed_at,
        last_processed=_state.last_processed,
        last_error=_state.last_error,
    )

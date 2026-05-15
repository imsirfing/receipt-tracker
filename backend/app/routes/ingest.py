"""On-demand Gmail ingestion trigger endpoint."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.workers.gmail_ingestion import poll_inbox_once

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


class IngestResult(BaseModel):
    processed: int
    message: str


@router.post("", response_model=IngestResult)
async def trigger_ingest() -> IngestResult:
    """Pull unread receipt emails from Gmail and persist them."""
    try:
        count = await poll_inbox_once()
        return IngestResult(
            processed=count,
            message=f"Processed {count} new receipt{'s' if count != 1 else ''}.",
        )
    except Exception as exc:
        logger.exception("Ingest failed")
        raise HTTPException(status_code=500, detail=f"Ingestion error: {exc}") from exc

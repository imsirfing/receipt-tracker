"""Gmail ingestion worker.

Polls the configured Gmail inbox for unread messages addressed to
`jamestinsley.receipts+<variable>@gmail.com`, downloads PDF/PNG/JPG
attachments, stores them in GCS, persists Receipt/Attachment rows, and
marks each processed email as read.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Iterable, List, Optional

from google.cloud import storage
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import AsyncSessionLocal
from app.models.receipt import Attachment, Receipt, RecurringType
from app.services.document_parser import DocumentParser, ReceiptExtraction
from app.utils.email_parsing import parse_sub_address_variable

logger = logging.getLogger(__name__)

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]
ALLOWED_MIME_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/jpg"}


@dataclass
class AttachmentBlob:
    filename: str
    mime_type: str
    data: bytes


def _build_gmail_credentials() -> Credentials:
    client_id = os.environ["GMAIL_CLIENT_ID"]
    client_secret = os.environ["GMAIL_CLIENT_SECRET"]
    refresh_token = os.environ["GMAIL_REFRESH_TOKEN"]
    return Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=GMAIL_SCOPES,
    )


def _build_gmail_service():
    return build("gmail", "v1", credentials=_build_gmail_credentials(), cache_discovery=False)


def _extract_header(headers: Iterable[dict], name: str) -> Optional[str]:
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value")
    return None


def _collect_attachments(service, message_id: str, payload: dict) -> List[AttachmentBlob]:
    blobs: List[AttachmentBlob] = []

    def walk(part: dict) -> None:
        mime = (part.get("mimeType") or "").lower()
        filename = part.get("filename") or ""
        body = part.get("body") or {}
        attachment_id = body.get("attachmentId")

        if filename and attachment_id and mime in ALLOWED_MIME_TYPES:
            att = (
                service.users()
                .messages()
                .attachments()
                .get(userId="me", messageId=message_id, id=attachment_id)
                .execute()
            )
            raw = att.get("data", "")
            data = base64.urlsafe_b64decode(raw.encode("utf-8")) if raw else b""
            blobs.append(AttachmentBlob(filename=filename, mime_type=mime, data=data))

        for sub in part.get("parts") or []:
            walk(sub)

    walk(payload)
    return blobs


def _upload_to_gcs(
    bucket: storage.Bucket, category: str, message_id: str, blob: AttachmentBlob
) -> str:
    path = f"{category}/{message_id}/{blob.filename}"
    gcs_blob = bucket.blob(path)
    gcs_blob.upload_from_string(blob.data, content_type=blob.mime_type)
    return f"gs://{bucket.name}/{path}"


async def _persist_receipt(
    session: AsyncSession,
    *,
    message_id: str,
    category: str,
    extraction: ReceiptExtraction,
    gcs_uris: List[tuple[str, str]],
) -> Optional[Receipt]:
    existing = await session.execute(
        select(Receipt).where(Receipt.raw_email_id == message_id)
    )
    if existing.scalar_one_or_none() is not None:
        logger.info("receipt for message %s already exists, skipping", message_id)
        return None

    try:
        parsed_date = date.fromisoformat(extraction.date)
    except ValueError:
        logger.warning("invalid date %s from LLM, using today", extraction.date)
        parsed_date = date.today()

    recurring = (
        RecurringType.ONGOING
        if extraction.recurring_type == "ongoing"
        else RecurringType.ONE_OFF
    )

    receipt = Receipt(
        id=uuid.uuid4(),
        payee=extraction.payee,
        amount=extraction.amount,
        date=parsed_date,
        inferred_purpose=extraction.inferred_purpose,
        category_variable=category,
        recurring_type=recurring,
        raw_email_id=message_id,
    )
    session.add(receipt)
    await session.flush()

    for uri, mime in gcs_uris:
        session.add(
            Attachment(
                id=uuid.uuid4(),
                receipt_id=receipt.id,
                gcs_uri=uri,
                file_type=mime,
            )
        )

    await session.commit()
    return receipt


async def process_message(
    service,
    bucket: storage.Bucket,
    parser: DocumentParser,
    session: AsyncSession,
    message_meta: dict,
) -> Optional[Receipt]:
    message_id = message_meta["id"]
    msg = (
        service.users()
        .messages()
        .get(userId="me", id=message_id, format="full")
        .execute()
    )
    payload = msg.get("payload", {})
    headers = payload.get("headers", [])

    to_header = _extract_header(headers, "To") or _extract_header(headers, "Delivered-To") or ""
    try:
        category = parse_sub_address_variable(to_header)
    except ValueError as exc:
        logger.warning("skipping message %s: %s", message_id, exc)
        return None

    blobs = _collect_attachments(service, message_id, payload)
    if not blobs:
        logger.info("no eligible attachments on message %s", message_id)
        service.users().messages().modify(
            userId="me", id=message_id, body={"removeLabelIds": ["UNREAD"]}
        ).execute()
        return None

    extraction = parser.extract(blobs[0].data, mime_type=blobs[0].mime_type)

    uploaded: List[tuple[str, str]] = []
    for blob in blobs:
        gcs_uri = _upload_to_gcs(bucket, category, message_id, blob)
        uploaded.append((gcs_uri, blob.mime_type))

    receipt = await _persist_receipt(
        session,
        message_id=message_id,
        category=category,
        extraction=extraction,
        gcs_uris=uploaded,
    )

    service.users().messages().modify(
        userId="me", id=message_id, body={"removeLabelIds": ["UNREAD"]}
    ).execute()

    return receipt


async def poll_inbox_once() -> int:
    """Process all currently-unread receipt emails. Returns count processed."""
    bucket_name = os.environ["GCS_BUCKET_NAME"]
    storage_client = storage.Client(project=os.getenv("GCP_PROJECT_ID"))
    bucket = storage_client.bucket(bucket_name)

    service = _build_gmail_service()
    parser = DocumentParser()

    query = "is:unread to:jamestinsley.receipts@gmail.com"
    listing = service.users().messages().list(userId="me", q=query).execute()
    messages = listing.get("messages", [])

    processed = 0
    async with AsyncSessionLocal() as session:
        for meta in messages:
            try:
                if await process_message(service, bucket, parser, session, meta):
                    processed += 1
            except Exception:
                logger.exception("failed to process message %s", meta.get("id"))
    return processed


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    count = asyncio.run(poll_inbox_once())
    logger.info("processed %d messages", count)


if __name__ == "__main__":
    main()

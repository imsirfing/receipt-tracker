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
from datetime import date, datetime, timezone
from typing import Iterable, List, Optional

from google.cloud import storage
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import AsyncSessionLocal
from app.models.pending_email import PendingEmail
from app.models.receipt import Attachment, Receipt, RecurringType
from app.services.document_parser import DocumentParser, NotAReceiptError, ReceiptExtraction
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


def archive_gmail_message(message_id: str) -> None:
    """Remove INBOX and UNREAD labels from a Gmail message (archive it)."""
    service = _build_gmail_service()
    service.users().messages().modify(
        userId="me", id=message_id, body={"removeLabelIds": ["INBOX", "UNREAD"]}
    ).execute()


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


def _extract_body_text(payload: dict) -> str:
    """Recursively extract plain text (or HTML fallback) from a Gmail message payload."""
    mime = (payload.get("mimeType") or "").lower()
    body = payload.get("body") or {}
    data = body.get("data", "")

    if mime == "text/plain" and data:
        return base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="replace")

    # Walk multipart parts, prefer text/plain, fall back to text/html
    parts = payload.get("parts") or []
    plain = ""
    html = ""
    for part in parts:
        part_mime = (part.get("mimeType") or "").lower()
        part_data = (part.get("body") or {}).get("data", "")
        if part_mime == "text/plain" and part_data:
            plain += base64.urlsafe_b64decode(part_data.encode("utf-8")).decode("utf-8", errors="replace")
        elif part_mime == "text/html" and part_data:
            raw_html = base64.urlsafe_b64decode(part_data.encode("utf-8")).decode("utf-8", errors="replace")
            # Strip HTML tags for a rough plain-text version
            import re
            html += re.sub(r"<[^>]+>", " ", raw_html)
        elif part_mime.startswith("multipart/"):
            plain += _extract_body_text(part)

    return plain or html or "(no body text)"


def _extract_html_body(payload: dict) -> str | None:
    """Recursively extract the HTML body from a Gmail message payload."""
    mime = (payload.get("mimeType") or "").lower()
    body = payload.get("body") or {}
    data = body.get("data", "")

    if mime == "text/html" and data:
        return base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="replace")

    parts = payload.get("parts") or []
    # Walk multipart, prefer text/html
    for part in parts:
        part_mime = (part.get("mimeType") or "").lower()
        part_data = (part.get("body") or {}).get("data", "")
        if part_mime == "text/html" and part_data:
            return base64.urlsafe_b64decode(part_data.encode("utf-8")).decode("utf-8", errors="replace")
        # Recurse into nested multipart
        result = _extract_html_body(part)
        if result:
            return result
    return None


async def screenshot_gmail_message(message_id: str) -> bytes | None:
    """
    Fetch a Gmail message's HTML body and return a PNG screenshot of it.
    Returns None if the message cannot be fetched or rendered.
    """
    import tempfile
    import asyncio
    try:
        service = _build_gmail_service()
        msg = service.users().messages().get(userId="me", id=message_id, format="full").execute()
        payload = msg.get("payload", {})
        html_body = _extract_html_body(payload)

        if not html_body:
            # Fallback: render plain text as simple HTML
            plain = _extract_body_text(payload)
            if not plain:
                return None
            html_body = f"<html><body><pre style='font-family:sans-serif;white-space:pre-wrap;padding:24px'>{plain}</pre></body></html>"

        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            )
            page = await browser.new_page(viewport={"width": 900, "height": 1200})

            # Write HTML to temp file and load it
            with tempfile.NamedTemporaryFile(suffix=".html", mode="w", encoding="utf-8", delete=False) as f:
                f.write(html_body)
                tmp_path = f.name

            await page.goto(f"file://{tmp_path}")
            await page.wait_for_timeout(500)  # let images/fonts settle

            # Full-page screenshot, cap at ~8000px to avoid huge files
            screenshot_bytes = await page.screenshot(full_page=True, type="png")
            await browser.close()

            import os
            os.unlink(tmp_path)

            return screenshot_bytes

    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Email screenshot failed for %s: %s", message_id, exc)
        return None


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
    gcs_uris: List[tuple[str, str, Optional[str]]],
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
        payment_category=extraction.payment_category,
        payment_detail=extraction.payment_detail,
        category_variable=category,
        recurring_type=recurring,
        raw_email_id=message_id,
        source="gmail_auto",
        ingested_at=datetime.now(timezone.utc),
    )
    session.add(receipt)
    await session.flush()

    for uri, mime, fname in gcs_uris:
        session.add(
            Attachment(
                id=uuid.uuid4(),
                receipt_id=receipt.id,
                gcs_uri=uri,
                file_type=mime,
                filename=fname,
            )
        )

    await session.commit()
    return receipt


async def _persist_pending_email(
    session: AsyncSession,
    *,
    message_id: str,
    subject: str,
    from_address: str,
    body_preview: str,
    category: str,
    skip_reason: str,
    received_date: Optional[str] = None,
) -> bool:
    """Store a non-receipt email for manual review. Returns False if already stored."""
    existing = await session.execute(
        select(PendingEmail).where(PendingEmail.gmail_message_id == message_id)
    )
    if existing.scalar_one_or_none() is not None:
        logger.info("pending email %s already exists, skipping", message_id)
        return False

    session.add(
        PendingEmail(
            id=uuid.uuid4(),
            gmail_message_id=message_id,
            subject=subject,
            from_address=from_address,
            body_preview=body_preview[:10_000],
            category_variable=category,
            skip_reason=skip_reason,
            received_date=received_date,
        )
    )
    await session.commit()
    return True


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
    subject = _extract_header(headers, "Subject") or "(no subject)"
    from_address = _extract_header(headers, "From") or ""
    date_header = _extract_header(headers, "Date") or ""

    # Parse received date from Date header (best-effort YYYY-MM-DD)
    received_date: Optional[str] = None
    if date_header:
        import email.utils
        parsed_tuple = email.utils.parsedate(date_header)
        if parsed_tuple:
            import time
            try:
                from datetime import date as _date
                ts = time.mktime(parsed_tuple)
                from datetime import datetime as _dt
                received_date = _dt.fromtimestamp(ts).strftime("%Y-%m-%d")
            except Exception:
                pass

    try:
        category = parse_sub_address_variable(to_header)
    except ValueError as exc:
        logger.warning("skipping message %s: %s", message_id, exc)
        return None

    body_text = _extract_body_text(payload)[:15_000]  # cap at ~4k tokens to stay well within limits
    blobs = _collect_attachments(service, message_id, payload)
    attachment_pairs = [(b.data, b.mime_type) for b in blobs]

    try:
        extraction = parser.extract_from_email(
            subject, body_text, attachments=attachment_pairs or None
        )
    except NotAReceiptError as exc:
        logger.info("message %s is not a receipt (%s), storing for review", message_id, exc.reason)
        await _persist_pending_email(
            session,
            message_id=message_id,
            subject=subject,
            from_address=from_address,
            body_preview=body_text,
            category=category,
            skip_reason=exc.reason,
            received_date=received_date,
        )
        service.users().messages().modify(
            userId="me", id=message_id, body={"removeLabelIds": ["UNREAD"]}
        ).execute()
        return None

    # Only upload to GCS after confirming it's a real receipt
    uploaded: List[tuple[str, str, Optional[str]]] = []
    for blob in blobs:
        gcs_uri = _upload_to_gcs(bucket, category, message_id, blob)
        uploaded.append((gcs_uri, blob.mime_type, blob.filename or None))

    receipt = await _persist_receipt(
        session,
        message_id=message_id,
        category=category,
        extraction=extraction,
        gcs_uris=uploaded,
    )

    service.users().messages().modify(
        userId="me", id=message_id, body={"removeLabelIds": ["INBOX", "UNREAD"]}
    ).execute()

    return receipt


async def poll_inbox_once() -> int:
    """Process all receipt emails (read or unread). Returns count of newly processed receipts."""
    bucket_name = os.environ["GCS_BUCKET_NAME"]
    storage_client = storage.Client(project=os.getenv("GCP_PROJECT_ID"))
    bucket = storage_client.bucket(bucket_name)

    service = _build_gmail_service()
    parser = DocumentParser()

    # Do NOT filter by is:unread — emails already opened in Gmail would be missed.
    # Deduplication is handled by the raw_email_id uniqueness check in _persist_receipt.
    query = "to:jamestinsley.receipts"
    messages: List[dict] = []
    page_token: Optional[str] = None
    while True:
        kwargs: dict = {"userId": "me", "q": query, "maxResults": 500}
        if page_token:
            kwargs["pageToken"] = page_token
        listing = service.users().messages().list(**kwargs).execute()
        messages.extend(listing.get("messages", []))
        page_token = listing.get("nextPageToken")
        if not page_token:
            break

    processed = 0
    async with AsyncSessionLocal() as session:
        # Batch-load all known IDs upfront — one query each, then in-memory lookups.
        # This avoids N DB round-trips (and N LLM calls) for already-processed messages.
        receipt_rows = await session.execute(select(Receipt.raw_email_id))
        known_receipt_ids: set[str] = {r[0] for r in receipt_rows if r[0]}

        pending_rows = await session.execute(select(PendingEmail.gmail_message_id))
        known_pending_ids: set[str] = {r[0] for r in pending_rows if r[0]}

        logger.info(
            "inbox: %d messages | already ingested: %d receipts + %d pending/tombstoned — processing %d new",
            len(messages),
            len(known_receipt_ids),
            len(known_pending_ids),
            len([m for m in messages if m.get("id") not in known_receipt_ids and m.get("id") not in known_pending_ids]),
        )

        for meta in messages:
            msg_id = meta.get("id", "")
            if msg_id in known_receipt_ids or msg_id in known_pending_ids:
                continue
            try:
                if await process_message(service, bucket, parser, session, meta):
                    processed += 1
            except Exception as exc:
                logger.exception("failed to process message %s", msg_id)
                # Fetch real subject/from for the tombstone so it's reviewable
                subject = "(parse error)"
                from_address = ""
                try:
                    msg_meta = service.users().messages().get(
                        userId="me", messageId=msg_id, format="metadata",
                        metadataHeaders=["Subject", "From"]
                    ).execute()
                    headers = msg_meta.get("payload", {}).get("headers", [])
                    subject = _extract_header(headers, "Subject") or "(parse error)"
                    from_address = _extract_header(headers, "From") or ""
                except Exception:
                    logger.warning("could not fetch headers for tombstone %s", msg_id)
                try:
                    await _persist_pending_email(
                        session,
                        message_id=msg_id,
                        subject=subject,
                        from_address=from_address,
                        body_preview="",
                        category="uncategorized",
                        skip_reason=f"parse error: {exc}",
                    )
                    known_pending_ids.add(msg_id)  # prevent duplicate tombstones in same run
                except Exception:
                    logger.exception("failed to tombstone message %s", msg_id)
    return processed


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    count = asyncio.run(poll_inbox_once())
    logger.info("processed %d messages", count)


if __name__ == "__main__":
    main()

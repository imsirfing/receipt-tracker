from __future__ import annotations

import io
import logging
import os
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends
from google.cloud import storage
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.receipt import Receipt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

CATEGORIES = {"personal", "realestate", "traverse", "edgehill"}


class ReportRequest(BaseModel):
    message: str


class ReportResponse(BaseModel):
    pdf_url: str


def _parse_intent(message: str) -> Dict[str, Optional[object]]:
    """Tiny rule-based intent parser — extract category and reimbursement filter from text."""
    lowered = message.lower()
    category: Optional[str] = None
    for cat in CATEGORIES:
        if cat in lowered:
            category = cat
            break

    is_reimbursed: Optional[bool] = None
    if "unreimbursed" in lowered or "not reimbursed" in lowered or "outstanding" in lowered:
        is_reimbursed = False
    elif re.search(r"\breimbursed\b", lowered):
        is_reimbursed = True

    return {"category": category, "is_reimbursed": is_reimbursed}


async def _query_receipts(
    session: AsyncSession, filters: Dict[str, Optional[object]]
) -> List[Receipt]:
    stmt = select(Receipt)
    if filters.get("category") is not None:
        stmt = stmt.where(Receipt.category_variable == filters["category"])
    if filters.get("is_reimbursed") is not None:
        stmt = stmt.where(Receipt.is_reimbursed.is_(filters["is_reimbursed"]))
    stmt = stmt.order_by(Receipt.date.desc())
    result = await session.execute(stmt)
    return list(result.scalars().all())


def _category_totals(receipts: List[Receipt]) -> List[Tuple[str, float]]:
    totals: Dict[str, float] = {}
    for r in receipts:
        totals[r.category_variable] = totals.get(r.category_variable, 0.0) + float(r.amount)
    return sorted(totals.items(), key=lambda x: x[1], reverse=True)


def _render_bar_chart(totals: List[Tuple[str, float]]) -> Optional[io.BytesIO]:
    if not totals:
        return None
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return None

    labels = [t[0] for t in totals]
    values = [t[1] for t in totals]
    fig, ax = plt.subplots(figsize=(6, 3))
    ax.bar(labels, values, color="#4F46E5")
    ax.set_ylabel("Total spend ($)")
    ax.set_title("Spend by category")
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120)
    plt.close(fig)
    buf.seek(0)
    return buf


def _build_pdf(message: str, receipts: List[Receipt]) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
    )
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph("Receipt Report", styles["Title"]))
    story.append(Paragraph(f"Query: <i>{message}</i>", styles["Normal"]))
    story.append(
        Paragraph(
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 0.2 * inch))

    totals = _category_totals(receipts)
    total_spend = sum(v for _, v in totals)
    story.append(
        Paragraph(
            f"<b>{len(receipts)}</b> receipts &middot; total <b>${total_spend:,.2f}</b>",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 0.15 * inch))

    chart = _render_bar_chart(totals)
    if chart is not None:
        story.append(Image(chart, width=5.5 * inch, height=2.5 * inch))
        story.append(Spacer(1, 0.2 * inch))
    else:
        summary_rows = [["Category", "Total"]]
        for cat, val in totals:
            summary_rows.append([cat, f"${val:,.2f}"])
        if len(summary_rows) > 1:
            t = Table(summary_rows, hAlign="LEFT")
            t.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4F46E5")),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ]
                )
            )
            story.append(t)
            story.append(Spacer(1, 0.2 * inch))

    rows = [["Date", "Payee", "Category", "Amount", "Reimbursed"]]
    for r in receipts[:200]:
        rows.append(
            [
                r.date.isoformat(),
                r.payee,
                r.category_variable,
                f"${float(r.amount):,.2f}",
                "yes" if r.is_reimbursed else "no",
            ]
        )

    table = Table(rows, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
            ]
        )
    )
    story.append(table)

    doc.build(story)
    return buffer.getvalue()


def _upload_report(pdf_bytes: bytes) -> str:
    bucket_name = os.environ.get("GCS_BUCKET_NAME", "kelton-receipts")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    object_path = f"reports/{timestamp}.pdf"

    client = storage.Client(project=os.getenv("GCP_PROJECT_ID"))
    blob = client.bucket(bucket_name).blob(object_path)
    blob.upload_from_string(pdf_bytes, content_type="application/pdf")
    return f"https://storage.googleapis.com/{bucket_name}/{object_path}"


@router.post("/report", response_model=ReportResponse)
async def chat_report(
    payload: ReportRequest,
    session: AsyncSession = Depends(get_session),
) -> ReportResponse:
    filters = _parse_intent(payload.message)
    receipts = await _query_receipts(session, filters)
    pdf_bytes = _build_pdf(payload.message, receipts)
    pdf_url = _upload_report(pdf_bytes)
    return ReportResponse(pdf_url=pdf_url)

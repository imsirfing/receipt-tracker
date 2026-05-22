"""
Report PDF endpoint — generates a reportlab PDF of unreimbursed expenses.

GET /api/reports/unreimbursed/pdf
  Accepts the same filter params as /api/reports/unreimbursed.
  Calls the same aggregation logic and renders the result as a PDF with:
    - Cover page: summary stats + filter info
    - By-category table with amounts and percentages
    - Monthly breakdown table
    - Full receipt list
"""
from __future__ import annotations

import io
from datetime import date as _Date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.auth import get_current_user
from app.db import get_session
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/api/reports", tags=["reports"])

# ── Colour palette (mirrors frontend) ────────────────────────────────────────
_PALETTE_HEX = [
    "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
    "#94a3b8", "#e11d48",
]


def _hex_to_rl(h: str) -> colors.HexColor:
    return colors.HexColor(h)


def _cat_color(idx: int) -> colors.HexColor:
    return _hex_to_rl(_PALETTE_HEX[idx % len(_PALETTE_HEX)])


def _fmt_currency(v: float) -> str:
    return f"${v:,.2f}"


# ── PDF endpoint ──────────────────────────────────────────────────────────────

@router.get("/unreimbursed/pdf")
async def get_unreimbursed_report_pdf(
    filter_by: Optional[str] = Query(None),
    filter_value: Optional[str] = Query(None),
    date_start: Optional[str] = Query(None),
    date_end: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_session),
    current_user: dict = Depends(get_current_user),
):
    # Re-use the same query logic from the JSON endpoint
    from app.routes.reports import get_unreimbursed_report

    date_start_parsed: Optional[_Date] = None
    date_end_parsed: Optional[_Date] = None
    if date_start:
        try:
            date_start_parsed = _Date.fromisoformat(date_start)
        except ValueError:
            pass
    if date_end:
        try:
            date_end_parsed = _Date.fromisoformat(date_end)
        except ValueError:
            pass

    report = await get_unreimbursed_report(
        filter_by=filter_by,
        filter_value=filter_value,
        date_start=date_start_parsed,
        date_end=date_end_parsed,
        limit=1000,
        offset=0,
        session=session,
        current_user=current_user,
    )

    pdf_bytes = _build_pdf(report, filter_by, filter_value, date_start, date_end)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="unreimbursed-report-{ts}.pdf"',
        },
    )


# ── PDF builder ───────────────────────────────────────────────────────────────

def _build_pdf(
    report: object,  # UnreimbursedReportOut
    filter_by: Optional[str],
    filter_value: Optional[str],
    date_start: Optional[str],
    date_end: Optional[str],
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontSize=20,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=2,
    )
    section_style = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontSize=12,
        textColor=colors.HexColor("#334155"),
        spaceBefore=14,
        spaceAfter=6,
    )
    body = styles["Normal"]

    col_width = 7.0 * inch  # usable width

    story = []

    # ── Cover / header ────────────────────────────────────────────────────────
    story.append(Paragraph("Unreimbursed Expense Report", title_style))
    generated_at = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")
    story.append(Paragraph(f"Generated: {generated_at}", subtitle_style))

    # Filter context
    filter_parts = []
    if filter_by and filter_value:
        filter_parts.append(f"Filter: {filter_by} = {filter_value}")
    if date_start:
        filter_parts.append(f"From: {date_start}")
    if date_end:
        filter_parts.append(f"To: {date_end}")
    if filter_parts:
        story.append(Paragraph("  ·  ".join(filter_parts), subtitle_style))

    story.append(Spacer(1, 0.1 * inch))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e2e8f0")))
    story.append(Spacer(1, 0.15 * inch))

    # ── Summary stat boxes (as a 4-column table) ──────────────────────────────
    s = report.summary  # type: ignore
    stat_data = [
        ["Total Owed", "Receipts", "Avg per Receipt", "Date Range"],
        [
            _fmt_currency(s.total),
            str(s.count),
            _fmt_currency(s.avg),
            f"{s.oldest_date or '—'} → {s.newest_date or '—'}"
            if s.oldest_date != s.newest_date
            else (str(s.oldest_date) if s.oldest_date else "—"),
        ],
    ]
    stat_table = Table(stat_data, colWidths=[col_width / 4] * 4)
    stat_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
        ("BACKGROUND", (0, 1), (-1, 1), colors.white),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#64748b")),
        ("TEXTCOLOR", (0, 1), (-1, 1), colors.HexColor("#1e293b")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 1), (-1, 1), 14),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("ROUNDEDCORNERS", (0, 0), (-1, -1), [4, 4, 4, 4]),
    ]))
    story.append(stat_table)

    # ── By category ──────────────────────────────────────────────────────────
    if report.by_category:  # type: ignore
        story.append(Paragraph("By Category", section_style))
        cat_header = ["Category", "Amount", "Count", "% of Total"]
        cat_rows = [cat_header]
        for i, c in enumerate(report.by_category):  # type: ignore
            cat_rows.append([
                c.category,
                _fmt_currency(c.total),
                str(c.count),
                f"{c.pct:.1f}%",
            ])
        # Totals row
        cat_rows.append([
            "TOTAL",
            _fmt_currency(s.total),
            str(s.count),
            "100%",
        ])

        cat_table = Table(
            cat_rows,
            colWidths=[col_width * 0.4, col_width * 0.25, col_width * 0.15, col_width * 0.2],
        )
        cat_style = [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 0), (0, -1), "LEFT"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            # Category colour stripe on first column
        ]
        for i, c in enumerate(report.by_category):  # type: ignore
            row_idx = i + 1
            cat_style.append(("TEXTCOLOR", (0, row_idx), (0, row_idx), _cat_color(i)))
        # Totals row styling
        last = len(cat_rows) - 1
        cat_style += [
            ("BACKGROUND", (0, last), (-1, last), colors.HexColor("#f8fafc")),
            ("FONTNAME", (0, last), (-1, last), "Helvetica-Bold"),
        ]
        cat_table.setStyle(TableStyle(cat_style))
        story.append(cat_table)

    # ── By month ──────────────────────────────────────────────────────────────
    if report.by_month:  # type: ignore
        story.append(Paragraph("Monthly Breakdown", section_style))
        month_rows = [["Month", "Amount", "Count"]]
        for m in report.by_month:  # type: ignore
            month_rows.append([m.label, _fmt_currency(m.total), str(m.count)])

        month_table = Table(
            month_rows,
            colWidths=[col_width * 0.4, col_width * 0.35, col_width * 0.25],
        )
        month_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (0, 0), (0, -1), "LEFT"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ]))
        story.append(month_table)

    # ── Receipt list ──────────────────────────────────────────────────────────
    if report.receipts:  # type: ignore
        story.append(Paragraph(f"Receipts ({s.count})", section_style))
        rec_rows = [["Date", "Payee", "Category", "Type", "Owner", "Amount"]]
        for r in report.receipts:  # type: ignore
            rec_rows.append([
                str(r.date),
                r.payee[:36] + "…" if len(r.payee) > 36 else r.payee,
                r.category_variable or "—",
                (r.payment_category or "—")[:20],
                (r.reimbursement_owner or "—")[:20],
                _fmt_currency(r.amount),
            ])
        # Grand total row
        rec_rows.append(["", "", "", "", "TOTAL", _fmt_currency(s.total)])

        rec_table = Table(
            rec_rows,
            colWidths=[
                col_width * 0.11,
                col_width * 0.28,
                col_width * 0.15,
                col_width * 0.16,
                col_width * 0.16,
                col_width * 0.14,
            ],
            repeatRows=1,
        )
        last = len(rec_rows) - 1
        rec_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (5, 0), (5, -1), "RIGHT"),
            ("ALIGN", (0, 0), (4, -1), "LEFT"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("ROWBACKGROUNDS", (0, 1), (-1, last - 1), [colors.white, colors.HexColor("#f8fafc")]),
            ("BACKGROUND", (0, last), (-1, last), colors.HexColor("#f1f5f9")),
            ("FONTNAME", (0, last), (-1, last), "Helvetica-Bold"),
        ]))
        story.append(rec_table)

    doc.build(story)
    buf.seek(0)
    return buf.read()

"""
Report PDF endpoint — generates a reportlab PDF of unreimbursed expenses.

GET /api/reports/unreimbursed/pdf
  Accepts the same filter params as /api/reports/unreimbursed.
  Calls the same aggregation logic and renders the result as a PDF with:
    - Cover page: summary stats + filter info
    - Charts: pie (by category/payment type) + stacked bar (monthly breakdown)
    - By-category table with amounts and percentages
    - Monthly breakdown table
    - Full receipt list
"""
from __future__ import annotations

import io
from datetime import date as _Date, datetime, timezone
from typing import List, Optional

# Use non-interactive Agg backend — no display server needed in Cloud Run
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    Image,
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


def _cat_color_mpl(idx: int) -> str:
    return _PALETTE_HEX[idx % len(_PALETTE_HEX)]


def _fmt_currency(v: float) -> str:
    return f"${v:,.2f}"


# ── Chart helpers (matplotlib → PNG → reportlab Image) ────────────────────────

def _currency_ticker(v: float, _=None) -> str:
    return f"${v/1000:.0f}k" if v >= 1000 else f"${v:.0f}"


def _pie_image(items, w_in: float = 3.2, h_in: float = 2.6) -> Optional[Image]:
    """Pie chart from a list of CategoryStat-like objects."""
    if not items:
        return None
    # Filter out zero/negative totals — matplotlib requires all wedge sizes > 0
    items = [c for c in items if c.total > 0]
    if not items:
        return None
    labels = [c.category for c in items]
    values = [c.total for c in items]
    clrs = [_cat_color_mpl(i) for i in range(len(items))]

    fig, ax = plt.subplots(figsize=(w_in, h_in), dpi=130)
    wedges, _, autotexts = ax.pie(
        values,
        colors=clrs,
        autopct=lambda pct: f"{pct:.1f}%" if pct > 3 else "",
        startangle=90,
        wedgeprops={"edgecolor": "white", "linewidth": 1.2},
        pctdistance=0.75,
    )
    for at in autotexts:
        at.set_fontsize(6.5)
        at.set_color("white")
        at.set_fontweight("bold")

    ax.legend(
        wedges, labels,
        loc="lower center",
        bbox_to_anchor=(0.5, -0.18),
        ncol=min(3, len(labels)),
        fontsize=6.5,
        frameon=False,
        handlelength=0.8,
        handleheight=0.8,
    )
    fig.patch.set_facecolor("white")
    plt.tight_layout(pad=0.5)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight", dpi=130, facecolor="white")
    plt.close(fig)
    buf.seek(0)
    return Image(buf, width=w_in * inch, height=h_in * inch)


def _stacked_bar_image(
    stacked_rows: list,
    categories: List[str],
    w_in: float = 3.5,
    h_in: float = 2.6,
) -> Optional[Image]:
    """Stacked vertical bar chart from stacked_by_month data."""
    if not stacked_rows or not categories:
        return None
    months = [row["month"] for row in stacked_rows]
    x = np.arange(len(months))

    fig, ax = plt.subplots(figsize=(w_in, h_in), dpi=130)
    bottoms = np.zeros(len(months))
    for i, cat in enumerate(categories):
        vals = np.array([float(row.get(cat, 0)) for row in stacked_rows])
        ax.bar(x, vals, bottom=bottoms, color=_cat_color_mpl(i), label=cat, width=0.55)
        bottoms += vals

    ax.set_xticks(x)
    ax.set_xticklabels(months, rotation=30, ha="right", fontsize=7)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(_currency_ticker))
    ax.tick_params(axis="y", labelsize=7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.set_facecolor("#fafafa")
    ax.grid(axis="y", linestyle="--", alpha=0.4, color="#e2e8f0")
    ax.legend(
        loc="upper left",
        fontsize=6.5,
        frameon=False,
        ncol=min(2, len(categories)),
    )
    fig.patch.set_facecolor("white")
    plt.tight_layout(pad=0.5)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight", dpi=130, facecolor="white")
    plt.close(fig)
    buf.seek(0)
    return Image(buf, width=w_in * inch, height=h_in * inch)


# ── PDF endpoint ──────────────────────────────────────────────────────────────

@router.get("/unreimbursed/pdf")
async def get_unreimbursed_report_pdf(
    filter_by: Optional[str] = Query(None),
    filter_value: Optional[str] = Query(None),
    reimbursement_status: Optional[str] = Query(None),
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
        reimbursement_status=reimbursement_status,
        date_start=date_start_parsed,
        date_end=date_end_parsed,
        limit=1000,
        offset=0,
        session=session,
        current_user=current_user,
    )

    pdf_bytes = _build_pdf(report, filter_by, filter_value, reimbursement_status, date_start, date_end)

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
    reimbursement_status: Optional[str],
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
    _STATUS_LABELS = {
        "none": "Not submitted",
        "pending": "Pending reimbursement",
        "reimbursed": "Reimbursed",
    }
    filter_parts = []
    if filter_by and filter_value:
        filter_parts.append(f"Filter: {filter_by} = {filter_value}")
    if reimbursement_status:
        filter_parts.append(f"Status: {_STATUS_LABELS.get(reimbursement_status, reimbursement_status)}")
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

    # ── Charts ────────────────────────────────────────────────────────────────────
    # In drill-down mode (filter_by=category), show payment_category charts;
    # otherwise show the standard category-level charts.
    is_drill_down = filter_by == "category"
    pie_items = report.by_payment_category if is_drill_down else report.by_category  # type: ignore
    stacked_rows = report.stacked_by_month_payment if is_drill_down else report.stacked_by_month  # type: ignore
    chart_cats = report.payment_categories if is_drill_down else report.categories  # type: ignore

    pie_title = "By Payment Type" if is_drill_down else "By Category"
    bar_title = "Monthly Breakdown by Payment Type" if is_drill_down else "Monthly Breakdown by Category"

    pie_img = _pie_image(pie_items, w_in=3.2, h_in=2.6)
    bar_img = _stacked_bar_image(stacked_rows, chart_cats, w_in=3.5, h_in=2.6)

    if pie_img or bar_img:
        story.append(Spacer(1, 0.15 * inch))
        chart_cells = [
            [
                [Paragraph(pie_title, section_style), pie_img or Spacer(1, 0.1)],
                [Paragraph(bar_title, section_style), bar_img or Spacer(1, 0.1)],
            ]
        ]
        chart_table = Table(
            chart_cells,
            colWidths=[col_width * 0.46, col_width * 0.54],
        )
        chart_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(chart_table)

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

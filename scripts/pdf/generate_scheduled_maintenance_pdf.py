#!/usr/bin/env python3
"""Generate a locked scheduled-maintenance PDF from a TES submission JSON file."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

FONT_REGULAR = "Helvetica"
FONT_BOLD = "Helvetica-Bold"


def register_fonts() -> None:
    global FONT_REGULAR, FONT_BOLD
    regular = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    bold = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
    if regular.exists() and bold.exists():
      pdfmetrics.registerFont(TTFont("TES-Regular", str(regular)))
      pdfmetrics.registerFont(TTFont("TES-Bold", str(bold)))
      FONT_REGULAR = "TES-Regular"
      FONT_BOLD = "TES-Bold"


def value(data: dict[str, Any], key: str, default: str = "-") -> str:
    raw = data.get(key)
    if raw is None or raw == "":
        return default
    return str(raw)


def labelize(raw: str | None) -> str:
    if not raw:
        return "-"
    return raw.replace("_", " ").title()


def cell(text: Any, style: Any) -> Paragraph:
    escaped = str(text if text is not None and text != "" else "-")
    escaped = escaped.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(escaped, style)


def key_value_table(rows: list[tuple[str, str]]) -> Table:
    table = Table([[k, v] for k, v in rows], colWidths=[1.85 * inch, 4.9 * inch])
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d7deea")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f4f7fb")),
        ("FONTNAME", (0, 0), (-1, -1), FONT_REGULAR),
        ("FONTNAME", (0, 0), (0, -1), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def build_pdf(payload: dict[str, Any], output_path: Path) -> None:
    register_fonts()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    title = styles["Title"]
    title.fontName = FONT_BOLD
    title.fontSize = 16
    heading = styles["Heading2"]
    heading.fontName = FONT_BOLD
    heading.fontSize = 10
    body = styles["BodyText"]
    body.fontName = FONT_REGULAR
    body.fontSize = 8
    body.leading = 10

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=letter,
        rightMargin=0.45 * inch,
        leftMargin=0.45 * inch,
        topMargin=0.42 * inch,
        bottomMargin=0.42 * inch,
    )

    vehicle = payload.get("vehicle", {})
    service = payload.get("service", {})
    provider = payload.get("provider", {})
    submitted = payload.get("submitted", {})
    checklist = payload.get("checklist", [])
    actions = payload.get("serviceActions", [])

    story = [
        Paragraph("Preventive / Scheduled Maintenance Report", title),
        Paragraph("Client-submitted locked maintenance record", body),
        Spacer(1, 0.12 * inch),
        Paragraph("Vehicle", heading),
        key_value_table([
            ("Unit Number", value(vehicle, "unitNumber")),
            ("VIN", value(vehicle, "vin")),
            ("Plate", value(vehicle, "plate")),
            ("Year / Make / Model", value(vehicle, "yearMakeModel")),
            ("Tire Size", value(vehicle, "tireSize")),
            ("Owner / Lessor", value(vehicle, "ownershipProviderName")),
        ]),
        Spacer(1, 0.12 * inch),
        Paragraph("Maintenance Program", heading),
        key_value_table([
            ("Program", value(service, "programName")),
            ("Basis", labelize(service.get("basis"))),
            ("Trigger", labelize(service.get("triggerSource"))),
            ("Service Date", value(service, "serviceDate")),
            ("Service Completion", value(service, "serviceCompletionDate")),
            ("Odometer", value(service, "odometer")),
            ("Engine Hours", value(service, "engineHours")),
            ("Due Date", value(service, "dueDate")),
            ("Due Odometer", value(service, "dueOdometer")),
            ("Due Engine Hours", value(service, "dueEngineHours")),
            ("Next Due Date", value(service, "nextDueDate")),
            ("Next Due Odometer", value(service, "nextDueOdometer")),
            ("Next Due Engine Hours", value(service, "nextDueEngineHours")),
            ("Outcome", labelize(service.get("outcome"))),
        ]),
        Spacer(1, 0.12 * inch),
        Paragraph("Facility / Contact", heading),
        key_value_table([
            ("Performed By", labelize(provider.get("performedBy"))),
            ("Facility", value(provider, "facilityName")),
            ("Facility Address", value(provider, "facilityAddress")),
            ("Technician / Contact", value(provider, "technicianName")),
            ("Work Order #", value(provider, "workOrderNumber")),
            ("Invoice #", value(provider, "invoiceNumber")),
        ]),
        Spacer(1, 0.12 * inch),
        Paragraph("Service Actions", heading),
    ]

    action_rows = [[cell("Action", body), cell("Performed", body), cell("Notes", body)]]
    for item in actions:
        action_rows.append([cell(value(item, "action"), body), cell("Yes" if item.get("performed") else "No", body), cell(value(item, "notes"), body)])
    action_table = Table(action_rows, colWidths=[3.0 * inch, 1.0 * inch, 2.75 * inch], repeatRows=1)
    action_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d7deea")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#edf2ff")),
        ("FONTNAME", (0, 0), (-1, -1), FONT_REGULAR),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story += [action_table, Spacer(1, 0.12 * inch), Paragraph("Checklist", heading)]

    checklist_rows = [[cell("System", body), cell("Component", body), cell("Status", body), cell("Notes", body)]]
    for item in checklist:
        checklist_rows.append([
            cell(value(item, "system"), body),
            cell(value(item, "component"), body),
            cell(labelize(item.get("status")), body),
            cell(value(item, "notes"), body),
        ])
    checklist_table = Table(checklist_rows, colWidths=[1.35 * inch, 2.15 * inch, 1.2 * inch, 2.05 * inch], repeatRows=1)
    checklist_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d7deea")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#edf2ff")),
        ("FONTNAME", (0, 0), (-1, -1), FONT_REGULAR),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story += [
        checklist_table,
        Spacer(1, 0.12 * inch),
        Paragraph("Remarks", heading),
        Paragraph(value(payload, "remarks"), body),
        Spacer(1, 0.12 * inch),
        Paragraph("Submission Lock", heading),
        Paragraph("Original submitted values are locked. Corrections must be recorded by addendum.", body),
        Spacer(1, 0.04 * inch),
        key_value_table([
            ("Submitted By", value(submitted, "submittedByName")),
            ("Submitter Role", value(submitted, "submittedByRole")),
            ("Submitted At", value(submitted, "submittedAt")),
            ("Locked At", value(submitted, "lockedAt")),
        ]),
    ]

    doc.build(story)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to scheduled maintenance submission JSON")
    parser.add_argument("--output", required=True, help="Output PDF path")
    args = parser.parse_args()

    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    build_pdf(payload, Path(args.output))


if __name__ == "__main__":
    main()

import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super(NumberedCanvas, self).showPage()
        super(NumberedCanvas, self).save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748b"))
        # Top Header (pages 2+)
        if self._pageNumber > 1:
            self.drawString(54, 11 * inch - 36, "Nepal Airlink — Framed IP & Walled Garden Redirection Architecture")
            self.setStrokeColor(colors.HexColor("#e2e8f0"))
            self.setLineWidth(0.5)
            self.line(54, 11 * inch - 42, 8.5 * inch - 54, 11 * inch - 42)
        
        # Bottom Footer
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(8.5 * inch - 54, 36, page_str)
        self.drawString(54, 36, "CONFIDENTIAL & PROPRIETARY — AIRLINK WISP NETWORK ENGINEERING")
        self.setStrokeColor(colors.HexColor("#e2e8f0"))
        self.setLineWidth(0.5)
        self.line(54, 48, 8.5 * inch - 54, 48)
        self.restoreState()

def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()
    
    # Custom Palette
    c_primary = colors.HexColor("#003164")      # Navy
    c_accent = colors.HexColor("#0284c7")       # Sky blue
    c_dark = colors.HexColor("#0f172a")         # Slate 900
    c_body = colors.HexColor("#334155")         # Slate 700
    c_bg_light = colors.HexColor("#f8fafc")     # Slate 50
    c_border = colors.HexColor("#cbd5e1")       # Slate 300
    c_success = colors.HexColor("#059669")      # Emerald 600
    c_danger = colors.HexColor("#e11d48")       # Rose 600

    # Custom Typography Styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=22,
        leading=26,
        textColor=c_primary,
        spaceAfter=6
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=11,
        leading=15,
        textColor=c_accent,
        spaceAfter=14
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=c_primary,
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=14,
        textColor=c_dark,
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13.5,
        textColor=c_body,
        spaceAfter=6
    )

    callout_style = ParagraphStyle(
        'Callout_Text',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=13,
        textColor=c_primary
    )

    code_style = ParagraphStyle(
        'Code_Style',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#0f172a")
    )

    table_header_style = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white
    )

    table_cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=11,
        textColor=c_body
    )

    story = []

    # Title Banner
    story.append(Paragraph("Framed IP Architecture & Walled Garden Redirection", title_style))
    story.append(Paragraph("Technical Guide: NAS vs. RADIUS IP Allocation & Subscription Lifecycle Workflows", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_primary, spaceBefore=0, spaceAfter=12))

    # Section 1: Concept & The Fundamental Question
    story.append(Paragraph("1. The Core Concept: What is a Framed IP?", h1_style))
    story.append(Paragraph(
        "In broadband access networks (PPPoE & Hotspot) conforming to RFC 2865, <b>Framed-IP-Address</b> represents the "
        "IPv4 address assigned to the subscriber's terminal equipment (e.g. ONT, CPE, or home Wi-Fi router) for the "
        "duration of their point-to-point framed network session.",
        body_style
    ))
    story.append(Paragraph(
        "<b>The Fundamental Question:</b> <i>Should the IP address be allocated by the NAS (MikroTik) or by RADIUS (FreeRADIUS)?</i>",
        body_style
    ))

    # Callout Box
    callout_data = [[
        Paragraph(
            "<b>Industry Standard & Airlink Verdict:</b><br/>"
            "For 95%+ of ISP deployments, <b>the NAS (MikroTik) should always allocate dynamic subscriber IPs</b> from its local "
            "pool. RADIUS should control <i>policy</i> (speed, validity, pool name, address list), but leave local IP leasing to the router hardware.",
            callout_style
        )
    ]]
    callout_table = Table(callout_data, colWidths=[504])
    callout_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#f0fdf4")),
        ('BORDER', (0,0), (-1,-1), 1, colors.HexColor("#86efac")),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(callout_table)
    story.append(Spacer(1, 10))

    # Section 2: Comparison Matrix
    story.append(Paragraph("2. Architectural Comparison: NAS vs. RADIUS Allocation", h1_style))
    
    comp_data = [
        [Paragraph("Evaluation Criteria", table_header_style), Paragraph("NAS Allocation (MikroTik Pool)", table_header_style), Paragraph("RADIUS Allocation (sqlippool / DB)", table_header_style)],
        [
            Paragraph("<b>Reliability & Leases</b>", table_cell_style),
            Paragraph("<b>Zero Ghost Leases:</b> MikroTik tracks physical sessions in kernel memory. If a line drops, the IP is freed immediately.", table_cell_style),
            Paragraph("<b>Ghost Lease Risk:</b> If FreeRADIUS misses an Accounting-Stop packet (power cut, dropped UDP), the IP stays locked in DB forever.", table_cell_style)
        ],
        [
            Paragraph("<b>Database Load</b>", table_cell_style),
            Paragraph("<b>Zero DB Overhead:</b> Authentication is a fast read-only query. IP allocation happens entirely on router hardware.", table_cell_style),
            Paragraph("<b>Heavy DB Locking:</b> Every single dial-in must execute SQL transaction locks (`SELECT FOR UPDATE`) on the `radippool` table.", table_cell_style)
        ],
        [
            Paragraph("<b>Multi-Tower Routing</b>", table_cell_style),
            Paragraph("<b>Automatic Routing:</b> Tower A uses `10.100.0.0/20`, Tower B uses `10.100.16.0/20`. Subnets are aggregated naturally.", table_cell_style),
            Paragraph("<b>Complex Dynamic Routing:</b> RADIUS can lease an IP from a central block to any router, requiring host-route (/32) OSPF/BGP distribution.", table_cell_style)
        ],
        [
            Paragraph("<b>Static Public IPs</b>", table_cell_style),
            Paragraph("<b>Hybrid Override:</b> Set `Framed-IP-Address` in RADIUS only for VIP accounts; MikroTik overrides its local pool automatically.", table_cell_style),
            Paragraph("<b>Centralized Management:</b> All public IP blocks reside in the central database.", table_cell_style)
        ]
    ]

    comp_table = Table(comp_data, colWidths=[110, 197, 197])
    comp_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('BACKGROUND', (0,1), (-1,1), colors.white),
        ('BACKGROUND', (0,2), (-1,2), c_bg_light),
        ('BACKGROUND', (0,3), (-1,3), colors.white),
        ('BACKGROUND', (0,4), (-1,4), c_bg_light),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(comp_table)
    story.append(Spacer(1, 12))

    # Section 3: Walled Garden Workflow Breakdown
    story.append(Paragraph("3. Analysis of the Walled Garden Subscription Redirection Workflow", h1_style))
    story.append(Paragraph(
        "The architecture diagram you provided represents the <b>ISP Walled Garden Pattern</b>. "
        "Instead of abruptly dropping the PPPoE connection with an `Access-Reject`, the subscriber is granted a <b>Restricted Session</b>.",
        body_style
    ))

    # Visual Workflow Representation
    flowchart_data = [
        [
            Paragraph("<b>State</b>", table_header_style),
            Paragraph("<b>RADIUS Decision</b>", table_header_style),
            Paragraph("<b>MikroTik Pool / Subnet</b>", table_header_style),
            Paragraph("<b>Network Access & Customer Experience</b>", table_header_style)
        ],
        [
            Paragraph("<font color='#059669'><b>ACTIVE</b></font>", table_cell_style),
            Paragraph("Returns standard profile:<br/>`Mikrotik-Rate-Limit = 50M/50M`<br/>`Framed-Pool = pool-active`", table_cell_style),
            Paragraph("<b>10.100.0.0/19</b><br/>(Normal Pool)", table_cell_style),
            Paragraph("<b>Full Internet:</b> Standard traffic flow. Unlimited routing through default WAN uplink.", table_cell_style)
        ],
        [
            Paragraph("<font color='#e11d48'><b>EXPIRED</b></font>", table_cell_style),
            Paragraph("Returns redirection policy:<br/>`Framed-Pool = pool-expired`<br/><i>or `Mikrotik-Address-List = EXPIRED`</i>", table_cell_style),
            Paragraph("<b>10.100.32.0/20</b><br/>(Walled Garden Pool)", table_cell_style),
            Paragraph("<b>Firewall Restricted:</b> Port 80/443 redirected to <b>Nepal Airlink Portal</b>. Customer sees renewal invoice.", table_cell_style)
        ],
        [
            Paragraph("<b>RECHARGED</b>", table_cell_style),
            Paragraph("Airlink updates MariaDB (`radreply`)<br/>Sends <b>RADIUS CoA / Disconnect</b> packet to NAS", table_cell_style),
            Paragraph("Re-authenticates into:<br/><b>10.100.0.0/19</b>", table_cell_style),
            Paragraph("<b>Zero-Touch Reconnection:</b> Router reconnects within 2 seconds. Full Internet automatically restored.", table_cell_style)
        ]
    ]

    flowchart_table = Table(flowchart_data, colWidths=[70, 150, 114, 170])
    flowchart_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('BACKGROUND', (0,1), (-1,1), colors.HexColor("#f0fdf4")),
        ('BACKGROUND', (0,2), (-1,2), colors.HexColor("#fff1f2")),
        ('BACKGROUND', (0,3), (-1,3), colors.HexColor("#f8fafc")),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(flowchart_table)
    story.append(Spacer(1, 12))

    # Section 4: Implementation Blueprint
    story.append(Paragraph("4. Technical Implementation Blueprint on MikroTik & FreeRADIUS", h1_style))
    story.append(Paragraph(
        "To achieve this exact workflow without putting IP pool management strain on FreeRADIUS, use either of the two standard methods below:",
        body_style
    ))

    story.append(Paragraph("Method A: Dual IP Pools via `Framed-Pool` (Direct Match to Diagram)", h2_style))
    story.append(Paragraph(
        "<b>1. Configure Pools and Firewall on MikroTik:</b>", body_style
    ))
    
    mkt_config = (
        "/ip pool add name=\"pool-active\" ranges=10.100.0.2-10.100.31.254\n"
        "/ip pool add name=\"pool-expired\" ranges=10.100.32.2-10.100.47.254\n\n"
        "# Redirect HTTP to Nepal Airlink Portal for expired pool:\n"
        "/ip firewall nat add chain=dstnat src-address=10.100.32.0/20 protocol=tcp dst-port=80 \\\n"
        "    action=dst-nat to-addresses=PORTAL_SERVER_IP to-ports=80\n"
        "# Block non-portal traffic for expired pool:\n"
        "/ip firewall filter add chain=forward src-address=10.100.32.0/20 dst-address=!PORTAL_SERVER_IP action=drop"
    )
    
    code_table_a = Table([[Paragraph(mkt_config.replace('\n', '<br/>'), code_style)]], colWidths=[504])
    code_table_a.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#f1f5f9")),
        ('BORDER', (0,0), (-1,-1), 0.5, c_border),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(code_table_a)
    story.append(Spacer(1, 6))

    story.append(Paragraph(
        "<b>2. FreeRADIUS Response (`radreply` SQL table):</b><br/>"
        "• For Active Subscribers: `INSERT INTO radreply (username, attribute, op, value) VALUES ('user', 'Framed-Pool', ':=', 'pool-active');`<br/>"
        "• For Expired Subscribers: `INSERT INTO radreply (username, attribute, op, value) VALUES ('user', 'Framed-Pool', ':=', 'pool-expired');`",
        body_style
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Method B: Single Pool via `Mikrotik-Address-List` (Recommended Best Practice ⭐)", h2_style))
    story.append(Paragraph(
        "MikroTik assigns an IP from one single unified pool. If the subscriber is expired, FreeRADIUS sends the vendor attribute "
        "<b>`Mikrotik-Address-List = EXPIRED`</b>. MikroTik automatically inserts the customer's IP into firewall address-list `EXPIRED`. "
        "The router firewall redirects the `EXPIRED` list to your portal.",
        body_style
    ))

    mkt_config_b = (
        "# Single NAT redirect rule matching the dynamic RADIUS address-list:\n"
        "/ip firewall nat add chain=dstnat src-address-list=EXPIRED protocol=tcp dst-port=80,443 \\\n"
        "    action=dst-nat to-addresses=PORTAL_SERVER_IP to-ports=80\n"
        "/ip firewall filter add chain=forward src-address-list=EXPIRED dst-address=!PORTAL_SERVER_IP action=drop"
    )
    code_table_b = Table([[Paragraph(mkt_config_b.replace('\n', '<br/>'), code_style)]], colWidths=[504])
    code_table_b.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#f1f5f9")),
        ('BORDER', (0,0), (-1,-1), 0.5, c_border),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(code_table_b)
    story.append(Spacer(1, 10))

    # Section 5: Summary Checklist
    story.append(Paragraph("5. Summary & Executive Takeaways", h1_style))
    summary_text = (
        "1. <b>IP Ownership:</b> The NAS (MikroTik) holds physical IP pools (`10.100.0.0/19` and `10.100.32.0/20`). It leases IPs instantly and recovers them on disconnect without DB sync risks.<br/>"
        "2. <b>Policy Ownership:</b> FreeRADIUS decides <i>which</i> pool or address-list the subscriber receives by evaluating their expiration timestamp.<br/>"
        "3. <b>Automated Recovery (CoA):</b> Upon successful payment in the portal, Airlink triggers a RADIUS Disconnect-Request (RFC 3576). The customer router reconnects in under 2 seconds with the active profile."
    )
    story.append(Paragraph(summary_text, body_style))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated PDF: {filename}")

if __name__ == '__main__':
    output_path = "/home/airlink_golden/Framed_IP_and_Walled_Garden_Architecture.pdf"
    build_pdf(output_path)

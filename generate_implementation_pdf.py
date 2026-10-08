import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
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
        # Header on pages 2+
        if self._pageNumber > 1:
            self.drawString(54, 11 * inch - 36, "Airlink v3.0 — Walled Garden & Expired Redirection Implementation Plan")
            self.setStrokeColor(colors.HexColor("#e2e8f0"))
            self.setLineWidth(0.5)
            self.line(54, 11 * inch - 42, 8.5 * inch - 54, 11 * inch - 42)
        
        # Footer on all pages
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(8.5 * inch - 54, 36, page_str)
        self.drawString(54, 36, "NEPAL AIRLINK SYSTEM ENGINEERING — TECHNICAL IMPLEMENTATION BLUEPRINT")
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
    
    # Palette
    c_primary = colors.HexColor("#003164")      # Navy
    c_accent = colors.HexColor("#0284c7")       # Sky blue
    c_dark = colors.HexColor("#0f172a")         # Slate 900
    c_body = colors.HexColor("#334155")         # Slate 700
    c_bg_light = colors.HexColor("#f8fafc")     # Slate 50
    c_border = colors.HexColor("#cbd5e1")       # Slate 300
    c_code_bg = colors.HexColor("#f1f5f9")      # Slate 100
    c_success_bg = colors.HexColor("#f0fdf4")   # Green 50
    c_success_border = colors.HexColor("#86efac")
    c_warn_bg = colors.HexColor("#fffbeb")      # Amber 50
    c_warn_border = colors.HexColor("#fde68a")

    title_style = ParagraphStyle(
        'DocTitle', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=20, leading=24,
        textColor=c_primary, spaceAfter=4
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubTitle', parent=styles['Normal'],
        fontName='Helvetica', fontSize=10.5, leading=14,
        textColor=c_accent, spaceAfter=12
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom', parent=styles['Heading1'],
        fontName='Helvetica-Bold', fontSize=12.5, leading=16,
        textColor=c_primary, spaceBefore=12, spaceAfter=6, keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom', parent=styles['Heading2'],
        fontName='Helvetica-Bold', fontSize=10, leading=13.5,
        textColor=c_dark, spaceBefore=8, spaceAfter=4, keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom', parent=styles['Normal'],
        fontName='Helvetica', fontSize=8.5, leading=12.5,
        textColor=c_body, spaceAfter=5
    )

    callout_style = ParagraphStyle(
        'Callout_Text', parent=styles['Normal'],
        fontName='Helvetica', fontSize=8.5, leading=12,
        textColor=c_primary
    )

    code_style = ParagraphStyle(
        'Code_Style', parent=styles['Normal'],
        fontName='Courier', fontSize=7.5, leading=10.5,
        textColor=colors.HexColor("#0f172a")
    )

    table_header_style = ParagraphStyle(
        'TableHeader', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=8, leading=10.5,
        textColor=colors.white
    )

    table_cell_style = ParagraphStyle(
        'TableCell', parent=styles['Normal'],
        fontName='Helvetica', fontSize=7.8, leading=10.5,
        textColor=c_body
    )

    story = []

    # Title Banner
    story.append(Paragraph("Airlink PPPoE Walled Garden Implementation Blueprint", title_style))
    story.append(Paragraph("Step-by-Step Architecture & Code Roadmap for Expired Redirection and Self-Care Payment Recovery", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_primary, spaceBefore=0, spaceAfter=10))

    # Executive Overview
    story.append(Paragraph("1. Executive Summary & Objective", h1_style))
    story.append(Paragraph(
        "Currently, when an Airlink PPPoE subscriber expires, the system deletes their rows from the FreeRADIUS `radcheck` "
        "and `radreply` tables. FreeRADIUS then answers incoming connection attempts with a hard <b>Access-Reject</b>. "
        "This drops the subscriber's PPP link entirely, turning off internet lights on their router and preventing them from "
        "accessing any portal to recharge.",
        body_style
    ))
    story.append(Paragraph(
        "<b>The Goal:</b> Transform this into a <b>Soft Accept (Walled Garden)</b>. Expired subscribers remain connected, "
        "receive an isolated IP (`10.100.32.0/20`), and get redirected by the MikroTik firewall directly to the "
        "<b>Nepal Airlink Recharge Portal</b>. Upon online payment, the billing system updates FreeRADIUS and fires a "
        "RADIUS CoA Disconnect packet (RFC 3576). The router reconnects in under 2 seconds with the active profile and full internet access.",
        body_style
    ))

    # Architecture Comparison Box
    callout_data = [[
        Paragraph(
            "<b>Key Architectural Principle:</b><br/>"
            "FreeRADIUS does <b>not</b> assign individual IP numbers. Instead, FreeRADIUS replies with <b>`Framed-Pool := pool-expired`</b> "
            "(or <b>`Mikrotik-Address-List := EXPIRED`</b>). MikroTik handles physical IP leasing from its local hardware pools, "
            "preserving high performance and eliminating database pool desync.",
            callout_style
        )
    ]]
    c_box = Table(callout_data, colWidths=[504])
    c_box.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c_success_bg),
        ('BORDER', (0,0), (-1,-1), 1, c_success_border),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(c_box)
    story.append(Spacer(1, 8))

    # Section 2: Component Breakdown
    story.append(Paragraph("2. Required Modifications Across Airlink Subsystems", h1_style))
    
    comp_data = [
        [Paragraph("Subsystem", table_header_style), Paragraph("Files / Location", table_header_style), Paragraph("Required Modifications", table_header_style)],
        [
            Paragraph("<b>1. RADIUS Attributes Generator</b>", table_cell_style),
            Paragraph("`app/Services/PppoeRadiusService.php`", table_cell_style),
            Paragraph("Add conditional attribute generation: if subscriber status is `expired` or `suspended`, set `Framed-Pool := pool-expired` and throttle `Mikrotik-Rate-Limit := 1M/1M`. If `active`, set `Framed-Pool := pool-active` and full plan bandwidth.", table_cell_style)
        ],
        [
            Paragraph("<b>2. Expiration Sync Cron</b>", table_cell_style),
            Paragraph("`app/Console/Commands/SyncPppoeStatus.php`", table_cell_style),
            Paragraph("Stop deleting `radcheck`/`radreply` rows on expiration! Instead, keep `Cleartext-Password` in `radcheck` and update `radreply` to the expired pool/rate limit. Fire CoA Disconnect so MikroTik immediately reconnects the user into the expired pool.", table_cell_style)
        ],
        [
            Paragraph("<b>3. Recharge & Renewal Service</b>", table_cell_style),
            Paragraph("`app/Services/PppoeRechargeService.php`", table_cell_style),
            Paragraph("When recharge succeeds (cash or online payment), rebuild `radreply` with `pool-active` and original plan bandwidth, then trigger `CoaService::disconnectUsername()` to restore full internet immediately.", table_cell_style)
        ],
        [
            Paragraph("<b>4. MikroTik Router (NAS)</b>", table_cell_style),
            Paragraph("MikroTik RouterOS (`/ip pool`, `/ip firewall`)", table_cell_style),
            Paragraph("Configure two IP pools (`pool-active`, `pool-expired`). Add DST-NAT firewall rules redirecting HTTP/HTTPS from `10.100.32.0/20` to the portal. Whitelist DNS (port 53) and payment gateways (eSewa, Khalti, ConnectIPS).", table_cell_style)
        ],
        [
            Paragraph("<b>5. Customer Self-Care Portal</b>", table_cell_style),
            Paragraph("Frontend / Web Route (`/portal/renew`)", table_cell_style),
            Paragraph("Portal detects subscriber identity from calling IP (`radacct.framedipaddress`) or token, shows due amount, processes payment gateway webhook, and triggers the Airlink recharge pipeline.", table_cell_style)
        ]
    ]

    comp_table = Table(comp_data, colWidths=[95, 145, 264])
    comp_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('BACKGROUND', (0,1), (-1,1), colors.white),
        ('BACKGROUND', (0,2), (-1,2), c_bg_light),
        ('BACKGROUND', (0,3), (-1,3), colors.white),
        ('BACKGROUND', (0,4), (-1,4), c_bg_light),
        ('BACKGROUND', (0,5), (-1,5), colors.white),
        ('TOPPADDING', (0,0), (-1,-1), 4.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4.5),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(comp_table)
    story.append(Spacer(1, 10))

    # Section 3: Exact Code Implementation
    story.append(Paragraph("3. Concrete Code Changes in Airlink Backend", h1_style))

    story.append(Paragraph("A. Update `app/Services/PppoeRadiusService.php`", h2_style))
    code_radius = (
        "// Inside rows(PppoeCustomer $customer):\n"
        "public function rows(PppoeCustomer $customer): array {\n"
        "    $isExpired = in_array($customer->status, ['expired', 'suspended']);\n\n"
        "    // radcheck: Always allow password authentication so the router connects\n"
        "    $check = [\n"
        "        ['username' => $customer->username, 'attribute' => 'Cleartext-Password', 'op' => ':=', 'value' => $customer->password],\n"
        "        ['username' => $customer->username, 'attribute' => 'Simultaneous-Use', 'op' => ':=', 'value' => '1'],\n"
        "    ];\n\n"
        "    // radreply: Assign pool and rate limits based on subscription state\n"
        "    $reply = [\n"
        "        ['username' => $customer->username, 'attribute' => 'Acct-Interim-Interval', 'op' => ':=', 'value' => '300'],\n"
        "        ['username' => $customer->username, 'attribute' => 'Framed-Pool', 'op' => ':=', 'value' => $isExpired ? 'pool-expired' : 'pool-active'],\n"
        "        ['username' => $customer->username, 'attribute' => 'Mikrotik-Rate-Limit', 'op' => ':=', 'value' => $isExpired ? '1M/1M' : ($customer->bandwidth ?: $customer->plan?->bandwidth)],\n"
        "    ];\n"
        "    return ['check' => $check, 'reply' => $reply];\n"
        "}"
    )
    code_t1 = Table([[Paragraph(code_radius.replace('\n', '<br/>').replace(' ', '&nbsp;'), code_style)]], colWidths=[504])
    code_t1.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c_code_bg),
        ('BORDER', (0,0), (-1,-1), 0.5, c_border),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(code_t1)
    story.append(Spacer(1, 6))

    story.append(Paragraph("B. Update `app/Console/Commands/SyncPppoeStatus.php`", h2_style))
    code_sync = (
        "// Inside handle(): When a subscriber expires, update status and radreply instead of deleting\n"
        "foreach ($expiredCustomers as $customer) {\n"
        "    $customer->update(['status' => 'expired']);\n\n"
        "    // Rebuild RADIUS rows with 'pool-expired' rather than deleting credentials\n"
        "    $this->customerService->rebuildRadiusRows($customer);\n\n"
        "    // Force session drop so the router reconnects into the expired pool\n"
        "    try {\n"
        "        $this->coa->disconnectUsername($customer->username);\n"
        "    } catch (\\Throwable $e) {}\n"
        "}"
    )
    code_t2 = Table([[Paragraph(code_sync.replace('\n', '<br/>').replace(' ', '&nbsp;'), code_style)]], colWidths=[504])
    code_t2.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c_code_bg),
        ('BORDER', (0,0), (-1,-1), 0.5, c_border),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(code_t2)
    story.append(Spacer(1, 10))

    # Section 4: MikroTik RouterOS Configuration
    story.append(Paragraph("4. MikroTik RouterOS Configuration (Terminal Script)", h1_style))
    story.append(Paragraph(
        "Run these commands on your MikroTik NAS router. It creates the two pools, points expired users to the portal, "
        "and permits DNS + payment gateways so the customer can successfully complete their transaction:",
        body_style
    ))

    mkt_script = (
        "# 1. Define the Active and Expired Pools\n"
        "/ip pool add name=\"pool-active\" ranges=10.100.0.2-10.100.31.254\n"
        "/ip pool add name=\"pool-expired\" ranges=10.100.32.2-10.100.47.254\n\n"
        "# 2. Create Address List for Portal & Payment Gateways (eSewa, Khalti, ConnectIPS)\n"
        "/ip firewall address-list add list=WALLED_GARDEN_WHITELIST address=portal.airlink.com.np\n"
        "/ip firewall address-list add list=WALLED_GARDEN_WHITELIST address=esewa.com.np\n"
        "/ip firewall address-list add list=WALLED_GARDEN_WHITELIST address=khalti.com\n\n"
        "# 3. Firewall NAT: Redirect Expired HTTP traffic to Nepal Airlink Portal\n"
        "/ip firewall nat add chain=dstnat src-address=10.100.32.0/20 dst-address-list=!WALLED_GARDEN_WHITELIST \\\n"
        "    protocol=tcp dst-port=80 action=dst-nat to-addresses=103.x.x.portal to-ports=80 comment=\"Airlink Portal Redirect\"\n\n"
        "# 4. Firewall Filter: Allow DNS and Whitelisted Payment Sites, Drop General Traffic\n"
        "/ip firewall filter add chain=forward src-address=10.100.32.0/20 protocol=udp dst-port=53 action=accept comment=\"Allow DNS\"\n"
        "/ip firewall filter add chain=forward src-address=10.100.32.0/20 dst-address-list=WALLED_GARDEN_WHITELIST action=accept comment=\"Allow Portal & Payment\"\n"
        "/ip firewall filter add chain=forward src-address=10.100.32.0/20 action=drop comment=\"Drop All Other Expired Traffic\""
    )
    code_t3 = Table([[Paragraph(mkt_script.replace('\n', '<br/>').replace(' ', '&nbsp;'), code_style)]], colWidths=[504])
    code_t3.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), c_code_bg),
        ('BORDER', (0,0), (-1,-1), 0.5, c_border),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(code_t3)
    story.append(Spacer(1, 10))

    # Section 5: Implementation Timeline & Rollout Steps
    story.append(Paragraph("5. Step-by-Step Rollout Checklist", h1_style))
    checklist_data = [
        [Paragraph("Step", table_header_style), Paragraph("Action", table_header_style), Paragraph("Verification / Test", table_header_style)],
        [
            Paragraph("<b>Step 1</b>", table_cell_style),
            Paragraph("Add `pool-active` and `pool-expired` to MikroTik NAS along with the NAT redirect and gateway whitelist rules.", table_cell_style),
            Paragraph("Verify on MikroTik with `/ip pool print` and `/ip firewall nat print`.", table_cell_style)
        ],
        [
            Paragraph("<b>Step 2</b>", table_cell_style),
            Paragraph("Update `PppoeRadiusService.php` to include `Framed-Pool := pool-expired` for expired accounts.", table_cell_style),
            Paragraph("Run `radtest` against an expired test account (`KHPPOE00002`). Verify `Framed-Pool = pool-expired` in Access-Accept.", table_cell_style)
        ],
        [
            Paragraph("<b>Step 3</b>", table_cell_style),
            Paragraph("Update `SyncPppoeStatus.php` cron so that expiration re-writes `radreply` with the expired profile and issues a CoA disconnect.", table_cell_style),
            Paragraph("Run `php artisan pppoe:sync-status` on a test customer. Check that `radcheck` password remains intact and session is kicked.", table_cell_style)
        ],
        [
            Paragraph("<b>Step 4</b>", table_cell_style),
            Paragraph("Test self-care recharge flow. Connect a test router to the expired pool, pay via portal, verify CoA disconnect fires, and confirm full speed restoration.", table_cell_style),
            Paragraph("Router automatically reconnects into `10.100.0.0/19` with full internet access in under 2 seconds.", table_cell_style)
        ]
    ]
    t_chk = Table(checklist_data, colWidths=[45, 235, 224])
    t_chk.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), c_primary),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('GRID', (0,0), (-1,-1), 0.5, c_border),
        ('BACKGROUND', (0,1), (-1,1), colors.white),
        ('BACKGROUND', (0,2), (-1,2), c_bg_light),
        ('BACKGROUND', (0,3), (-1,3), colors.white),
        ('BACKGROUND', (0,4), (-1,4), c_bg_light),
        ('TOPPADDING', (0,0), (-1,-1), 4.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4.5),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t_chk)

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated PDF: {filename}")

if __name__ == '__main__':
    output_path = "/home/airlink_golden/Airlink_Walled_Garden_Implementation_Plan.pdf"
    build_pdf(output_path)

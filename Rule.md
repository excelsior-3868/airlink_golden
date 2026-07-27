# Frontend Page Creation Rules for Antigravity Agents

When building, formatting, modifying, or designing frontend pages and UI components in this workspace, all Antigravity agents MUST follow these mandatory guidelines:

## 1. Always Use Title Case
- Format all UI labels, table column headers, form input descriptions, button text, page titles, and modal headers in **Title Case** (e.g., *Package Category*, *Wholesale Cost*, *Validity Days*, *Quota Type*).
- Do not use raw lowercase string identifiers or loud ALL-CAPS styling for labels unless explicitly mandated by specific CSS design systems.
- Maintain formatting clarity across all tables and informational display cards.

## 2. Always Use the Combo Box / Custom Select Component
- Do not use basic browser default `<select>` HTML dropdown elements for options in forms, modal dialogs, or filter bars.
- **Always** use the curated **Combo Box / Custom Select component** (e.g., `CustomSelect` available in `components/ui` or styled interactive combo box equivalents).
- This guarantees rich aesthetics, consistent dark mode behavior, interactive animations, and a polished user experience.

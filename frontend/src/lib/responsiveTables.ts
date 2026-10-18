/**
 * Mobile "table → cards" support.
 *
 * Below the md breakpoint the CSS in index.css (`table.rt-cards`) renders every
 * <table> row as a stacked card, with each cell showing its column header as a
 * label. CSS can't read the header text, so this stamps `data-label` onto each
 * <td> from the matching <th>. A MutationObserver keeps it current as pages,
 * modals and query results render rows, so no page needs changing.
 *
 * Opt a table out with `data-no-cards` (or class `no-cards`).
 */

const labelCells = (table: HTMLTableElement) => {
  if (table.hasAttribute('data-no-cards') || table.classList.contains('no-cards')) return
  table.classList.add('rt-cards')

  // Use the last header row so grouped (colspan) headers still give per-column labels.
  const headRows = table.tHead?.rows
  const headRow = headRows && headRows.length ? headRows[headRows.length - 1] : null
  const labels: string[] = []
  if (headRow) {
    for (const th of Array.from(headRow.cells)) {
      const text = (th.textContent || '').replace(/\s+/g, ' ').trim()
      const span = Math.max(1, th.colSpan || 1)
      for (let i = 0; i < span; i++) labels.push(span === 1 ? text : '')
    }
  }

  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0
      for (const cell of Array.from(row.cells)) {
        const span = Math.max(1, cell.colSpan || 1)
        if (span > 1 && labels.length && span >= labels.length) {
          // Full-width cell (empty state, loading row, group heading).
          cell.setAttribute('data-full', '')
          cell.removeAttribute('data-label')
        } else {
          const label = labels[col] ?? ''
          if (label) cell.setAttribute('data-label', label)
          else cell.removeAttribute('data-label')
          cell.removeAttribute('data-full')
        }
        col += span
      }
    }
  }
}

const labelAll = (root: ParentNode) => {
  root.querySelectorAll('table').forEach((t) => labelCells(t as HTMLTableElement))
}

export function initResponsiveTables() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  let queued = false
  const schedule = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      labelAll(document)
    })
  }
  labelAll(document)
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true })
}

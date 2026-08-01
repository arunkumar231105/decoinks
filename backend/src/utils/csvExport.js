// Shared CSV export helper.
//
// Builds a CSV with human-readable header labels (not raw DB column names) and
// streams it back as a download. Used by the list "Export" buttons so the file
// contains the full filtered result set, not just the page currently on screen.

function csvCell(value) {
  if (value === null || value === undefined) return '""'
  if (value instanceof Date) return `"${value.toISOString().slice(0, 10)}"`
  // Dates arrive from pg as ISO strings — trim the time for readability.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(value)) {
    return `"${value.slice(0, 10)}"`
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Collapse newlines so every record stays on a single CSV row (multi-line
  // notes otherwise make the file awkward to read and filter in a spreadsheet).
  return `"${text.replace(/\s*\r?\n\s*/g, ' · ').replace(/"/g, '""')}"`
}

/**
 * @param {Array<[string,string]>} columns  [[Header label, row key], …]
 * @param {Array<object>} rows
 */
function buildCsv(columns, rows) {
  return [
    columns.map(([label]) => csvCell(label)).join(','),
    ...rows.map(row => columns.map(([, key]) => csvCell(row[key])).join(',')),
  ].join('\n')
}

/** Sends `rows` as a CSV attachment named `<prefix>-YYYY-MM-DD.csv`. */
function sendCsv(res, prefix, columns, rows) {
  const csv = buildCsv(columns, rows)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${prefix}-${new Date().toISOString().slice(0, 10)}.csv"`,
  )
  // BOM so Excel opens UTF-8 (accents, ₹/€, Chinese names) correctly.
  return res.send('﻿' + csv)
}

module.exports = { csvCell, buildCsv, sendCsv }

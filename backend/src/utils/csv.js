/**
 * Reading a spreadsheet someone saved as CSV.
 *
 * Excel quotes a field only when it has to, escapes a quote by doubling it,
 * and on Windows writes a BOM before the first header — so a naive split on
 * commas mangles addresses and turns the first column name into something no
 * header map will ever match.
 */

function parseLine(line) {
  const fields = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      let value = ''
      i++
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { value += '"'; i += 2 }
        else if (line[i] === '"') { i++; break }
        else value += line[i++]
      }
      fields.push(value.trim())
      if (line[i] === ',') i++
    } else {
      const end = line.indexOf(',', i)
      if (end === -1) { fields.push(line.slice(i).trim()); break }
      fields.push(line.slice(i, end).trim())
      i = end + 1
    }
  }
  return fields
}

/** Rows as objects keyed by the header row. Blank lines are skipped. */
function parseCsv(buffer) {
  let text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer ?? '')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)   // Excel's BOM
  const lines = text.split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = parseLine(lines[0])
  const rows = []
  for (let r = 1; r < lines.length; r++) {
    if (!lines[r].trim()) continue
    const values = parseLine(lines[r])
    const row = {}
    headers.forEach((h, idx) => { row[h] = values[idx] ?? '' })
    rows.push(row)
  }
  return rows
}

/**
 * A header as written by a person: "Unit Price", "unit_price" and "UNIT-PRICE"
 * are the same column.
 */
function normaliseHeader(header) {
  return String(header ?? '').toLowerCase().replace(/[\s_\-.]+/g, '')
}

module.exports = { parseCsv, normaliseHeader, parseLine }

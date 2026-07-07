// ── AI-assisted CSV normalisation (xAI / Grok) ───────────────────────────────
// Sends a raw CSV to Grok and gets back rows using our canonical column names.
// The normalised CSV is then fed into the existing deterministic importer, so
// all validation, preview and insert logic (and the human confirm step) still
// apply — the AI only does the "understand any layout" part.

const crypto = require('crypto')
const { cacheGet, cacheSet } = require('../config/redis')

const XAI_BASE = process.env.XAI_BASE_URL || 'https://api.x.ai/v1'
const XAI_MODEL = process.env.XAI_MODEL || 'grok-3'

// Canonical columns the deterministic importer understands.
const CANONICAL = [
  'customer_name', 'company_name', 'email', 'phone', 'whatsapp', 'wechat',
  'order_type', 'product', 'qty', 'unit_price', 'sizes', 'colors',
  'artwork_count', 'shipping_address', 'billing_address', 'due_date',
  'notes', 'estimate', 'status',
]

const SYSTEM_PROMPT = `You convert a print-shop CSV (quotes / DTF PO sheets / order lists) into normalised rows.
Return ONLY JSON of the form {"rows":[{...}, ...]} — one object per input data row.
Use ONLY these keys (omit a key if the value is unknown for that row):
${CANONICAL.join(', ')}.

Rules:
- "client name" / "client" means customer_name.
- order_type must be one of: apparel, gangsheet, dtf. Infer it from any "print type"/"type" column: DTF or "transfer" -> dtf, anything with "gang" -> gangsheet, otherwise apparel.
- product is a short description of what is being printed. If there is no explicit product column, build one from the type and any gangsheet width/length (e.g. "DTF Transfer (22\" / W21.6/H24.7)").
- qty: the quantity (e.g. "total gangsheets" or "quantity"). Default 1 if absent.
- unit_price: a PER-UNIT price. If the sheet only gives a net/total amount for the row, set unit_price = net_amount / qty so that qty * unit_price equals that net amount. Never fold a separate shipping charge into unit_price.
- due_date must be YYYY-MM-DD or omitted.
- Strip currency symbols and commas from numbers.
- Do not invent customers or amounts that are not in the input.`

async function callGrok(csvText) {
  const key = process.env.XAI_API_KEY
  if (!key) {
    throw Object.assign(new Error('AI import is not configured (XAI_API_KEY is not set)'), { statusCode: 400 })
  }

  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: XAI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `CSV:\n${csvText}` },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw Object.assign(
      new Error(`AI service error (${res.status})${body ? `: ${body.slice(0, 300)}` : ''}`),
      { statusCode: 502 }
    )
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw Object.assign(new Error('AI returned an empty response'), { statusCode: 502 })

  let parsed
  try { parsed = JSON.parse(content) }
  catch { throw Object.assign(new Error('AI returned malformed JSON'), { statusCode: 502 }) }

  const rows = Array.isArray(parsed) ? parsed : (parsed.rows || parsed.quotes || [])
  if (!Array.isArray(rows) || rows.length === 0) {
    throw Object.assign(new Error('AI could not extract any rows from this file'), { statusCode: 422 })
  }
  return rows
}

// Turn AI row objects into a canonical CSV string.
function rowsToCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = CANONICAL.join(',')
  const lines = rows.map(r => CANONICAL.map(k => esc(r[k])).join(','))
  return [header, ...lines].join('\n') + '\n'
}

/**
 * Normalise a raw CSV via Grok into a canonical CSV string. Result is cached
 * in Redis (keyed on the file's hash) for 15 min so the preview and the
 * subsequent import only call the AI once per file.
 */
async function aiNormaliseCsv(csvText) {
  const hash = crypto.createHash('sha256').update(csvText).digest('hex')
  const cacheKey = `ai-csv:${hash}`

  const cached = await cacheGet(cacheKey).catch(() => null)
  if (cached) return cached

  const rows = await callGrok(csvText)
  const csv = rowsToCsv(rows)
  await cacheSet(cacheKey, csv, 15 * 60).catch(() => {})
  return csv
}

module.exports = { aiNormaliseCsv }

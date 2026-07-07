// ── AI-assisted CSV normalisation (xAI / Grok) ───────────────────────────────
// Sends a raw CSV to Grok and gets back rows using our canonical column names.
// The normalised CSV is then fed into the existing deterministic importer, so
// all validation, preview and insert logic (and the human confirm step) still
// apply — the AI only does the "understand any layout" part.

const crypto = require('crypto')
const { cacheGet, cacheSet } = require('../config/redis')

// Provider-agnostic, OpenAI-compatible chat API. Defaults target Groq
// (free tier, https://groq.com) with an open Llama model; override via env
// to use xAI/Grok, OpenAI, etc.
//   GROQ_API_KEY (or AI_API_KEY / XAI_API_KEY) — the API key
//   AI_BASE_URL  — default https://api.groq.com/openai/v1
//   AI_MODEL     — default llama-3.3-70b-versatile
const AI_KEY   = process.env.GROQ_API_KEY || process.env.AI_API_KEY || process.env.XAI_API_KEY
const AI_BASE  = process.env.AI_BASE_URL || process.env.GROQ_BASE_URL || process.env.XAI_BASE_URL || 'https://api.groq.com/openai/v1'
const AI_MODEL = process.env.AI_MODEL || process.env.GROQ_MODEL || process.env.XAI_MODEL || 'llama-3.3-70b-versatile'

// Canonical column sets per target module. The AI is asked to emit rows using
// exactly these keys, which the matching deterministic importer understands.
const PROFILES = {
  quote: {
    columns: [
      'customer_name', 'company_name', 'email', 'phone', 'whatsapp', 'wechat',
      'order_type', 'product', 'qty', 'unit_price', 'sizes', 'colors',
      'artwork_count', 'shipping_address', 'billing_address', 'due_date',
      'notes', 'estimate', 'status',
    ],
    rules: [
      '"client name" / "client" means customer_name.',
      'order_type must be one of: apparel, gangsheet, dtf. Infer from any "print type"/"type" column: DTF or "transfer" -> dtf, "gang" -> gangsheet, otherwise apparel.',
      'product is a short description of what is printed. If there is no product column, build one from the type and any gangsheet width/length (e.g. "DTF Transfer (22\\" / W21.6/H24.7)").',
    ],
  },
  order: {
    columns: [
      'order_type', 'supplier_name', 'order_date', 'due_date', 'payment_terms',
      'payment_status', 'contact_name', 'contact_email', 'contact_phone',
      'shipping_name', 'shipping_address', 'item', 'color', 'size', 'qty',
      'unit_price', 'price_per_sheet', 'no_artworks', 'notes',
    ],
    rules: [
      '"client name" / "client" / "customer" means contact_name.',
      'order_type must be one of: apparel, gangsheet, dtf. Infer from any "print type"/"type" column: DTF or "transfer" -> dtf, "gang" -> gangsheet, otherwise apparel.',
      'item is a short description of what is printed. If there is no item column, build one from the type and any gangsheet width/length.',
      'For gangsheet rows use price_per_sheet (per sheet) and no_artworks; for apparel/dtf use unit_price. If only a net/total amount is given, divide by qty to get the per-unit price.',
      'order_date and due_date must be YYYY-MM-DD or omitted.',
    ],
  },
}

function buildSystemPrompt(profile) {
  const commonRules = [
    'qty: the quantity (e.g. "total gangsheets" or "quantity"). Default 1 if absent.',
    'Strip currency symbols and commas from numbers.',
    'Do not invent customers or amounts that are not in the input.',
  ]
  return `You convert a print-shop CSV (quotes / DTF PO sheets / order lists) into normalised rows.
Return ONLY JSON of the form {"rows":[{...}, ...]} — one object per input data row.
Use ONLY these keys (omit a key if the value is unknown for that row):
${profile.columns.join(', ')}.

Rules:
${[...profile.rules, ...commonRules].map(r => `- ${r}`).join('\n')}`
}

async function callGrok(csvText, profile) {
  if (!AI_KEY) {
    throw Object.assign(new Error('AI import is not configured (GROQ_API_KEY is not set)'), { statusCode: 400 })
  }

  const res = await fetch(`${AI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(profile) },
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

// Turn AI row objects into a canonical CSV string for the given profile.
function rowsToCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.join(',')
  const lines = rows.map(r => columns.map(k => esc(r[k])).join(','))
  return [header, ...lines].join('\n') + '\n'
}

/**
 * Normalise a raw CSV via the AI into a canonical CSV string for the target
 * module ('quote' | 'order'). Result is cached in Redis (keyed on the file
 * hash + profile) for 15 min so preview and import only call the AI once.
 */
async function aiNormaliseCsv(csvText, profileName = 'quote') {
  const profile = PROFILES[profileName] || PROFILES.quote
  const hash = crypto.createHash('sha256').update(csvText).digest('hex')
  const cacheKey = `ai-csv:${profileName}:${hash}`

  const cached = await cacheGet(cacheKey).catch(() => null)
  if (cached) return cached

  const rows = await callGrok(csvText, profile)
  const csv = rowsToCsv(rows, profile.columns)
  await cacheSet(cacheKey, csv, 15 * 60).catch(() => {})
  return csv
}

module.exports = { aiNormaliseCsv }

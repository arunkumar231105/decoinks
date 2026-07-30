// Shippo Tracking API client.
// Read-only: given a carrier + tracking number, pull the live tracking status
// from Shippo (https://docs.goshippo.com/docs/tracking) and map it onto the
// `shipments` columns. Follows the external-call conventions in aiCsv.js:
// key from env, native fetch, explicit error handling — plus an AbortController
// timeout so a slow Shippo call can never hang a request (KB §6.9).

const SHIPPO_KEY  = process.env.SHIPPO_API_KEY
const SHIPPO_BASE = process.env.SHIPPO_BASE_URL || 'https://api.goshippo.com'
const TIMEOUT_MS  = Number(process.env.SHIPPO_TIMEOUT_MS) || 12000

// Map the carrier names used in the UI / DB to Shippo carrier tokens.
// https://docs.goshippo.com/docs/tracking/tracking/  (carrier token list)
const CARRIER_TOKENS = {
  usps:  'usps',
  ups:   'ups',
  fedex: 'fedex',
  dhl:   'dhl_express',
  'dhl express': 'dhl_express',
  'dhl ecommerce': 'dhl_ecommerce',
  'canada post': 'canada_post',
}

function carrierToken(carrier) {
  if (!carrier) return null
  return CARRIER_TOKENS[carrier.trim().toLowerCase()] || null
}

const TOKEN_DISPLAY = { usps: 'USPS', ups: 'UPS', fedex: 'FedEx', dhl_express: 'DHL', dhl_ecommerce: 'DHL', canada_post: 'Canada Post' }

// Guess the Shippo carrier token from the tracking number format, so the user
// only has to paste a tracking id (no carrier picker). Covers the common
// UPS / USPS / FedEx / DHL patterns; returns null when it can't tell.
function detectCarrier(trackingNumber) {
  const s = String(trackingNumber || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!s) return null
  if (/^1Z[0-9A-Z]{16}$/.test(s)) return 'ups'          // UPS: 1Z + 16
  if (/^[A-Z]{2}\d{9}US$/.test(s)) return 'usps'         // USPS intl (e.g. EA123456789US)
  if (/^9\d{15,25}$/.test(s)) return 'usps'              // USPS 20–26 digit (94xx/93xx/92xx…)
  if (/^\d{12}$/.test(s) || /^\d{15}$/.test(s)) return 'fedex' // FedEx 12/15 digit
  if (/^\d{10}$/.test(s)) return 'dhl_express'           // DHL 10 digit
  if (/^1Z/.test(s)) return 'ups'                        // UPS fallback
  return null
}

function isConfigured() {
  return Boolean(SHIPPO_KEY)
}

// ISO datetime → YYYY-MM-DD (a DATE column), or null.
function toDate(v) {
  if (!v) return null
  const s = String(v)
  return s.length >= 10 ? s.slice(0, 10) : null
}

function mapLocation(loc) {
  if (!loc) return null
  return {
    city:    loc.city || null,
    state:   loc.state || null,
    zip:     loc.zip || null,
    country: loc.country || null,
  }
}

// Translate a raw Shippo tracking payload into a partial `shipments` update.
// Only keys that Shippo actually returned are included, so a refresh never
// clobbers manually-entered fields with empty values.
function mapTracking(data) {
  const out = {}
  const ts = data.tracking_status || null

  if (ts) {
    if (ts.status)         out.tracking_status = ts.status
    if (ts.status_details) out.status_details  = ts.status_details
    // substatus can be an object { code, text, action_required } or a string
    if (ts.substatus) {
      out.substatus = typeof ts.substatus === 'string'
        ? ts.substatus
        : (ts.substatus.text || ts.substatus.code || null)
    }
    if (ts.location) {
      if (ts.location.city)  out.last_scan_city  = ts.location.city
      if (ts.location.state) out.last_scan_state = ts.location.state
    }
  }

  if (data.eta)          out.estimated_delivery = toDate(data.eta)
  if (data.original_eta) out.original_eta        = toDate(data.original_eta)

  if (data.servicelevel && data.servicelevel.name) out.service_type = data.servicelevel.name

  const from = data.address_from
  if (from) {
    if (from.city)  out.address_from_city        = from.city
    if (from.state) out.address_from_state       = from.state
    if (from.zip)   out.address_from_postal_code = from.zip
  }

  // Only fill ship-to parts from Shippo when present (they are often partial),
  // so we never overwrite a manually-entered address with blanks.
  const to = data.address_to
  if (to) {
    if (to.city)  out.ship_to_city        = to.city
    if (to.state) out.ship_to_state       = to.state
    if (to.zip)   out.ship_to_postal_code = to.zip
  }

  // Full scan-by-scan history (oldest → newest as Shippo returns it).
  // Kept as a real array here; the DB-write layer stringifies for the JSONB
  // column, while the New-Shipment preview consumes it directly as an array.
  if (Array.isArray(data.tracking_history)) {
    out.tracking_history = data.tracking_history.map(h => ({
      status:         h.status || null,
      substatus:      h.substatus ? (h.substatus.text || h.substatus.code || null) : null,
      status_details: h.status_details || null,
      status_date:    h.status_date || null,
      location:       mapLocation(h.location),
    }))

    // Derive the delivered date from the DELIVERED scan, if any.
    const deliveredScan = data.tracking_history.find(h => h.status === 'DELIVERED')
    if (deliveredScan && deliveredScan.status_date) {
      out.delivered_date = toDate(deliveredScan.status_date)
    }
  }

  if (Array.isArray(data.messages) && data.messages.length) {
    out.tracking_messages = data.messages
  }

  return out
}

// Fetch tracking for a carrier + tracking number and return a partial
// `shipments` update object. Throws a status-coded Error on any failure.
async function fetchTracking(carrier, trackingNumber) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Shippo is not configured (SHIPPO_API_KEY is not set)'), { statusCode: 400 })
  }
  if (!trackingNumber || !trackingNumber.trim()) {
    throw Object.assign(new Error('A tracking number is required to refresh tracking'), { statusCode: 400 })
  }
  // Use the given carrier if we recognise it, otherwise auto-detect from the
  // tracking number format so the user never has to pick a carrier.
  const token = carrierToken(carrier) || detectCarrier(trackingNumber)
  if (!token) {
    throw Object.assign(
      new Error('Could not detect the carrier from this tracking number. Supported: USPS, UPS, FedEx, DHL.'),
      { statusCode: 400 }
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(`${SHIPPO_BASE}/tracks/${token}/${encodeURIComponent(trackingNumber.trim())}`, {
      method: 'GET',
      headers: { Authorization: `ShippoToken ${SHIPPO_KEY}` },
      signal: controller.signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') {
      throw Object.assign(new Error('Shippo tracking request timed out'), { statusCode: 504 })
    }
    throw Object.assign(new Error('Could not reach the Shippo tracking service'), { statusCode: 502 })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 404) {
      throw Object.assign(new Error('Shippo has no tracking for this carrier + number yet'), { statusCode: 404 })
    }
    throw Object.assign(
      new Error(`Shippo tracking error (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`),
      { statusCode: 502 }
    )
  }

  const data = await res.json().catch(() => null)
  if (!data) throw Object.assign(new Error('Shippo returned an empty response'), { statusCode: 502 })

  const mapped = mapTracking(data)
  mapped.carrier = TOKEN_DISPLAY[token] || carrier || null   // resolved carrier for the caller
  return mapped
}

module.exports = { fetchTracking, carrierToken, detectCarrier, isConfigured }

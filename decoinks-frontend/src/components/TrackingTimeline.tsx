import { AlertTriangle, CheckCircle, Clock, Copy, ExternalLink, MapPin, Package, RefreshCw, RotateCcw, Truck, X } from 'lucide-react'
import { Drawer } from '@mui/material'
import toast from '../utils/toast'
import '../styles/tracking-timeline.css'
import { fmtWeekdayDate, fmtDateTime } from '../utils/dates'

/**
 * A parcel's journey, scan by scan.
 *
 * Opened from a tracking number on the Shipments list, and reused inside the
 * shipment's detail drawer. Everything shown comes from the shipment row
 * (tracking_history is saved by the Shippo sync), so opening it costs no call;
 * "Refresh" pulls the carrier's latest through the existing /track endpoint.
 */

export interface TrackingScan {
  status: string | null
  substatus: string | null
  status_details: string | null
  status_date: string | null
  location: { city: string | null; state: string | null; zip: string | null; country: string | null } | null
}

export interface TrackedShipment {
  id: string
  shipment_number: string
  customer_name: string | null
  carrier: string | null
  service_type: string | null
  tracking_number: string | null
  tracking_status: string | null
  status: string
  status_details: string | null
  ship_to_city: string | null
  ship_to_state: string | null
  ship_to_postal_code: string | null
  last_scan_city: string | null
  last_scan_state: string | null
  estimated_delivery: string | null
  delivered_date: string | null
  tracking_history: TrackingScan[] | null
  tracking_synced_at: string | null
}

const SHOP_TZ = 'Asia/Karachi'   // the shop reads times on Pakistan time

const upper = (v?: string | null) => String(v || '').trim().toUpperCase()

/** Before the carrier's first scan the parcel has not moved (migrations 140/141). */
const notMoving = (status?: string | null) => ['PRE_TRANSIT', 'UNKNOWN'].includes(upper(status))

const place = (l?: TrackingScan['location']) => [l?.city, l?.state, l?.zip].filter(Boolean).join(', ')

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: SHOP_TZ })
const dayLabel = (iso: string) => fmtWeekdayDate(iso, iso, SHOP_TZ)
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-US',
  { hour: 'numeric', minute: '2-digit', timeZone: SHOP_TZ })
const shortDay = (ymd?: string | null) => {
  if (!ymd) return null
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? String(ymd) : fmtWeekdayDate(String(ymd).slice(0, 10))
}

export function carrierTrackingUrl(carrier?: string | null, number?: string | null) {
  if (!number) return null
  const n = encodeURIComponent(number.trim())
  const c = upper(carrier)
  if (c.includes('UPS')) return `https://www.ups.com/track?tracknum=${n}`
  if (c.includes('USPS')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`
  if (c.includes('FEDEX')) return `https://www.fedex.com/fedextrack/?trknbr=${n}`
  if (c.includes('DHL')) return `https://www.dhl.com/en/express/tracking.html?AWB=${n}`
  return null
}

type Tone = 'done' | 'moving' | 'waiting' | 'problem' | 'returned'

const scanTone = (s: TrackingScan): Tone => {
  switch (upper(s.status)) {
    case 'DELIVERED': return 'done'
    case 'TRANSIT': return 'moving'
    case 'FAILURE': return 'problem'
    case 'RETURNED': return 'returned'
    default: return 'waiting'
  }
}

const scanTitle = (s: TrackingScan) => {
  switch (upper(s.status)) {
    case 'DELIVERED': return 'Delivered'
    case 'TRANSIT': return /out for delivery/i.test(`${s.substatus ?? ''} ${s.status_details ?? ''}`) ? 'Out for delivery' : 'In transit'
    case 'PRE_TRANSIT': return 'Label created'
    case 'FAILURE': return 'Delivery problem'
    case 'RETURNED': return 'Returned to sender'
    default: return s.status ? s.status.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : 'Update'
  }
}

const TONE_ICON: Record<Tone, JSX.Element> = {
  done: <CheckCircle size={14} />,
  moving: <Truck size={14} />,
  waiting: <Package size={14} />,
  problem: <AlertTriangle size={14} />,
  returned: <RotateCcw size={14} />,
}

/** Newest first, as the scans are read. */
const newestFirst = (scans: TrackingScan[]) =>
  scans.map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ta = a.s.status_date ? Date.parse(a.s.status_date) : NaN
      const tb = b.s.status_date ? Date.parse(b.s.status_date) : NaN
      if (Number.isNaN(ta) || Number.isNaN(tb)) return b.i - a.i   // Shippo returns them oldest → newest
      return tb - ta || b.i - a.i
    })
    .map(x => x.s)

/** The scan list itself, grouped by day. Used by the tracking drawer and the shipment drawer. */
export function ScanTimeline({ scans }: { scans: TrackingScan[] | null | undefined }) {
  const list = newestFirst(Array.isArray(scans) ? scans : [])
  if (list.length === 0) {
    return (
      <div className="tt-empty">
        <Clock size={18} />
        <div>
          <strong>No scans yet</strong>
          <span>The carrier has not scanned this parcel. Refresh to check again.</span>
        </div>
      </div>
    )
  }
  let lastDay = ''
  return (
    <ol className="tt-list">
      {list.map((scan, idx) => {
        const tone = scanTone(scan)
        const day = scan.status_date ? dayKey(scan.status_date) : ''
        const showDay = day !== lastDay
        lastDay = day
        // The location on a label-created event is where the label was made, not a scan.
        const where = notMoving(scan.status) ? '' : place(scan.location)
        return (
          <li key={idx} className={`tt-item tt-${tone}${idx === 0 ? ' tt-latest' : ''}`}>
            {showDay && <div className="tt-day">{scan.status_date ? dayLabel(scan.status_date) : 'Date not given'}</div>}
            <div className="tt-row">
              <span className="tt-dot">{TONE_ICON[tone]}</span>
              <div className="tt-body">
                <div className="tt-title">
                  <strong>{scanTitle(scan)}</strong>
                  {scan.status_date && <time>{timeLabel(scan.status_date)}</time>}
                </div>
                {scan.status_details && <p>{scan.status_details}</p>}
                {where && <span className="tt-where"><MapPin size={12} /> {where}</span>}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const STEPS = ['Label created', 'In transit', 'Out for delivery', 'Delivered'] as const

/** Where the parcel is on the four-step journey, and whether something went wrong. */
function progressOf(sh: TrackedShipment): { step: number; problem: 'problem' | 'returned' | null } {
  const status = upper(sh.tracking_status) || upper(sh.status).replace(/ /g, '_')
  if (status === 'DELIVERED') return { step: 3, problem: null }
  if (status === 'RETURNED') return { step: 1, problem: 'returned' }
  if (status === 'FAILURE' || status === 'EXCEPTION') return { step: 1, problem: 'problem' }
  if (status === 'TRANSIT' || status === 'IN_TRANSIT' || status === 'PICKED_UP') {
    const latest = newestFirst(sh.tracking_history ?? [])[0]
    const text = `${latest?.substatus ?? ''} ${latest?.status_details ?? ''} ${sh.status_details ?? ''}`
    return { step: /out for delivery/i.test(text) ? 2 : 1, problem: null }
  }
  return { step: 0, problem: null }
}

export function TrackingTimelineDrawer({ shipment, onClose, onRefresh, refreshing }: {
  shipment: TrackedShipment | null
  onClose: () => void
  onRefresh: (id: string) => void
  refreshing: boolean
}) {
  const sh = shipment
  const url = sh ? carrierTrackingUrl(sh.carrier, sh.tracking_number) : null
  const progress = sh ? progressOf(sh) : { step: 0, problem: null }
  const moving = sh ? !notMoving(sh.tracking_status) && progress.step > 0 : false
  const lastScan = sh && moving ? [sh.last_scan_city, sh.last_scan_state].filter(Boolean).join(', ') : ''
  const eta = sh && moving && !sh.delivered_date ? shortDay(sh.estimated_delivery) : null

  const copy = async () => {
    if (!sh?.tracking_number) return
    try {
      await navigator.clipboard.writeText(sh.tracking_number)
      toast.success('Tracking number copied')
    } catch {
      toast.error('Could not copy — select the number instead')
    }
  }

  return (
    <Drawer anchor="right" open={Boolean(sh)} onClose={onClose}>
      {sh && (
        <div className="tt-drawer">
          <header className="tt-head">
            <div className="tt-head-main">
              <small>{[sh.carrier, sh.service_type].filter(Boolean).join(' · ') || 'Tracking'}</small>
              <h3>
                <span className="tt-number">{sh.tracking_number ?? 'No tracking number'}</span>
                {sh.tracking_number && (
                  <button type="button" className="tt-icon" onClick={copy} title="Copy tracking number"><Copy size={14} /></button>
                )}
              </h3>
              <span className="tt-sub">{sh.shipment_number}{sh.customer_name ? ` · ${sh.customer_name}` : ''}</span>
            </div>
            <button type="button" className="tt-icon tt-close" onClick={onClose} title="Close"><X size={16} /></button>
          </header>

          <section className={`tt-summary${progress.problem ? ` tt-summary-${progress.problem}` : ''}`}>
            <div className="tt-summary-status">
              {progress.problem === 'problem' ? <AlertTriangle size={18} />
                : progress.problem === 'returned' ? <RotateCcw size={18} />
                : progress.step === 3 ? <CheckCircle size={18} />
                : progress.step === 0 ? <Package size={18} /> : <Truck size={18} />}
              <div>
                <strong>
                  {progress.problem === 'problem' ? 'Delivery problem'
                    : progress.problem === 'returned' ? 'Returned to sender'
                    : STEPS[progress.step]}
                </strong>
                <span>
                  {sh.delivered_date ? `Delivered ${shortDay(sh.delivered_date)}`
                    : eta ? `Expected ${eta}`
                    : progress.step === 0 ? 'Waiting for the carrier’s first scan'
                    : (sh.status_details || 'On its way')}
                </span>
              </div>
            </div>
            <dl>
              <div><dt>Ship to</dt><dd>{[sh.ship_to_city, sh.ship_to_state, sh.ship_to_postal_code].filter(Boolean).join(', ') || '—'}</dd></div>
              <div><dt>Last scan</dt><dd>{lastScan || '—'}</dd></div>
            </dl>
          </section>

          {!progress.problem && (
            <ol className="tt-steps" aria-label="Delivery progress">
              {STEPS.map((label, i) => (
                <li key={label} className={i < progress.step ? 'done' : i === progress.step ? 'current' : ''}>
                  <span />{label}
                </li>
              ))}
            </ol>
          )}

          <div className="tt-actions">
            <button
              type="button"
              className="lb-action-btn lb-action-primary"
              disabled={refreshing || !sh.tracking_number}
              onClick={() => onRefresh(sh.id)}
              title={sh.tracking_number ? 'Get the latest scans from the carrier' : 'Add a tracking number first'}
            >
              <RefreshCw size={14} className={refreshing ? 'tt-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            {url && (
              <a className="lb-action-btn" href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} /> Open on {upper(sh.carrier).includes('USPS') ? 'USPS' : upper(sh.carrier).includes('UPS') ? 'UPS' : 'carrier site'}
              </a>
            )}
            <span className="tt-synced">
              {sh.tracking_synced_at ? `Updated ${fmtDateTime(sh.tracking_synced_at, '—', SHOP_TZ)}` : 'Never synced'}
            </span>
          </div>

          <h4 className="tt-heading">Tracking timeline</h4>
          <ScanTimeline scans={sh.tracking_history} />
        </div>
      )}
    </Drawer>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2, ExternalLink, FileText, Pencil, Truck, X,
} from 'lucide-react'
import { api } from '../../services/api'

/**
 * A claim opened from the list, without leaving it.
 *
 * The panel reads the whole chain the claim points at — customer, sales order,
 * purchase order, invoice, shipment — plus its evidence, its reviews and its
 * timeline. Everything shown comes from the claim's keys, so a figure here is
 * always the figure the record itself holds.
 *
 * Edit hands over to the full form; there is one place a claim is written.
 */

const money = (v: any) => v == null || v === ''
  ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const day = (v: any) => v
  ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—'
const stamp = (v: any) => v
  ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '-'
const kb = (n?: number | null) => !n ? ''
  : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`

export function ClaimDetailsDrawer({ claimId, onClose }: { claimId: string | null; onClose: () => void }) {
  const nav = useNavigate()
  const { data: c, isLoading } = useQuery({
    queryKey: ['claim', claimId],
    queryFn: () => api.get(`/claims/${claimId}`).then(r => r.data.data),
    enabled: Boolean(claimId),
  })
  if (!claimId) return null

  const chainRow = (label: string, value: any, extra?: string) => (
    <div className="cd-chain-row">
      <span>{label}</span>
      <b>{value || '—'}{extra && <small>{extra}</small>}</b>
    </div>
  )

  return (
    <div className="cd-wrap" onClick={onClose}>
      <aside className="cd-panel" onClick={e => e.stopPropagation()}>
        <header className="cd-head">
          <div>
            <h3>{c?.claim_number ?? 'Claim'}</h3>
            <p>{c?.claim_category}{c?.sub_issue ? ` · ${c.sub_issue}` : ''}</p>
          </div>
          <div className="cd-head-actions">
            <button className="cd-btn primary" onClick={() => nav(`/claims/${claimId}`)}>
              <Pencil size={14}/> Edit
            </button>
            <button className="cd-x" onClick={onClose}><X size={18}/></button>
          </div>
        </header>

        {isLoading || !c ? <p className="cd-empty">Loading…</p> : (
          <>
            <div className="cd-status-row">
              <span className={`cd-pill st-${String(c.status).toLowerCase().replace(/\s+/g, '-')}`}>{c.status}</span>
              <span className="cd-decision">Decision: <b>{c.decision}</b></span>
              <span className="cd-raised">Raised {day(c.created_at)}</span>
            </div>

            {/* The chain the claim sits on. Anything not reached yet reads as a
                dash rather than being hidden, so it is clear what is missing. */}
            <section className="cd-block">
              <h4>Traced To</h4>
              <div className="cd-chain">
                {chainRow('Customer', c.customer_name, c.customer_number ? ` ${c.customer_number}` : '')}
                {chainRow('Sales Order', c.order_number, c.order_total != null ? ` ${money(c.order_total)}` : '')}
                {chainRow('Purchase Order', c.po_number, c.supplier_name ? ` ${c.supplier_name}` : '')}
                {chainRow('Invoice', c.invoice_number, c.invoice_total != null ? ` ${money(c.invoice_total)}` : '')}
                {chainRow('Shipment',
                  c.shipment_number ?? c.tracking_number,
                  c.carrier ? ` ${c.carrier} · ${c.shipment_status ?? ''}` : '')}
              </div>
            </section>

            <section className="cd-block">
              <h4>The Issue</h4>
              <dl className="cd-dl">
                <dt>Quantity affected</dt><dd>{c.quantity_affected ?? '—'}</dd>
                <dt>Reported via</dt><dd>{c.reported_via ?? '—'}</dd>
                <dt>Claimed amount</dt><dd>{money(c.claimed_amount)}</dd>
                <dt>Requested refund</dt><dd>{money(c.requested_amount)}</dd>
                <dt>Wanted by</dt><dd>{day(c.urgency_by_date)}</dd>
              </dl>
              {c.description && <p className="cd-text">{c.description}</p>}
              {c.customer_comments && (
                <p className="cd-text quote">“{c.customer_comments}”</p>
              )}
            </section>

            <section className="cd-block">
              <h4>Resolution Asked For</h4>
              <div className="cd-tags">
                {(c.preferred_resolution ?? []).length
                  ? c.preferred_resolution.map((r: string) => <span key={r}>{r}</span>)
                  : <span className="muted">None recorded</span>}
              </div>
            </section>

            {(c.attachments ?? []).length > 0 && (
              <section className="cd-block">
                <h4>Evidence <small>{c.attachments.length}</small></h4>
                <div className="cd-files">
                  {c.attachments.map((a: any) => (
                    <a key={a.id} href={a.file_url} target="_blank" rel="noreferrer" title={a.file_name}>
                      {a.file_type === 'image'
                        ? <img src={a.file_url} alt={a.file_name} />
                        : a.file_type === 'video'
                          ? <video src={a.file_url} muted />
                          : <span className="cd-doc"><FileText size={22}/></span>}
                      <small>{a.file_name}<i>{kb(a.file_size)}</i></small>
                    </a>
                  ))}
                </div>
              </section>
            )}

            <section className="cd-block">
              <h4>Decision</h4>
              <dl className="cd-dl">
                <dt>Resolution type</dt><dd>{c.resolution_type ?? '—'}</dd>
                <dt>Approved amount</dt><dd>{money(c.approved_amount)}</dd>
                <dt>Responsible admin</dt><dd>{c.responsible_admin_name ?? '—'}</dd>
                <dt>Approved on</dt><dd>{day(c.approval_date)}</dd>
              </dl>
              {c.review_notes && <p className="cd-text">{c.review_notes}</p>}
              {(c.reviews ?? []).length > 1 && (
                <ul className="cd-reviews">
                  {c.reviews.map((r: any) => (
                    <li key={r.id}>
                      <b>{r.decision}</b> · {r.reviewer_name ?? 'Admin'} · {stamp(r.reviewed_at)}
                      {r.review_notes && <span>{r.review_notes}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="cd-block">
              <h4>History</h4>
              <ol className="cd-timeline">
                {(c.status_history ?? []).map((h: any) => (
                  <li key={h.id}>
                    <CheckCircle2 size={13}/>
                    <span>{h.status}</span>
                    <small>{stamp(h.changed_at)}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}</small>
                  </li>
                ))}
                {!(c.status_history ?? []).length && <li className="muted">Nothing recorded yet.</li>}
              </ol>
            </section>

            {(c.comments ?? []).length > 0 && (
              <section className="cd-block">
                <h4>Comments</h4>
                <ul className="cd-comments">
                  {c.comments.map((m: any) => (
                    <li key={m.id}>
                      <b>{m.user_name ?? 'Someone'}</b> <small>{stamp(m.created_at)}</small>
                      <p>{m.comment}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <footer className="cd-foot">
              <button className="cd-btn" onClick={() => nav(`/claims/${claimId}`)}>
                <Pencil size={14}/> Edit this claim
              </button>
              {c.order_id && (
                <button className="cd-btn ghost" onClick={() => nav(`/orders/${c.order_id}`)}>
                  <ExternalLink size={14}/> Open sales order
                </button>
              )}
              {c.shipment_id && (
                <button className="cd-btn ghost" onClick={() => nav('/shipments')}>
                  <Truck size={14}/> Shipments
                </button>
              )}
            </footer>
          </>
        )}
      </aside>
    </div>
  )
}

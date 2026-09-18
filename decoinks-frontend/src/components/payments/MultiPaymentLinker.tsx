import { useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import { fmtDate } from '../../utils/dates'

/**
 * Multiple Payments — pick the several payments one job was paid with.
 *
 * Lists the customer's payments that are not on an invoice yet (and any the
 * matcher found by name), ticks the set that adds up to the total when there is
 * one clear set, and keeps a running total against the target. Link stays
 * disabled until the payments equal the total to the cent; the server checks the
 * same again when it links them.
 */
export interface LinkerPayment {
  id: string
  payment_number: string
  amount: number
  payment_method?: string | null
  payment_date?: string | null
  customer_name?: string | null
  received_from_name?: string | null
  reasons?: string[]
  unassigned?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  /** What the payments must add up to. */
  target: number
  targetLabel: string
  customerId?: string | null
  customerName?: string | null
  /** When the work was quoted / invoiced, to rank payments made around then. */
  date?: string | null
  /** Payments the invoice already holds; counted, not removable here. */
  linked?: LinkerPayment[]
  /** Pre-ticked (e.g. a choice made earlier on the form). */
  initial?: string[]
  confirmLabel?: string
  busy?: boolean
  onConfirm: (ids: string[], picked: LinkerPayment[]) => void
}

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`
const CENTS = 0.01

export function MultiPaymentLinker({
  open, onClose, target, targetLabel, customerId, customerName, date, linked = [], initial = [],
  confirmLabel = 'Link payments', busy = false, onConfirm,
}: Props) {
  const [options, setOptions] = useState<LinkerPayment[]>([])
  const [suggested, setSuggested] = useState<{ ids: string[]; reasons: string[] } | null>(null)
  const [picked, setPicked] = useState<string[]>(initial)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setPicked(initial)
    setLoading(true)
    const linkedIds = new Set(linked.map(p => p.id))
    const remaining = +(target - linked.reduce((s, p) => s + Number(p.amount), 0)).toFixed(2)
    Promise.all([
      customerId
        ? api.get('/payment-links/unallocated', { params: { customer_id: customerId } }).then(r => r.data?.data ?? []).catch(() => [])
        : Promise.resolve([]),
      api.get('/payments/recommend', { params: {
        purpose: 'invoice', customer_id: customerId || undefined, customer_name: customerName || undefined,
        amount: remaining > 0 ? remaining : target, date: date || undefined,
      } }).then(r => r.data?.data ?? null).catch(() => null),
    ]).then(([waiting, rec]) => {
      const byId = new Map<string, LinkerPayment>()
      for (const p of [...(rec?.candidates ?? []), ...waiting]) {
        if (linkedIds.has(p.id)) continue
        byId.set(p.id, { ...byId.get(p.id), ...p, amount: Number(p.amount) })
      }
      setOptions([...byId.values()])
      const set = rec?.recommended_set
      const single = rec?.recommended
      const suggestion = set?.ids?.length ? { ids: set.ids, reasons: set.reasons }
        : single ? { ids: [single.id], reasons: single.reasons } : null
      setSuggested(suggestion)
      if (!initial.length && suggestion) setPicked(suggestion.ids.filter((id: string) => byId.has(id)))
    }).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const alreadyLinked = useMemo(() => +linked.reduce((s, p) => s + Number(p.amount), 0).toFixed(2), [linked])
  const selectedTotal = useMemo(
    () => +options.filter(p => picked.includes(p.id)).reduce((s, p) => s + Number(p.amount), 0).toFixed(2),
    [options, picked])
  const together = +(alreadyLinked + selectedTotal).toFixed(2)
  const gap = +(Number(target) - together).toFixed(2)
  const equal = Math.abs(gap) <= CENTS && picked.length > 0

  if (!open) return null

  const toggle = (id: string) => setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div style={{ background: 'white', borderRadius: 12, padding: 22, width: 640, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.18)' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Multiple Payments</h3>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px', lineHeight: 1.5 }}>
          Tick every payment this job was paid with. Together they must equal the {targetLabel} of <strong style={{ color: '#0f172a' }}>{money(target)}</strong> exactly —
          each one then carries this invoice and its sales order.
        </p>

        {suggested && (
          <div style={{ fontSize: 12.5, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
            ★ Recommended: {options.filter(p => suggested.ids.includes(p.id)).map(p => p.payment_number).join(' + ')} — {suggested.reasons.join(' · ')}.
            Check they are this job's payments.
          </div>
        )}

        <div style={{ overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, flex: 1, minHeight: 120 }}>
          {loading ? (
            <p style={{ fontSize: 13, color: '#94a3b8', padding: 16, margin: 0 }}>Finding this customer's payments…</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', width: 30 }} />
                  <th style={{ padding: '8px 6px' }}>Payment</th>
                  <th style={{ padding: '8px 6px' }}>Date</th>
                  <th style={{ padding: '8px 6px' }}>From</th>
                  <th style={{ padding: '8px 6px' }}>Method</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {linked.map(p => (
                  <tr key={p.id} style={{ borderTop: '1px solid #f1f5f9', color: '#64748b', background: '#f8fafc' }}>
                    <td style={{ padding: '8px 10px' }}><input type="checkbox" checked disabled aria-label={`${p.payment_number} already linked`} /></td>
                    <td style={{ padding: '8px 6px' }}>{p.payment_number} <small>(already on this invoice)</small></td>
                    <td style={{ padding: '8px 6px' }}>{p.payment_date ? fmtDate(String(p.payment_date).slice(0, 10)) : '—'}</td>
                    <td style={{ padding: '8px 6px' }}>{p.received_from_name || p.customer_name || '—'}</td>
                    <td style={{ padding: '8px 6px' }}>{p.payment_method || '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{money(p.amount)}</td>
                  </tr>
                ))}
                {options.map(p => {
                  const on = picked.includes(p.id)
                  const star = suggested?.ids.includes(p.id)
                  return (
                    <tr key={p.id} onClick={() => toggle(p.id)}
                      style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer', background: on ? '#eff6ff' : undefined }}>
                      <td style={{ padding: '8px 10px' }}><input type="checkbox" checked={on} onChange={() => toggle(p.id)} onClick={e => e.stopPropagation()} aria-label={p.payment_number} /></td>
                      <td style={{ padding: '8px 6px', fontWeight: 600 }}>
                        {star ? '★ ' : ''}{p.payment_number}
                        {p.unassigned && <small style={{ color: '#b45309', fontWeight: 500 }}> · no customer on it</small>}
                        {p.reasons?.length ? <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>{p.reasons.join(' · ')}</div> : null}
                      </td>
                      <td style={{ padding: '8px 6px' }}>{p.payment_date ? fmtDate(String(p.payment_date).slice(0, 10)) : '—'}</td>
                      <td style={{ padding: '8px 6px' }}>{p.received_from_name || p.customer_name || '—'}</td>
                      <td style={{ padding: '8px 6px' }}>{p.payment_method || '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{money(p.amount)}</td>
                    </tr>
                  )
                })}
                {!linked.length && !options.length && (
                  <tr><td colSpan={6} style={{ padding: 16, color: '#94a3b8' }}>No payment of this customer is waiting for an invoice.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <div>
              {alreadyLinked > 0 && <>{money(alreadyLinked)} linked + </>}
              {money(selectedTotal)} selected = <strong>{money(together)}</strong> of {money(target)}
            </div>
            <div style={{ fontWeight: 600, color: equal ? '#15803d' : '#dc2626' }}>
              {equal ? '✓ Equals the total' : picked.length === 0 ? 'Select the payments' : gap > 0 ? `${money(gap)} short` : `${money(-gap)} over`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="lb-action-btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="lb-action-btn lb-action-primary" disabled={!equal || busy}
              title={equal ? undefined : 'The payments must equal the total exactly'}
              onClick={() => onConfirm(picked, options.filter(p => picked.includes(p.id)))}>
              {busy ? 'Linking…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

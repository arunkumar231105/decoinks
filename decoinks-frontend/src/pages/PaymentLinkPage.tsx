import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Check, Copy, CreditCard, Link2, Loader2, Search } from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'
import { copyText } from '../utils/actions'
import { cn } from '../utils/cn'

/**
 * Take a payment before the paperwork exists.
 *
 * The shop's habit is to collect first and write the quotation and invoice
 * afterwards. This makes a link for that: a customer, what the goods cost, what
 * shipping costs, and a note. The customer pays, the money lands in the ledger
 * against their name, and when the invoice is finally written it claims the
 * payment that already happened.
 *
 * The customer is required and must be picked from the list. A typed name would
 * leave the money attached to nobody, and money nobody can attribute is money
 * that cannot be reconciled later.
 */

type Customer = { id: string; name: string; customer_number?: string; email?: string | null }

const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD']
const money = (n: number) => `$${Number(n || 0).toFixed(2)}`

// Named, not default: the router's lazy loader looks the component up by name.
export function PaymentLinkPage() {
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [open, setOpen] = useState(false)
  const [item, setItem] = useState('')
  const [shipping, setShipping] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string>('')
  const [copied, setCopied] = useState(false)

  const customers = useQuery({
    queryKey: ['customers', 'payment-link-picker'],
    queryFn: () => api.get('/customers', { params: { limit: 1000 } })
      .then(r => (r.data?.data?.rows ?? r.data?.rows ?? r.data?.data ?? []) as Customer[]),
  })

  const matches = useMemo(() => {
    const all = customers.data ?? []
    const q = query.trim().toLowerCase()
    if (!q) return all.slice(0, 40)
    return all.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.customer_number?.toLowerCase().includes(q)).slice(0, 40)
  }, [customers.data, query])

  const itemNum = Number(item) || 0
  const shipNum = Number(shipping) || 0
  const total = +(itemNum + shipNum).toFixed(2)

  // Changing any figure invalidates the link that was made from the old ones.
  useEffect(() => { setLink(''); setCopied(false) }, [customer?.id, item, shipping, currency])

  async function generate() {
    if (!customer) { toast.error('Choose a customer first — the payment has to belong to someone'); return }
    if (!(total > 0)) { toast.error('Enter an amount greater than zero'); return }
    setBusy(true)
    try {
      const r = await api.post('/payment-links/advance', {
        customerId: customer.id,
        itemAmount: itemNum,
        shippingAmount: shipNum,
        currency,
        description: description.trim() || null,
      })
      const url = (r.data?.data ?? r.data)?.url
      setLink(url)
      await copyText(url)
      setCopied(true)
      toast.success('Payment link generated and copied')
    } catch (err: any) {
      toast.apiError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ni-page">
      <div className="ni-header">
        <div>
          <nav className="ni-breadcrumb">
            <span>Payments</span><span className="ni-bc-sep">/</span><strong>Payment Link</strong>
          </nav>
          <h2 className="ni-page-title">Generate Payment Link</h2>
        </div>
        <div className="ni-header-actions">
          <button className="lb-action-btn" onClick={() => navigate('/payments')}>
            <ArrowLeft size={14}/> Back to Payments
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }}
           className="pl-grid">
        {/* ── Form ─────────────────────────────────────────────────────── */}
        <div className="ni-card" style={{ padding: 20 }}>
          <h3 className="ni-sidebar-title">Who is paying?</h3>

          <div style={{ position: 'relative', marginTop: 10 }}>
            <span className="ni-payment-label">Customer <span style={{ color: '#dc2626' }}>*</span></span>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: 12, color: '#94a3b8' }}/>
              <input
                className="ni-info-select"
                style={{ paddingLeft: 32, width: '100%' }}
                placeholder={customers.isLoading ? 'Loading customers…' : 'Search by name, email or customer number'}
                value={customer ? customer.name : query}
                onChange={e => { setCustomer(null); setQuery(e.target.value); setOpen(true) }}
                onFocus={() => setOpen(true)}
              />
            </div>

            {open && !customer && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setOpen(false)}/>
                <div style={{
                  position: 'absolute', zIndex: 11, left: 0, right: 0, top: '100%', marginTop: 4,
                  maxHeight: 260, overflowY: 'auto', background: '#fff',
                  border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 10px 30px rgba(15,23,42,.12)',
                }}>
                  {matches.length === 0 && (
                    <div style={{ padding: '14px 12px', fontSize: 13, color: '#64748b' }}>
                      No customer matches that. A payment link needs an existing customer.
                    </div>
                  )}
                  {matches.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setCustomer(c); setOpen(false); setQuery('') }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px',
                        border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <strong style={{ display: 'block' }}>{c.name}</strong>
                      <span style={{ color: '#64748b', fontSize: 12 }}>
                        {[c.customer_number, c.email].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {customer && (
              <button type="button" className="lb-action-btn" style={{ marginTop: 8 }}
                      onClick={() => { setCustomer(null); setQuery('') }}>
                Change customer
              </button>
            )}
          </div>

          <h3 className="ni-sidebar-title" style={{ marginTop: 24 }}>What are they paying for?</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
            <label>
              <span className="ni-payment-label">Item amount</span>
              <input className="ni-info-select" style={{ width: '100%' }} inputMode="decimal"
                     placeholder="0.00" value={item}
                     onChange={e => setItem(e.target.value.replace(/[^0-9.]/g, ''))}/>
            </label>
            <label>
              <span className="ni-payment-label">Shipping amount</span>
              <input className="ni-info-select" style={{ width: '100%' }} inputMode="decimal"
                     placeholder="0.00" value={shipping}
                     onChange={e => setShipping(e.target.value.replace(/[^0-9.]/g, ''))}/>
            </label>
            <label>
              <span className="ni-payment-label">Currency</span>
              <select className="ni-info-select" style={{ width: '100%' }} value={currency}
                      onChange={e => setCurrency(e.target.value)}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>
              <span className="ni-payment-label">Description (shown to the customer)</span>
              <input className="ni-info-select" style={{ width: '100%' }}
                     placeholder="e.g. 500 DTF transfers — advance"
                     value={description} onChange={e => setDescription(e.target.value)}/>
            </label>
          </div>
        </div>

        {/* ── Total and the link ───────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ni-card" style={{ padding: 20 }}>
            <h3 className="ni-sidebar-title">Total</h3>
            <div className="ni-payment-ledger" style={{ marginTop: 10 }}>
              <div><span>Item amount</span><strong>{money(itemNum)}</strong></div>
              <div><span>Shipping</span><strong>{money(shipNum)}</strong></div>
            </div>
            <div style={{ borderTop: '2px solid #0f172a', marginTop: 10, paddingTop: 10,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 600 }}>Total</span>
              <strong style={{ fontSize: 26 }}>{money(total)}</strong>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: '#64748b' }}>{currency}</div>

            <button
              className={cn('lb-action-btn lb-action-primary')}
              style={{ width: '100%', justifyContent: 'center', marginTop: 16, height: 42 }}
              onClick={generate}
              disabled={busy || !customer || !(total > 0)}
            >
              {busy ? <Loader2 size={15} className="ni-spin"/> : <Link2 size={15}/>}
              {busy ? 'Generating…' : 'Generate payment link'}
            </button>
            {!customer && (
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                Pick a customer first — the payment is recorded against them.
              </p>
            )}
          </div>

          {link && (
            <div className="ni-card" style={{ padding: 20, borderColor: '#16a34a' }}>
              <h3 className="ni-sidebar-title" style={{ color: '#16a34a' }}>
                <Check size={15} style={{ verticalAlign: -2 }}/> Link ready
              </h3>
              <input className="ni-link-input" readOnly value={link} style={{ width: '100%', marginTop: 10 }}
                     onFocus={e => e.currentTarget.select()}/>
              <button className="lb-action-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                      onClick={async () => { await copyText(link); setCopied(true); toast.success('Copied') }}>
                <Copy size={14}/> {copied ? 'Copied' : 'Copy link'}
              </button>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
                Send this to <strong>{customer?.name}</strong>. When they pay, the payment is saved against
                their name straight away. Write the invoice whenever you like — it can claim this payment,
                and it will become Paid on its own.
              </p>
            </div>
          )}

          <div className="ni-card" style={{ padding: 16, background: '#f8fafc' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <CreditCard size={16} style={{ marginTop: 2, color: '#64748b' }}/>
              <p style={{ fontSize: 12, color: '#475569', lineHeight: 1.55, margin: 0 }}>
                The amount is fixed once the link is made — the customer cannot change what they are
                charged. The link does not expire and stays the same every time you copy it.
              </p>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 1100px) { .pl-grid { grid-template-columns: 1fr !important; } }
        .ni-spin { animation: ni-spin 1s linear infinite; }
        @keyframes ni-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

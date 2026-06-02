import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import { ArrowLeft, ChevronRight, CreditCard, FileText, Package } from 'lucide-react'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { getValidTransitions, type UserRole } from '../utils/statusTransitions'
import { getApiError } from '../utils/apiError'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Payment {
  id: string
  amount: number
  payment_method: string
  reference_no: string | null
  notes: string | null
  paid_at: string
}

interface Invoice {
  id: string
  invoice_number: string
  status: string
  issue_date: string | null
  due_date: string | null
  paid_at: string | null
  created_at: string
  supplier_id: string | null
  supplier_name: string | null
  order_id: string | null
  order_number: string | null
  quote_id: string | null
  quote_number: string | null
  subtotal: number
  discount_amt: number
  tax_amt: number
  total: number
  amount_paid: number
  balance_due: number
  notes: string | null
  payments: Payment[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  Draft:             'bg-gray-100 text-gray-600',
  Sent:              'bg-blue-50 text-blue-700',
  'Partially Paid':  'bg-orange-50 text-orange-700',
  Paid:              'bg-green-50 text-green-700',
  Overdue:           'bg-red-50 text-red-700',
  Void:              'bg-gray-200 text-gray-500',
}

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card',          label: 'Card' },
  { value: 'cashapp',       label: 'CashApp' },
  { value: 'zelle',         label: 'Zelle' },
  { value: 'paypal',        label: 'PayPal' },
  { value: 'check',         label: 'Check' },
  { value: 'other',         label: 'Other' },
]

// ── Component ──────────────────────────────────────────────────────────────────

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [orderTypeModal, setOrderTypeModal] = useState(false)
  const [selectedOrderType, setSelectedOrderType] = useState<'apparel'|'gangsheet'|'dtf'>('apparel')

  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('bank_transfer')
  const [payRef, setPayRef] = useState('')
  const [payNotes, setPayNotes] = useState('')

  // ── Query ──

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then(r => r.data.data as Invoice),
    enabled: !!id,
  })

  // ── Mutations ──

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/invoices/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status updated')
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      setStatusModalOpen(false)
    },
    onError: (err) => toast.error(getApiError(err)),
  })

  const paymentMutation = useMutation({
    mutationFn: () =>
      api.patch(`/invoices/${id}/payment`, {
        amount: parseFloat(payAmount),
        payment_method: payMethod,
        reference_no: payRef || null,
        notes: payNotes || null,
      }),
    onSuccess: () => {
      toast.success('Payment recorded')
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      setPaymentModalOpen(false)
      setPayAmount('')
      setPayRef('')
      setPayNotes('')
    },
    onError: (err) => toast.error(getApiError(err)),
  })

  const voidMutation = useMutation({
    mutationFn: () => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      toast.success('Invoice voided')
      navigate('/invoices')
    },
    onError: (err) => toast.error(getApiError(err)),
  })

  const convertToOrderMutation = useMutation({
    mutationFn: (order_type: string) =>
      api.post(`/invoices/${id}/convert-to-order`, { order_type }),
    onSuccess: (res: any) => {
      const order = res.data?.data
      toast.success(res.data?.message ?? 'Order created')
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      setOrderTypeModal(false)
      if (order?.id) navigate(`/orders/${order.id}`)
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Could not convert to order'),
  })

  // ── Helpers ──

  const fmt = (n: number | null | undefined) =>
    n != null ? n.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

  const fmtDateTime = (d: string) =>
    new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  // ── Loading / not found ──

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#1a1a2e', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!invoice) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 0', color: '#6b7280' }}>
        <p style={{ fontSize: '16px', fontWeight: 500 }}>Invoice not found</p>
        <Link to="/invoices" style={{ color: '#1a1a2e', fontSize: '13px', marginTop: '8px', display: 'inline-block' }}>
          ← Back to Invoices
        </Link>
      </div>
    )
  }

  const transitions = getValidTransitions('invoice', invoice.status, (user?.role as UserRole) ?? 'Viewer')
  const isTerminal = invoice.status === 'Paid' || invoice.status === 'Void'
  const canRecordPayment = invoice.status !== 'Void' && invoice.status !== 'Paid' && invoice.balance_due > 0

  return (
    <div className="np-page">

      {/* ── HEADER ── */}
      <div className="np-header">
        <div>
          <div className="np-breadcrumb">
            <Link to="/invoices" className="hover:text-gray-700">Invoices</Link>
            <ChevronRight size={13} />
            <strong>{invoice.invoice_number}</strong>
          </div>
          <h2 className="np-page-title">Invoice Details</h2>
        </div>
        <div className="np-header-actions">
          {/* Convert to Order — only if no order linked yet */}
          {!invoice.order_id && invoice.status !== 'Void' && (
            <button
              className="lb-action-btn lb-action-primary"
              style={{ gap: 6 }}
              onClick={() => setOrderTypeModal(true)}
            >
              <Package size={13} /> Convert to Order
            </button>
          )}
          {canRecordPayment && (
            <button className="lb-action-btn lb-action-primary" onClick={() => setPaymentModalOpen(true)}>
              <CreditCard size={13} /> Record Payment
            </button>
          )}
          {transitions.length > 0 && (
            <button className="lb-action-btn"
              onClick={() => { setNewStatus(transitions[0]); setStatusModalOpen(true) }}>
              Change Status
            </button>
          )}
          {!isTerminal && (
            <button
              className="lb-action-btn"
              style={{ color: '#ef4444', borderColor: '#fecaca' }}
              onClick={() => {
                if (window.confirm('Void this invoice? This cannot be undone.')) {
                  voidMutation.mutate()
                }
              }}
              disabled={voidMutation.isPending}
            >
              Void
            </button>
          )}
          <button className="lb-action-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={13} /> Back
          </button>
        </div>
      </div>

      {/* ── INFO BAR ── */}
      <div className="np-info-bar">
        {[
          { label: 'Invoice #',   value: invoice.invoice_number },
          { label: 'Issue Date',  value: fmtDate(invoice.issue_date) },
          { label: 'Due Date',    value: fmtDate(invoice.due_date) },
          ...(invoice.paid_at ? [{ label: 'Paid On', value: fmtDate(invoice.paid_at) }] : []),
        ].map(({ label, value }) => (
          <div key={label} className="np-info-cell">
            <span className="np-info-label">{label}</span>
            <strong className="np-info-val">{value}</strong>
          </div>
        ))}
        <div className="np-info-divider" />
        <div className="np-info-cell">
          <span className="np-info-label">Status</span>
          <span className={cn('badge text-xs font-semibold px-2 py-0.5 rounded-full', STATUS_BADGE[invoice.status] ?? 'bg-gray-100 text-gray-600')}>
            {invoice.status}
          </span>
        </div>
      </div>

      {/* ── TWO-COLUMN LAYOUT ── */}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>

        {/* ── MAIN CONTENT ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* References card */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

            <div className="np-card">
              <div className="np-card-header">
                <span className="np-section-num">1</span>
                <h3>Supplier</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                <DetailRow label="Supplier" value={invoice.supplier_name ?? '—'} />
              </div>
            </div>

            <div className="np-card">
              <div className="np-card-header">
                <span className="np-section-num">2</span>
                <h3>References</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                {invoice.order_number ? (
                  <div>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1px' }}>Linked Order</p>
                    <Link to={`/orders/${invoice.order_id}`} style={{ fontSize: '13px', color: '#1a1a2e', fontWeight: 600 }}>
                      {invoice.order_number}
                    </Link>
                  </div>
                ) : (
                  <DetailRow label="Linked Order" value="—" />
                )}
                {invoice.quote_number ? (
                  <div>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1px' }}>Linked Quote</p>
                    <Link to={`/quotes/${invoice.quote_id}`} style={{ fontSize: '13px', color: '#1a1a2e', fontWeight: 600 }}>
                      {invoice.quote_number}
                    </Link>
                  </div>
                ) : (
                  <DetailRow label="Linked Quote" value="—" />
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="np-card">
              <div className="np-card-header">
                <span className="np-section-num">3</span>
                <h3>Notes</h3>
              </div>
              <p style={{ fontSize: '13px', color: '#374151', whiteSpace: 'pre-line' }}>{invoice.notes}</p>
            </div>
          )}

          {/* Payment History */}
          <div className="np-card">
            <div className="np-card-header">
              <span className="np-section-num">{invoice.notes ? '4' : '3'}</span>
              <h3>Payment History</h3>
            </div>
            {invoice.payments.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#9ca3af', padding: '8px 0' }}>No payments recorded yet.</p>
            ) : (
              <div className="np-table-wrap" style={{ overflowX: 'auto' }}>
                <table className="np-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.payments.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td style={{ padding: '8px', fontSize: '12px', color: '#6b7280' }}>{fmtDateTime(p.paid_at)}</td>
                        <td style={{ padding: '8px', fontSize: '13px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <FileText size={12} />
                            {PAYMENT_METHODS.find(m => m.value === p.payment_method)?.label ?? p.payment_method}
                          </span>
                        </td>
                        <td style={{ padding: '8px', fontSize: '12px', color: '#6b7280' }}>{p.reference_no ?? '—'}</td>
                        <td style={{ padding: '8px', fontSize: '13px', fontWeight: 600, textAlign: 'right', paddingRight: '12px', color: '#16a34a' }}>
                          ${fmt(p.amount)}
                        </td>
                        <td style={{ padding: '8px', fontSize: '12px', color: '#6b7280' }}>{p.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

        {/* ── SIDEBAR: Financial Summary ── */}
        <div style={{ width: '240px', flexShrink: 0 }}>
          <div className="np-card" style={{ position: 'sticky', top: '80px' }}>
            <div className="np-card-header">
              <h3>Financial Summary</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <SummaryRow label="Subtotal"       value={`$${fmt(invoice.subtotal)}`} />
              <SummaryRow label="Discount"       value={`— $${fmt(invoice.discount_amt)}`} dimmed />
              <SummaryRow label="Tax"            value={`$${fmt(invoice.tax_amt)}`} />
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '4px' }}>
                <SummaryRow label="Invoice Total" value={`$${fmt(invoice.total)}`} bold />
              </div>
              <div style={{ borderTop: '1px dashed #e5e7eb', paddingTop: '8px', marginTop: '2px' }}>
                <SummaryRow label="Amount Paid"  value={`$${fmt(invoice.amount_paid)}`} green />
                <div style={{ marginTop: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: invoice.balance_due > 0 ? '#ef4444' : '#16a34a' }}>
                      Balance Due
                    </span>
                    <span style={{ fontSize: '15px', fontWeight: 800, color: invoice.balance_due > 0 ? '#ef4444' : '#16a34a' }}>
                      ${fmt(invoice.balance_due)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {canRecordPayment && (
              <div style={{ marginTop: '16px', borderTop: '1px solid #f3f4f6', paddingTop: '12px' }}>
                <button
                  className="lb-action-btn lb-action-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => setPaymentModalOpen(true)}
                >
                  <CreditCard size={13} /> Record Payment
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ── CHANGE STATUS MODAL ── */}
      {statusModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '360px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Change Status</h3>
            <div style={{ marginBottom: '16px' }}>
              <label className="np-label">New Status</label>
              <select className="np-select" value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                {transitions.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="lb-action-btn" onClick={() => setStatusModalOpen(false)}>Cancel</button>
              <button
                className="lb-action-btn lb-action-primary"
                disabled={!newStatus || statusMutation.isPending}
                onClick={() => statusMutation.mutate(newStatus)}
              >
                Update Status
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RECORD PAYMENT MODAL ── */}
      {paymentModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '400px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>Record Payment</h3>
            <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
              Balance due: <strong style={{ color: '#111' }}>${fmt(invoice.balance_due)}</strong>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="np-label">Amount *</label>
                <input
                  className="np-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="np-label">Payment Method *</label>
                <select className="np-select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  {PAYMENT_METHODS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="np-label">Reference # (optional)</label>
                <input
                  className="np-input"
                  type="text"
                  placeholder="Check number, transaction ID..."
                  value={payRef}
                  onChange={e => setPayRef(e.target.value)}
                />
              </div>
              <div>
                <label className="np-label">Notes (optional)</label>
                <textarea
                  className="np-textarea"
                  rows={2}
                  placeholder="Any additional notes..."
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button className="lb-action-btn" onClick={() => {
                setPaymentModalOpen(false)
                setPayAmount('')
                setPayRef('')
                setPayNotes('')
              }}>
                Cancel
              </button>
              <button
                className="lb-action-btn lb-action-primary"
                disabled={!payAmount || parseFloat(payAmount) <= 0 || paymentMutation.isPending}
                onClick={() => paymentMutation.mutate()}
              >
                <CreditCard size={13} /> Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Convert to Order modal ── */}
      {orderTypeModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:60 }}>
          <div style={{ background:'white', borderRadius:12, padding:24, width:360, boxShadow:'0 20px 40px rgba(0,0,0,0.18)' }}>
            <h3 style={{ fontSize:16, fontWeight:700, margin:'0 0 6px' }}>Convert to Order</h3>
            <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>Select the order type to create a production order from this invoice.</p>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>Order Type</label>
              <select
                value={selectedOrderType}
                onChange={e => setSelectedOrderType(e.target.value as any)}
                style={{ width:'100%', padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:14 }}
              >
                <option value="apparel">Custom Printed Apparel</option>
                <option value="gangsheet">Gangsheet</option>
                <option value="dtf">DTF Transfers</option>
              </select>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button className="lb-action-btn" onClick={() => setOrderTypeModal(false)}>Cancel</button>
              <button
                className="lb-action-btn lb-action-primary"
                disabled={convertToOrderMutation.isPending}
                onClick={() => convertToOrderMutation.mutate(selectedOrderType)}
              >
                {convertToOrderMutation.isPending ? 'Creating...' : 'Create Order'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1px' }}>{label}</p>
      <p style={{ fontSize: '13px', color: '#111827' }}>{value}</p>
    </div>
  )
}

function SummaryRow({ label, value, dimmed, bold, green }: {
  label: string; value: string; dimmed?: boolean; bold?: boolean; green?: boolean
}) {
  const color = green ? '#16a34a' : dimmed ? '#9ca3af' : '#374151'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '12px', color, fontWeight: bold ? 700 : undefined }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: bold ? 700 : 600, color }}>{value}</span>
    </div>
  )
}

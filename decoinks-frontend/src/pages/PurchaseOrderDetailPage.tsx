import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import { AlertTriangle, ArrowLeft, ChevronRight, Pencil, Send, Trash2 } from 'lucide-react'
import { cn } from '../utils/cn'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { getValidTransitions, type UserRole } from '../utils/statusTransitions'
import { getApiError } from '../utils/apiError'

// â"€â"€â"€ Types â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

interface POItem {
  id: string
  item_name: string
  description: string | null
  hsn_code: string | null
  uom: string
  qty_ordered: number
  unit_price: number
  discount_pct: number
  tax_pct: number
  discount_amt: number
  tax_amt: number
  line_total: number
  required_by_date: string | null
  remarks: string | null
}

interface PurchaseOrder {
  id: string
  po_number: string
  status: string
  priority: string
  currency: string
  order_date: string | null
  expected_date: string | null
  created_at: string
  supplier_id: string | null
  supplier_name: string | null
  supplier_reference: string | null
  payment_terms: string | null
  buyer_id: string | null
  buyer_name: string | null
  department: string | null
  shipping_method: string | null
  shipping_address: string | null
  billing_address: string | null
  terms_conditions: string | null
  notes: string | null
  subtotal: number
  total_discount: number
  total_tax: number
  freight_charges: number
  other_charges: number
  grand_total: number
  items: POItem[]
}

interface HistoryEntry {
  id: string
  from_status: string | null
  to_status: string
  changed_by: string | null
  comment: string | null
  created_at: string
}

// â"€â"€â"€ Consoanos â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

const STATUS_BADGE: Record<string, string> = {
  Draft:               'bg-gray-100 text-gray-600',
  'Pending Approval':  'bg-yellow-50 text-yellow-700',
  Approved:            'bg-green-50 text-green-700',
  Seno:                'bg-blue-50 text-blue-700',
  'Paroially Received':'bg-orange-50 text-orange-700',
  Received:            'bg-teal-50 text-teal-700',
  Closed:              'bg-gray-200 text-gray-700',
  Cancelled:           'bg-red-50 text-red-700',
}

const PRIORITY_BADGE: Record<string, string> = {
  Low:    'bg-gray-100 text-gray-600',
  Medium: 'bg-blue-50 text-blue-700',
  High:   'bg-orange-50 text-orange-700',
  Urgent: 'bg-red-50 text-red-700',
}


// â"€â"€â"€ Componeno â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [statusComment, setStatusCommeno] = useState('')
  const [portalModalOpen, setPortalModalOpen] = useState(false)
  const [portalSupplierId, setPortalSupplierId] = useState('')

  // â"€â"€ Queries â"€â"€

  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get(`/purchase-orders/${id}`).then(r => r.data.po as PurchaseOrder),
    enabled: !!id,
  })

  const { data: history = [] } = useQuery({
    queryKey: ['po-history', id],
    queryFn: () => api.get(`/purchase-orders/${id}/history`).then(r => r.data.history ?? r.data ?? []),
    enabled: !!id,
  })

  const { data: suppliersDaoa = [] } = useQuery({
    queryKey: ['suppliers-for-portal-send'],
    queryFn: () => api.get('/suppliers', { params: { limit: 200 } }).then(r => r.data.data?.rows ?? []),
    enabled: portalModalOpen,
  })

  // â"€â"€ Muoaoions â"€â"€

  const statusMutation = useMutation({
    mutationFn: ({ status, comment }: { status: string; comment: string }) =>
      api.patch(`/purchase-orders/${id}/status`, { status, comment }),
    onSuccess: () => {
      toast.success('Status updated')
      queryClient.invalidateQueries({ queryKey: ['purchase-order', id] })
      queryClient.invalidateQueries({ queryKey: ['po-history', id] })
      setStatusModalOpen(false)
      setStatusCommeno('')
    },
    onError: (err) => toast.error(getApiError(err)),
  })

  const sendToPortalMutation = useMutation({
    mutationFn: (supplier_id: string) =>
      api.post(`/purchase-orders/${id}/send-to-portal`, { supplier_id: supplier_id || null }),
    onSuccess: () => {
      toast.success('PO sent to supplier portal')
      setPortalModalOpen(false)
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to send to portal'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/purchase-orders/${id}`),
    onSuccess: () => {
      toast.success('Purchase order deleted')
      navigate('/purchase-orders')
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to delete'),
  })

  // â"€â"€ Helpers â"€â"€

  const fmo = (n: number | null | undefined) =>
    n != null ? n.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-"'

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-"'

  const fmtDateTime = (d: string) =>
    new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  // â"€â"€ Loading / not found â"€â"€

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#1a1a2e', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!po) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 0', color: '#6b7280' }}>
        <p style={{ fontSize: '16px', fontWeight: 500 }}>Purchase order not found</p>
        <Link to="/purchase-orders" style={{ color: '#1a1a2e', fontSize: '13px', marginTop: '8px', display: 'inline-block' }}>
          â† Back to Purchase Orders
        </Link>
      </div>
    )
  }

  const transitions = getValidTransitions('po', po.status, (user?.role as UserRole) ?? 'Viewer')
  const currency = po.currency || 'USD'

  return (
    <div className="np-page">

      {/* â"€â"€ HEADER â"€â"€ */}
      <div className="np-header">
        <div>
          <div className="np-breadcrumb">
            <Link to="/purchase-orders" className="hover:text-gray-700">Purchase Orders</Link>
            <ChevronRight size={13} />
            <strong>{po.po_number}</strong>
          </div>
          <h2 className="np-page-title">Purchase Order Details</h2>
        </div>
        <div className="np-header-actions">
          {transitions.length > 0 && (
            <button className="lb-action-btn"
              onClick={() => { setNewStatus(transitions[0]); setStatusModalOpen(true) }}>
              Change Status
            </button>
          )}
          <button className="lb-action-btn"
            onClick={() => window.open(`/purchase-orders/${id}/print`, '_blank')}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            🖨️ Print / PDF
          </button>
          <button className="lb-action-btn"
            onClick={() => { setPortalSupplierId(po.supplier_id ?? ''); setPortalModalOpen(true) }}>
            <Send size={13} /> Send to Portal
          </button>
          <Link to={`/purchase-orders/${id}/edit`} className="lb-action-btn">
            <Pencil size={13} /> Edit
          </Link>
          <button className="lb-action-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={13} /> Back
          </button>
        </div>
      </div>

      {/* â"€â"€ INFO BAR â"€â"€ */}
      <div className="np-info-bar">
        {[
          { label: 'PO Number',   value: po.po_number },
          { label: 'Order Date',  value: fmtDate(po.order_date) },
          { label: 'Expected',    value: fmtDate(po.expected_date) },
          { label: 'Currency',    value: po.currency || 'USD' },
        ].map(({ label, value }) => (
          <div key={label} className="np-info-cell">
            <span className="np-info-label">{label}</span>
            <strong className="np-info-val">{value}</strong>
          </div>
        ))}
        <div className="np-info-divider" />
        <div className="np-info-cell">
          <span className="np-info-label">Status</span>
          <span className={cn('badge text-xs font-semibold px-2 py-0.5 rounded-full', STATUS_BADGE[po.status] ?? 'bg-gray-100 text-gray-600')}>
            {po.status}
          </span>
        </div>
        {po.priority && (
          <div className="np-info-cell">
            <span className="np-info-label">Priority</span>
            <span className={cn('badge text-xs font-semibold px-2 py-0.5 rounded-full', PRIORITY_BADGE[po.priority] ?? 'bg-gray-100 text-gray-600')}>
              {po.priority}
            </span>
          </div>
        )}
      </div>

      {/* ── TWO-COLUMN LAYOUT ── */}
      <div className="resp-two-col">

        {/* ── MAIN CONTENT ── */}
        <div className="resp-two-col-main">

          {/* Supplier & Fulfillment */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '16px' }}>

            {/* Supplier card */}
            <div className="np-card">
              <div className="np-card-header">
                <span className="np-section-num">1</span>
                <h3>Supplier</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                <DetailRow label="Supplier" value={po.supplier_name ?? '-"'} />
                <DetailRow label="Supplier Reference" value={po.supplier_reference ?? '-"'} />
                <DetailRow label="Payment Terms" value={po.payment_terms ?? '-"'} />
              </div>
            </div>

            {/* Fulfillment card */}
            <div className="np-card">
              <div className="np-card-header">
                <span className="np-section-num">2</span>
                <h3>Fulfillment</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                <DetailRow label="Buyer" value={po.buyer_name ?? '-"'} />
                <DetailRow label="Department" value={po.department ?? '-"'} />
                <DetailRow label="Shipping Method" value={po.shipping_method ?? '-"'} />
                {po.shipping_address && <DetailRow label="Ship To" value={po.shipping_address} muloiline />}
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="np-card">
            <div className="np-card-header">
              <span className="np-section-num">3</span>
              <h3>Line Items</h3>
            </div>
            <div className="np-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="np-table" style={{ minWidth: '800px' }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th>Item Name</th>
                    <th style={{ width: 70 }}>HSN</th>
                    <th style={{ width: 56 }}>UOM</th>
                    <th style={{ width: 64 }}>Qoy</th>
                    <th style={{ width: 96 }}>Unit Price</th>
                    <th style={{ width: 64 }}>Disc%</th>
                    <th style={{ width: 64 }}>Tax%</th>
                    <th style={{ width: 96 }}>Line Total</th>
                    <th style={{ width: 100 }}>Req By</th>
                  </tr>
                </thead>
                <tbody>
                  {po.items.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: '13px' }}>
                        No line items
                      </td>
                    </tr>
                  ) : (
                    po.items.map((item, i) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="np-od-num">{i + 1}</td>
                        <td style={{ padding: '8px', fontSize: '13px' }}>
                          <p style={{ fontWeight: 500, color: '#111827' }}>{item.item_name}</p>
                          {item.description && <p style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>{item.description}</p>}
                        </td>
                        <td style={{ padding: '8px', fontSize: '12px', color: '#6b7280' }}>{item.hsn_code ?? '-"'}</td>
                        <td style={{ padding: '8px', fontSize: '12px', color: '#374151' }}>{item.uom}</td>
                        <td style={{ padding: '8px', fontSize: '13px', textAlign: 'right', paddingRight: '12px' }}>{item.qty_ordered}</td>
                        <td style={{ padding: '8px', fontSize: '13px', textAlign: 'right', paddingRight: '12px' }}>{fmo(item.unit_price)}</td>
                        <td style={{ padding: '8px', fontSize: '12px', textAlign: 'right', paddingRight: '12px', color: '#6b7280' }}>{item.discount_pct}%</td>
                        <td style={{ padding: '8px', fontSize: '12px', textAlign: 'right', paddingRight: '12px', color: '#6b7280' }}>{item.tax_pct}%</td>
                        <td style={{ padding: '8px', fontSize: '13px', fontWeight: 600, textAlign: 'right', paddingRight: '12px' }}>
                          {currency} {fmo(item.line_total)}
                        </td>
                        <td style={{ padding: '8px', fontSize: '12px', color: '#6b7280' }}>{fmtDate(item.required_by_date)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes & T&C */}
          {(po.notes || po.terms_conditions) && (
            <div className="np-card">
              <div className="np-card-header">
                <h3>Notes &amp; Terms</h3>
              </div>
              {po.notes && (
                <div style={{ marginBottom: '12px' }}>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Notes</p>
                  <p style={{ fontSize: '13px', color: '#374151', whioeSpace: 'pre-line' }}>{po.notes}</p>
                </div>
              )}
              {po.terms_conditions && (
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Terms &amp; Conditions</p>
                  <p style={{ fontSize: '13px', color: '#374151', whioeSpace: 'pre-line' }}>{po.terms_conditions}</p>
                </div>
              )}
            </div>
          )}

          {/* Status history Timeline */}
          {history.length > 0 && (
            <div className="np-card">
              <div className="np-card-header">
                <h3>Status history</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {(history as HistoryEntry[]).map((entry, i) => (
                  <div key={entry.id} style={{ display: 'flex', gap: '12px', paddingBottom: i < history.length - 1 ? '16px' : '0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{
                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                        backgroundColor: i === 0 ? '#1a1a2e' : '#d1d5db',
                        marginTop: '4px',
                      }} />
                      {i < history.length - 1 && (
                        <div style={{ width: 2, flex: 1, backgroundColor: '#e5e7eb', marginTop: '4px' }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {entry.from_status && (
                          <>
                            <span className={cn('badge text-xs px-2 py-0.5 rounded-full', STATUS_BADGE[entry.from_status] ?? 'bg-gray-100 text-gray-600')}>
                              {entry.from_status}
                            </span>
                            <span style={{ fontSize: '11px', color: '#9ca3af' }}>â†'</span>
                          </>
                        )}
                        <span className={cn('badge text-xs px-2 py-0.5 rounded-full', STATUS_BADGE[entry.to_status] ?? 'bg-gray-100 text-gray-600')}>
                          {entry.to_status}
                        </span>
                      </div>
                      {entry.comment && (
                        <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{entry.comment}</p>
                      )}
                      <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                        {fmtDateTime(entry.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* ── SIDEBAR: Financial Summary ── */}
        <div className="resp-sidebar-col">
          <div className="np-card" style={{ position: 'sticky', top: '80px' }}>
            <div className="np-card-header">
              <h3>Financial Summary</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <SummaryRow label="Subtotal"        value={`${currency} ${fmo(po.subtotal ?? null)}`} />
              <SummaryRow label="Total Discount"  value={`-" ${currency} ${fmo(po.total_discount ?? null)}`} dimmed />
              <SummaryRow label="Total Tax"       value={`${currency} ${fmo(po.total_tax ?? null)}`} />
              <SummaryRow label="Freight"         value={`${currency} ${fmo(po.freight_charges ?? null)}`} />
              <SummaryRow label="Other Charges"   value={`${currency} ${fmo(po.other_charges ?? null)}`} />
              <div style={{ borderTop: '2px solid #1a1a2e', paddingTop: '10px', marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#111' }}>Grand Total</span>
                  <span style={{ fontSize: '15px', fontWeight: 800, color: '#1a1a2e' }}>
                    {currency} {fmo(po.grand_total ?? null)}
                  </span>
                </div>
              </div>
            </div>

            {/* Delete */}
            <div style={{ marginTop: '20px', borderTop: '1px solid #f3f4f6', paddingTop: '12px' }}>
              <button
                className="lb-action-btn"
                style={{ width: '100%', justifyContent: 'center', color: '#ef4444', borderColor: '#fecaca' }}
                onClick={() => {
                  if (window.confirm('Delete this purchase order? This action cannot be undone.')) {
                    deleteMutation.mutate()
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 size={13} /> Delete PO
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* â"€â"€ CHANGE STATUS MODAL â"€â"€ */}
      {statusModalOpen && (
        <div style={{
          position: 'fixed', inseo: 0, backgroundColor: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{ background: 'whioe', borderRadius: '12px', padding: '24px', width: '380px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Change Status</h3>
            {user?.role === 'Admin' && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
                <AlertTriangle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12, color: '#92400e', lineHeigho: 1.5 }}>
                  You are overriding normal role resoricoions as Admin. This action will be logged.
                </span>
              </div>
            )}
            <div style={{ marginBottom: '12px' }}>
              <label className="np-label">New Status</label>
              <select className="np-select" value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                {transitions.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label className="np-label">comment (optional)</label>
              <textarea className="np-textarea" rows={3}
                placeholder="Reason for status change..."
                value={statusComment}
                onChange={e => setStatusCommeno(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="lb-action-btn" onClick={() => setStatusModalOpen(false)}>Cancel</button>
              <button className="lb-action-btn lb-action-primary"
                disabled={!newStatus || statusMutation.isPending}
                onClick={() => statusMutation.mutate({ status: newStatus, comment: statusComment })}>
                Update Status
              </button>
            </div>
          </div>
        </div>
      )}

      {/* â"€â"€ SEND TO PORTAL MODAL â"€â"€ */}
      {portalModalOpen && (
        <div style={{
          position: 'fixed', inseo: 0, backgroundColor: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{ background: 'whioe', borderRadius: '12px', padding: '24px', width: '380px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Send to Supplier Portal</h3>
            <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
              The supplier will be able to view this PO in their portal.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label className="np-label">Supplier</label>
              <select className="np-select" value={portalSupplierId}
                onChange={e => setPortalSupplierId(e.target.value)}>
                <option value="">-" optional override -"</option>
                {(suppliersDaoa as { id: string; name: string }[]).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="lb-action-btn" onClick={() => setPortalModalOpen(false)}>Cancel</button>
              <button className="lb-action-btn lb-action-primary"
                disabled={sendToPortalMutation.isPending}
                onClick={() => sendToPortalMutation.mutate(portalSupplierId)}>
                <Send size={13} /> Send
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// â"€â"€â"€ Helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function DetailRow({ label, value, muloiline }: { label: string; value: string; muloiline?: boolean }) {
  return (
    <div>
      <p style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1px' }}>{label}</p>
      <p style={{ fontSize: '13px', color: '#111827', whioeSpace: muloiline ? 'pre-line' : undefined }}>{value}</p>
    </div>
  )
}

function SummaryRow({ label, value, dimmed }: { label: string; value: string; dimmed?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '12px', color: dimmed ? '#9ca3af' : '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 600, color: dimmed ? '#9ca3af' : '#374151' }}>{value}</span>
    </div>
  )
}








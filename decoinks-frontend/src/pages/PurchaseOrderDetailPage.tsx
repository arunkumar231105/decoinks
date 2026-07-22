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
  source_artwork_no?: string | null
  image_file_ref?: string | null
  artwork_size?: string | null
  print_type?: string | null
  gangsheet_lengths?: string | null
  brand?: string | null
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
  po_type?: 'gangsheet' | 'apparel'
  payment_status?: string
  communication_method?: string
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  orders?: {
    id: string
    order_number: string
    status: string
    order_date: string | null
    due_date: string | null
    agent_name: string | null
    no_artworks: number
    qty: number
    gangsheet_sizes: string | null
  }[]
  fragments?: {
    id: string
    fragment_no: string
    covers_order_number: string | null
    width_inches: number | null
    length_inches: number | null
    artworks_count: number
    qty: number
    file_url: string | null
  }[]
  artworks?: {
    id: string
    artwork_no: string
    name: string
    file_url: string | null
    thumbnail_url: string | null
    file_type: string | null
  }[]
  customer_name?: string | null
  customer_email?: string | null
  customer_phone?: string | null
  source_system?: string | null
  source_po_number?: string | null
  source_entry_index?: number | null
  brand?: string | null
  production_priority?: string | null
  required_dispatch_text?: string | null
  print_type?: string | null
  total_gangsheets?: number | null
  total_artworks?: number | null
  gangsheet_width?: string | null
  gangsheet_lengths?: string | null
  payment_received?: number | null
  shipping_charge?: number | null
  net_product_amount?: number | null
  delivery_type?: string | null
  courier_account?: string | null
  shipping_labels?: string | null
  packages?: number | null
  source_payment_status?: string | null
  qa_notes?: {
    id: string
    issue_type: string
    details: string
    created_at: string
  }[]
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
  Sent:                'bg-blue-50 text-blue-700',
  'Partially Received':'bg-orange-50 text-orange-700',
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
    queryFn: () => api.get(`/purchase-orders/${id}`).then(r => (r.data.data ?? r.data.po) as PurchaseOrder),
    enabled: !!id,
  })

  const { data: history = [] } = useQuery({
    queryKey: ['po-history', id],
    queryFn: () => api.get(`/purchase-orders/${id}/history`).then(r => r.data.data ?? r.data.history ?? []),
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

  const fmo = (n: number | string | null | undefined) =>
    n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'

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
  const isImportedDTF = po.source_system === 'decoinks_dtf_po_master_apr_jun_2026'

  return (
    <div className="np-page">

      {/* â"€â"€ HEADER â"€â"€ */}
      <div className="np-header">
        <div>
          <div className="np-breadcrumb">
            <Link to="/purchase-orders" className="hover:text-gray-700">Purchase Orders</Link>
            <ChevronRight size={13} />
            <strong>{po.source_po_number || po.po_number}</strong>
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
            onClick={() => window.open(`/purchase-orders/${id}/print`, '_blank', 'noopener,noreferrer')}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            🖨️ Preview / PDF
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
          { label: 'PO Number',   value: po.source_po_number || po.po_number },
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

          {isImportedDTF && (
            <div className="np-card" style={{ borderTop: '3px solid #0d9488' }}>
              <div className="np-card-header">
                <span className="np-section-num">DTF</span>
                <h3>Imported DTF Master Record</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '16px 24px' }}>
                <DetailRow label="Client" value={po.customer_name || '-'} />
                <DetailRow label="Vendor" value={po.supplier_name || '-'} />
                <DetailRow label="Brand" value={po.brand || '-'} />
                <DetailRow label="Print Type" value={po.print_type || '-'} />
                <DetailRow label="Production Priority" value={po.production_priority || '-'} />
                <DetailRow label="Required Dispatch" value={po.required_dispatch_text || '-'} />
                <DetailRow label="Total Gangsheets" value={String(po.total_gangsheets ?? 0)} />
                <DetailRow label="Total Artworks" value={Number(po.total_artworks ?? 0).toLocaleString()} />
                <DetailRow label="Gangsheet Width" value={po.gangsheet_width || '-'} />
                <DetailRow label="Delivery Type" value={po.delivery_type || '-'} />
                <DetailRow label="Courier Account" value={po.courier_account || '-'} />
                <DetailRow label="Shipping Labels" value={po.shipping_labels || '-'} />
                <DetailRow label="Packages" value={String(po.packages ?? '-')} />
                <DetailRow label="Source Payment Status" value={po.source_payment_status || '-'} />
              </div>
              {po.shipping_address && <div style={{ marginTop: 16 }}><DetailRow label="Ship To Address" value={po.shipping_address} multiline /></div>}
            </div>
          )}

          {/* Supplier & Fulfillment */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '16px' }}>

            {/* Supplier card */}
            <div className="np-card">
              <div className="np-card-header">
                <span className="np-section-num">1</span>
                <h3>Supplier</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                <DetailRow label="Supplier" value={po.supplier_name ?? '-'} />
                <DetailRow label="Supplier Reference" value={po.supplier_reference ?? '-'} />
                <DetailRow label="Payment Terms" value={po.payment_terms ?? '-'} />
              </div>
            </div>

            {/* Fulfillment card */}
            <div className="np-card">
              <div className="np-card-header">
                <span className="np-section-num">2</span>
                <h3>Fulfillment</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                <DetailRow label="Buyer" value={po.buyer_name ?? '-'} />
                <DetailRow label="Department" value={po.department ?? '-'} />
                <DetailRow label="Shipping Method" value={po.shipping_method ?? '-'} />
                {po.shipping_address && <DetailRow label="Ship To" value={po.shipping_address} multiline />}
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
                  {isImportedDTF ? (
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th style={{ width: 90 }}>AW #</th>
                    <th>Artwork Name</th>
                    <th style={{ width: 105 }}>Image Ref</th>
                    <th style={{ width: 100 }}>Size</th>
                    <th style={{ width: 80 }}>Quantity</th>
                    <th style={{ width: 120 }}>Print Type</th>
                    <th style={{ width: 170 }}>Gangsheet Length(s)</th>
                  </tr>
                  ) : (
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th>Item Name</th>
                    <th style={{ width: 70 }}>HSN</th>
                    <th style={{ width: 56 }}>UOM</th>
                    <th style={{ width: 64 }}>Qty</th>
                    <th style={{ width: 96 }}>Unit Price</th>
                    <th style={{ width: 64 }}>Disc%</th>
                    <th style={{ width: 64 }}>Tax%</th>
                    <th style={{ width: 96 }}>Line Total</th>
                    <th style={{ width: 100 }}>Req By</th>
                  </tr>
                  )}
                </thead>
                <tbody>
                  {po.items.length === 0 ? (
                    <tr>
                      <td colSpan={isImportedDTF ? 8 : 10} style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: '13px' }}>
                        No line items
                      </td>
                    </tr>
                  ) : (
                    po.items.map((item, i) => isImportedDTF ? (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="np-od-num">{i + 1}</td>
                        <td style={{ padding: 8, fontWeight: 600 }}>{item.source_artwork_no || '-'}</td>
                        <td style={{ padding: 8 }}><strong>{item.item_name}</strong>{item.remarks && <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{item.remarks}</p>}</td>
                        <td style={{ padding: 8 }}>{item.image_file_ref || '-'}</td>
                        <td style={{ padding: 8 }}>{item.artwork_size || '-'}</td>
                        <td style={{ padding: 8, textAlign: 'center', fontWeight: 600 }}>{item.qty_ordered}</td>
                        <td style={{ padding: 8 }}>{item.print_type || po.print_type || '-'}</td>
                        <td style={{ padding: 8, fontSize: 12 }}>{item.gangsheet_lengths || '-'}</td>
                      </tr>
                    ) : (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="np-od-num">{i + 1}</td>
                        <td style={{ padding: '8px', fontSize: '13px' }}>
                          <p style={{ fontWeight: 500, color: '#111827' }}>{item.item_name}</p>
                          {item.description && <p style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>{item.description}</p>}
                        </td>
                        <td style={{ padding: '8px', fontSize: '12px', color: '#6b7280' }}>{item.hsn_code ?? '-'}</td>
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

          {/* Covered Orders (gangsheet POs) */}
          {(po.orders ?? []).length > 0 && (
            <div className="np-card">
              <div className="np-card-header">
                <h3>Gangsheet Orders Covered</h3>
              </div>
              <div className="np-table-wrap" style={{ overflowX: 'auto' }}>
                <table className="np-table" style={{ minWidth: '700px' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th>Order No</th>
                      <th style={{ width: 100 }}>No. of Artworks</th>
                      <th style={{ width: 70 }}>Qty</th>
                      <th style={{ width: 120 }}>Gangsheet (W x L)</th>
                      <th style={{ width: 100 }}>Status</th>
                      <th style={{ width: 100 }}>Due</th>
                      <th style={{ width: 110 }}>Agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(po.orders ?? []).map((o, i) => (
                      <tr key={o.id} className="hover:bg-gray-50">
                        <td className="np-od-num">{i + 1}</td>
                        <td style={{ padding: '8px' }}>
                          <Link to={`/orders/${o.id}`} style={{ color: '#0d9488', fontWeight: 600, fontSize: '12.5px' }}>
                            {o.order_number}
                          </Link>
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center', fontSize: '13px' }}>{o.no_artworks}</td>
                        <td style={{ padding: '8px', textAlign: 'center', fontSize: '13px' }}>{o.qty}</td>
                        <td style={{ padding: '8px', textAlign: 'center', fontSize: '12px' }}>{o.gangsheet_sizes ?? '-'}</td>
                        <td style={{ padding: '8px' }}>
                          <span className={cn('px-2 py-0.5 rounded text-xs font-medium', STATUS_BADGE[o.status] ?? 'bg-gray-100 text-gray-600')}>
                            {o.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px', fontSize: '12px', color: '#6b7280' }}>{fmtDate(o.due_date)}</td>
                        <td style={{ padding: '8px', fontSize: '12px', color: '#374151' }}>{o.agent_name ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Master Gangsheets (Fragments) */}
          {(po.fragments ?? []).length > 0 && (
            <div className="np-card">
              <div className="np-card-header">
                <h3>Master Gangsheets (Fragments)</h3>
              </div>
              <div className="np-table-wrap" style={{ overflowX: 'auto' }}>
                <table className="np-table" style={{ minWidth: '700px' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th>Gangsheet No</th>
                      <th style={{ width: 130 }}>Order No Covers</th>
                      <th style={{ width: 120 }}>Gangsheet (W x L)</th>
                      <th style={{ width: 100 }}>Artworks (No)</th>
                      <th style={{ width: 80 }}>Qty</th>
                      <th style={{ width: 130 }}>Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(po.fragments ?? []).map((f, i) => (
                      <tr key={f.id} className="hover:bg-gray-50">
                        <td className="np-od-num">{i + 1}</td>
                        <td style={{ padding: '8px', fontSize: '13px', fontWeight: 600 }}>{f.fragment_no}</td>
                        <td style={{ padding: '8px', fontSize: '12px', color: '#374151' }}>{f.covers_order_number ?? '-'}</td>
                        <td style={{ padding: '8px', textAlign: 'center', fontSize: '12px' }}>
                          {f.width_inches != null && f.length_inches != null
                            ? `${f.width_inches}" x ${f.length_inches}"` : '-'}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center', fontSize: '13px' }}>{f.artworks_count}</td>
                        <td style={{ padding: '8px', textAlign: 'center', fontSize: '13px' }}>{f.qty}</td>
                        <td style={{ padding: '8px' }}>
                          {f.file_url
                            ? <a href={f.file_url} target="_blank" rel="noreferrer" style={{ color: '#0d9488', fontWeight: 600, fontSize: '12px' }}>View Gangsheet</a>
                            : <span style={{ color: '#9ca3af', fontSize: '12px' }}>-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Attached Artworks */}
          {(po.artworks ?? []).length > 0 && (
            <div className="np-card">
              <div className="np-card-header">
                <h3>Artwork Attachments ({(po.artworks ?? []).length})</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0 18px' }}>
                {(po.artworks ?? []).map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 4px', borderBottom: '1px solid #f3f4f6', fontSize: '12.5px' }}>
                    <span style={{ fontWeight: 600, minWidth: '74px' }}>{a.artwork_no}</span>
                    {(a.thumbnail_url || a.file_url) && (a.thumbnail_url || a.file_url)!.match(/\.(png|jpe?g|webp|svg|gif)(\?|$)/i)
                      ? <img src={a.thumbnail_url || a.file_url!} alt={a.artwork_no} style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4, border: '1px solid #e5e7eb' }} />
                      : <span style={{ width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', borderRadius: 4, border: '1px dashed #d1d5db', color: '#9ca3af', fontSize: 10 }}>{(a.file_type || 'file').toUpperCase()}</span>}
                    {a.file_url
                      ? <a href={a.file_url} target="_blank" rel="noreferrer" style={{ color: '#0d9488', fontWeight: 600, flex: 1 }}>View / Download</a>
                      : <span style={{ flex: 1, color: '#9ca3af' }}>no file</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes & T&C */}
          {(po.notes || po.terms_conditions) && (
            <div className="np-card">
              <div className="np-card-header">
                <h3>Notes &amp; Terms</h3>
              </div>
              {po.notes && (
                <div style={{ marginBottom: '12px' }}>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Notes</p>
                  <p style={{ fontSize: '13px', color: '#374151', whiteSpace: 'pre-line' }}>{po.notes}</p>
                </div>
              )}
              {po.terms_conditions && (
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Terms &amp; Conditions</p>
                  <p style={{ fontSize: '13px', color: '#374151', whiteSpace: 'pre-line' }}>{po.terms_conditions}</p>
                </div>
              )}
            </div>
          )}

          {(po.qa_notes ?? []).length > 0 && (
            <div className="np-card" style={{ borderLeft: '4px solid #f59e0b' }}>
              <div className="np-card-header">
                <AlertTriangle size={17} color="#d97706" />
                <h3>Import QA Notes ({po.qa_notes?.length})</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {po.qa_notes?.map(note => (
                  <div key={note.id} style={{ padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a' }}>
                    <strong style={{ display: 'block', fontSize: 12, color: '#92400e', marginBottom: 3 }}>{note.issue_type}</strong>
                    <span style={{ fontSize: 12.5, color: '#78350f', lineHeight: 1.5 }}>{note.details}</span>
                  </div>
                ))}
              </div>
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
              {isImportedDTF ? (
                <>
                  <SummaryRow label="Payment Received" value={po.source_payment_status === 'Free/Reprint' ? 'Free / Reprint' : `${currency} ${fmo(po.payment_received)}`} />
                  <SummaryRow label="Shipping Collected" value={`${currency} ${fmo(po.shipping_charge)}`} />
                  <SummaryRow label="Net Product Amount" value={`${currency} ${fmo(po.net_product_amount)}`} />
                  <SummaryRow label="Payment Status" value={po.source_payment_status || '-'} />
                  <div style={{ borderTop: '2px solid #0d9488', paddingTop: 10, marginTop: 4 }}>
                    <SummaryRow label="Imported Source Total" value={po.source_payment_status === 'Free/Reprint' ? 'Free' : `${currency} ${fmo(po.payment_received)}`} />
                  </div>
                </>
              ) : (
                <>
              <SummaryRow label="Subtotal"        value={`${currency} ${fmo(po.subtotal ?? null)}`} />
              <SummaryRow label="Total Discount"  value={`- ${currency} ${fmo(po.total_discount ?? null)}`} dimmed />
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
                </>
              )}
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
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '380px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Change Status</h3>
            {user?.role === 'Admin' && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
                <AlertTriangle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
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
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '380px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
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

function DetailRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <p style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1px' }}>{label}</p>
      <p style={{ fontSize: '13px', color: '#111827', whiteSpace: multiline ? 'pre-line' : undefined }}>{value}</p>
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




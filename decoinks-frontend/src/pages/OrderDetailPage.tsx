import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import {
  ArrowLeft, Calendar, ChevronDown, DollarSign,
  FileText, Package, ShoppingCart, Truck, User, Send, MoreHorizontal, AlertTriangle,
} from 'lucide-react'
import ArtworkUploader from '../components/ArtworkUploader'
import { Menu, MenuItem } from '@mui/material'
import { api } from '../services/api'
import { cn } from '../utils/cn'
import { useAuthStore } from '../store/authStore'
import { getValidTransitions, type UserRole } from '../utils/statusTransitions'

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface Order {
  id: string
  order_number: string
  status: string
  payment_status: string
  payment_method: string | null
  payment_terms: string | null
  order_type: string
  order_date: string
  due_date: string | null
  total: number
  subtotal: number
  discount_pct: number
  discount_amt: number
  tax_pct: number
  tax_amt: number
  rush_services: number
  shipping_charges: number
  notes: string | null
  supplier_id: string | null
  supplier_name: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  shipping_name: string | null
  shipping_address: string | null
  agent_name: string | null
  items: any[]
}

// â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const PAYMENT_STATUSES = ['Unpaid', 'Partial', 'Paid', 'Refunded']

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Draft:          { bg: '#f1f5f9', color: '#475569' },
  Confirmed:      { bg: '#f0fdf4', color: '#16a34a' },
  'In Production':{ bg: '#eff6ff', color: '#2563eb' },
  'Ready to Ship':{ bg: '#fefce8', color: '#ca8a04' },
  Shipped:        { bg: '#fff7ed', color: '#ea580c' },
  Delivered:      { bg: '#f0fdf4', color: '#15803d' },
  Cancelled:      { bg: '#fef2f2', color: '#dc2626' },
}

const PAYMENT_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Unpaid:   { bg: '#fef2f2', color: '#dc2626' },
  Partial:  { bg: '#fef9c3', color: '#ca8a04' },
  Paid:     { bg: '#f0fdf4', color: '#16a34a' },
  Refunded: { bg: '#f5f3ff', color: '#7c3aed' },
}

const fmt = (n: any) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '-'

// â”€â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null)
  const [payAnchor, setPayAnchor] = useState<HTMLElement | null>(null)
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  // Admin force-change confirmation: holds the target status until Admin confirms
  const [pendingStatus, setPendingStatus] = useState<string | null>(null)

  const { data: order, isLoading, error } = useQuery<Order>({
    queryKey: ['order', id],
    queryFn: () => api.get(`/orders/${id}`).then(r => r.data.data),
    enabled: !!id,
  })

  const updateStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/orders/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status updated')
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err) => toast.apiError(err),
  })

  const updatePayStatus = useMutation({
    mutationFn: (payment_status: string) => api.put(`/orders/${id}`, { payment_status }),
    onSuccess: () => {
      toast.success('Payment status updated')
      queryClient.invalidateQueries({ queryKey: ['order', id] })
    },
    onError: () => toast.error('Failed to update payment status'),
  })

  const { data: portalStatus, refetch: refetchPortalStatus } = useQuery({
    queryKey: ['portal-status', id],
    queryFn: () => api.get(`/orders/${id}/portal-status`).then(r => r.data),
    enabled: !!id,
  })

  const convertToPOMutation = useMutation({
    mutationFn: () => api.post(`/orders/${id}/convert-to-po`),
    onSuccess: (res: any) => {
      const po = res.data?.data
      toast.success(`Purchase Order ${po?.po_number ?? ''} created`)
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      setMoreAnchor(null)
      if (po?.id) navigate(`/purchase-orders/${po.id}`)
    },
    onError: (err: any) => {
      setMoreAnchor(null)
      toast.error(err.response?.data?.message ?? 'Could not create Purchase Order')
    },
  })

  const handleSendToPortal = async () => {
    setMoreAnchor(null)
    try {
      await api.post(`/orders/${id}/send-to-portal`)
      toast.success('Order sent to supplier portal successfully')
      refetchPortalStatus()
    } catch {
      toast.error('Failed. Ensure supplier has portal access enabled.')
    }
  }

  if (isLoading) return (
    <div className="od-loading">
      <Package size={32} className="od-load-icon" />
      <span>Loading order...</span>
    </div>
  )

  if (error || !order) return (
    <div className="od-loading">
      <span>Order not found.</span>
      <button className="od-back-btn" onClick={() => navigate('/orders')}>Go back</button>
    </div>
  )

  const sc = STATUS_COLORS[order.status] ?? { bg: '#f1f5f9', color: '#475569' }
  const pc = PAYMENT_STATUS_COLORS[order.payment_status] ?? { bg: '#f1f5f9', color: '#475569' }

  return (
    <div className="od-page">

      {/* â”€â”€ Header â”€â”€ */}
      <div className="od-header">
        <div className="od-header-left">
          <button className="od-back-btn" onClick={() => navigate('/orders')}>
            <ArrowLeft size={15} /> Orders
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 className="od-title">{order.order_number}</h2>
              {portalStatus?.sentToPortal && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: '#f0fdf4', color: '#16a34a',
                  border: '1px solid #bbf7d0', borderRadius: 999,
                  fontSize: 11, fontWeight: 600, padding: '2px 8px',
                }}>
                  <Send size={10} /> Sent to Portal
                </span>
              )}
            </div>
            <p className="od-subtitle">{fmtDate(order.order_date)} Â· {order.order_type}</p>
          </div>
        </div>

        <div className="od-header-right">
          {/* Order Status */}
          <button
            className="od-status-btn"
            style={{ background: sc.bg, color: sc.color, borderColor: `${sc.color}40` }}
            onClick={e => setStatusAnchor(e.currentTarget)}
          >
            {order.status}
            <ChevronDown size={13} />
          </button>

          {/* Payment Status */}
          <button
            className="od-status-btn"
            style={{ background: pc.bg, color: pc.color, borderColor: `${pc.color}40` }}
            onClick={e => setPayAnchor(e.currentTarget)}
          >
            {order.payment_status}
            <ChevronDown size={13} />
          </button>

          {/* Print Sales Order */}
          <button
            className="od-status-btn"
            style={{ background: '#1a2b5c', color: '#fff', borderColor: '#1a2b5c' }}
            onClick={() => window.open(`/orders/${order.id}/print`, '_blank')}
          >
            🖨️ Print Sales Order
          </button>

          {/* More Actions */}
          <button
            className="od-status-btn"
            style={{ background: '#f1f5f9', color: '#475569', borderColor: '#e2e8f0' }}
            onClick={e => setMoreAnchor(e.currentTarget)}
          >
            <MoreHorizontal size={14} />
            More Actions
            <ChevronDown size={13} />
          </button>
        </div>
      </div>

      {/* â”€â”€ Status menus â”€â”€ */}
      <Menu anchorEl={statusAnchor} open={Boolean(statusAnchor)} onClose={() => setStatusAnchor(null)}>
        {getValidTransitions('order', order.status, (user?.role as UserRole) ?? 'Viewer').map(s => (
          <MenuItem key={s} onClick={() => {
            setStatusAnchor(null)
            if (user?.role === 'Admin') {
              setPendingStatus(s)   // Admin must confirm before applying
            } else {
              updateStatus.mutate(s)
            }
          }}>
            {s}
          </MenuItem>
        ))}
      </Menu>

      {/* â”€â”€ Admin force-change confirmation â”€â”€ */}
      {pendingStatus && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60,
        }}>
          <div style={{ background: 'white', borderRadius: 12, padding: 24, width: 380, boxShadow: '0 20px 40px rgba(0,0,0,0.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <AlertTriangle size={20} color="#f59e0b" />
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Force Status Change</h3>
            </div>
            <p style={{ fontSize: 13, color: '#475569', marginBottom: 16 }}>
              You are changing order status to <strong>{pendingStatus}</strong> as Admin, overriding normal role restrictions. This action will be logged.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="lb-action-btn" onClick={() => setPendingStatus(null)}>Cancel</button>
              <button className="lb-action-btn lb-action-primary" onClick={() => { updateStatus.mutate(pendingStatus); setPendingStatus(null) }}>
                Confirm Change
              </button>
            </div>
          </div>
        </div>
      )}

      <Menu anchorEl={payAnchor} open={Boolean(payAnchor)} onClose={() => setPayAnchor(null)}>
        {PAYMENT_STATUSES.map(s => (
          <MenuItem key={s} selected={order.payment_status === s} onClick={() => { setPayAnchor(null); updatePayStatus.mutate(s) }}>
            {s}
          </MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        <MenuItem onClick={() => convertToPOMutation.mutate()} disabled={convertToPOMutation.isPending}>
          <ShoppingCart size={14} style={{ marginRight: 8, color: '#0d9488' }} />
          {convertToPOMutation.isPending ? 'Creating PO...' : 'Convert to Purchase Order'}
        </MenuItem>
        <MenuItem onClick={handleSendToPortal} disabled={!order.supplier_id}>
          <Send size={14} style={{ marginRight: 8, color: '#2563EB' }} />
          Send to Supplier Portal
        </MenuItem>
      </Menu>

      {/* â”€â”€ Body â”€â”€ */}
      <div className="od-body">

        {/* LEFT: Items + Notes */}
        <div className="od-main">

          {/* Items table */}
          <div className="od-card">
            <h3 className="od-section-title">
              <FileText size={15} /> Order Items
            </h3>
            <div className="od-table-wrap">
              <table className="od-table">
                <thead>
                  <tr>
                    <th>#</th>
                    {order.order_type === 'apparel' && <>
                      <th>Item</th><th>Color</th><th>Size</th><th>Qty</th><th>Unit Price</th><th>Amount</th>
                    </>}
                    {order.order_type === 'gangsheet' && <>
                      <th>Size</th><th>Artworks</th><th>Qty</th><th>Price/Sheet</th><th>Amount</th>
                    </>}
                    {order.order_type === 'dtf' && <>
                      <th>Artwork Name</th><th>Size</th><th>Qty</th><th>Unit Price</th><th>Amount</th>
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {(order.items ?? []).map((item: any, i: number) => (
                    <tr key={item.id ?? i}>
                      <td className="od-td-num">{i + 1}</td>
                      {order.order_type === 'apparel' && <>
                        <td>{item.item}</td>
                        <td>{item.color ?? '-'}</td>
                        <td>{item.size ?? '-'}</td>
                        <td>{item.qty}</td>
                        <td>${fmt(item.unit_price)}</td>
                        <td className="od-td-amount">${fmt(item.amount)}</td>
                      </>}
                      {order.order_type === 'gangsheet' && <>
                        <td>{item.size}</td>
                        <td>{item.no_artworks}</td>
                        <td>{item.qty}</td>
                        <td>${fmt(item.price_per_sheet)}</td>
                        <td className="od-td-amount">${fmt(item.amount)}</td>
                      </>}
                      {order.order_type === 'dtf' && <>
                        <td>{item.artwork_name}</td>
                        <td>{item.size ?? '-'}</td>
                        <td>{item.qty}</td>
                        <td>${fmt(item.unit_price)}</td>
                        <td className="od-td-amount">${fmt(item.amount)}</td>
                      </>}
                    </tr>
                  ))}
                  {(!order.items || order.items.length === 0) && (
                    <tr><td colSpan={7} className="od-empty-row">No items</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Artwork upload + gangsheet */}
          <ArtworkUploader orderId={order.id} />

          {/* Notes */}
          {order.notes && (
            <div className="od-card od-notes-card">
              <h3 className="od-section-title"><FileText size={15} /> Order Notes</h3>
              <p className="od-notes-text">{order.notes}</p>
            </div>
          )}
        </div>

        {/* RIGHT sidebar */}
        <div className="od-sidebar">

          {/* Price Summary */}
          <div className="od-card">
            <h3 className="od-section-title"><DollarSign size={15} /> Price Summary</h3>
            <div className="od-price-row"><span>Items Total</span><span>${fmt(order.subtotal - (order.rush_services ?? 0) - (order.shipping_charges ?? 0))}</span></div>
            {Number(order.rush_services) > 0 && <div className="od-price-row"><span>Rush Services</span><span>${fmt(order.rush_services)}</span></div>}
            {Number(order.shipping_charges) > 0 && <div className="od-price-row"><span>Shipping</span><span>${fmt(order.shipping_charges)}</span></div>}
            <div className="od-price-row od-price-sub"><span>Subtotal</span><span>${fmt(order.subtotal)}</span></div>
            {Number(order.discount_pct) > 0 && <div className="od-price-row od-price-discount"><span>Discount ({order.discount_pct}%)</span><span>-${fmt(order.discount_amt)}</span></div>}
            <div className="od-price-row"><span>Tax ({order.tax_pct}%)</span><span>${fmt(order.tax_amt)}</span></div>
            <div className="od-price-total"><span>Total</span><strong>${fmt(order.total)}</strong></div>
          </div>

          {/* Payment Info */}
          <div className="od-card">
            <h3 className="od-section-title"><DollarSign size={15} /> Payment</h3>
            <div className="od-info-row"><span>Terms</span><span>{order.payment_terms ?? '-'}</span></div>
            <div className="od-info-row"><span>Method</span><span className="od-capitalize">{order.payment_method ?? '-'}</span></div>
            <div className="od-info-row">
              <span>Status</span>
              <span className="od-pay-badge" style={{ background: pc.bg, color: pc.color }}>{order.payment_status}</span>
            </div>
          </div>

          {/* Contact */}
          <div className="od-card">
            <h3 className="od-section-title"><User size={15} /> Contact</h3>
            {order.contact_name || order.supplier_name ? (
              <>
                <p className="od-contact-name">{order.contact_name ?? order.supplier_name}</p>
                {order.contact_email && <p className="od-contact-line">{order.contact_email}</p>}
                {order.contact_phone && <p className="od-contact-line">{order.contact_phone}</p>}
              </>
            ) : <p className="od-contact-empty">No contact info</p>}
          </div>

          {/* Shipping */}
          {(order.shipping_name || order.shipping_address) && (
            <div className="od-card">
              <h3 className="od-section-title"><Truck size={15} /> Shipping Address</h3>
              {order.shipping_name && <p className="od-contact-name">{order.shipping_name}</p>}
              {order.shipping_address && <p className="od-contact-line" style={{ whiteSpace: 'pre-wrap' }}>{order.shipping_address}</p>}
            </div>
          )}

          {/* Due date */}
          <div className="od-card">
            <h3 className="od-section-title"><Calendar size={15} /> Dates</h3>
            <div className="od-info-row"><span>Order Date</span><span>{fmtDate(order.order_date)}</span></div>
            <div className="od-info-row"><span>Due Date</span><span>{fmtDate(order.due_date)}</span></div>
            {order.agent_name && <div className="od-info-row"><span>Sales Agent</span><span>{order.agent_name}</span></div>}
          </div>

        </div>
      </div>
    </div>
  )
}

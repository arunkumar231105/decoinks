import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Menu, MenuItem } from '@mui/material'
import {
  ArrowLeft, Box, CalendarDays, Check, ClipboardList, Eye, Factory, FileText,
  Image as ImageIcon, MoreHorizontal, Package, Printer, Send, ShoppingCart,
  Truck, User, Users, Wrench,
} from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'
import { cn } from '../utils/cn'

interface Order {
  id: string; order_number: string; status: string; order_type: 'apparel'|'dtf'|'gangsheet'
  order_date: string; due_date: string|null; required_ship_date?: string|null
  total: number; subtotal: number; rush_services: number; shipping_charges: number
  supplier_id: string|null; supplier_name: string|null; customer_name: string|null
  contact_name: string|null; contact_email: string|null; contact_phone: string|null
  shipping_name: string|null; shipping_address: string|null; agent_name: string|null
  invoice_id: string|null; invoice_number?: string|null; quote_id?: string|null; quote_number?: string|null
  notes: string|null; production_notes?: string|null; packing_instructions?: string|null
  shipping_instructions?: string|null; shipping_method?: string|null; courier?: string|null
  tracking_number?: string|null; production_priority?: string|null; production_method?: string|null
  production_facility?: string|null; assigned_team?: string|null; estimated_production_time?: string|null
  total_print_locations?: number; items: any[]; artworks?: any[]; purchase_orders?: any[]
  shipments?: any[]; activities?: any[]
}

const fmt = (value: unknown) => Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const date = (value?: string|null) => value ? new Date(value).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—'
const orderTypeName = (type: string) => type === 'dtf' ? 'DTF Transfers' : type === 'gangsheet' ? 'DTF Gangsheet' : 'Custom Printed Apparel'

const FLOW = [
  ['Sales Order', 'Confirmed'], ['Artwork', 'Approved'], ['Purchase Order', 'Created'],
  ['Printing', 'Not Started'], ['QC / QA', 'Not Started'], ['Packing', 'Not Started'], ['Shipment', 'Not Started'],
]

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement|null>(null)
  const [activeTab, setActiveTab] = useState('Production Information')

  const { data: order, isLoading } = useQuery<Order>({
    queryKey: ['order', id], queryFn: () => api.get(`/orders/${id}`).then(r => r.data.data), enabled: !!id,
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.patch(`/orders/${id}/status`, { status }),
    onSuccess: () => { toast.success('Order released to production'); queryClient.invalidateQueries({ queryKey: ['order', id] }) },
    onError: err => toast.apiError(err),
  })

  if (isLoading) return <div className="od-loading"><Package size={30} /> Loading Sales Order...</div>
  if (!order) return <div className="od-loading">Sales Order not found.</div>

  const items = order.items ?? []
  const artworks = order.artworks ?? []
  const pos = order.purchase_orders ?? []
  const shipments = order.shipments ?? []
  const totalQty = items.reduce((sum, item) => sum + Number(item.qty || 0), 0)
  const itemArtworkCount = items.reduce((sum, item) => sum + new Set([item.front_image, item.back_image, item.artwork_image].filter(Boolean)).size, 0)
  const totalArtwork = Math.max(artworks.length, itemArtworkCount)
  const requiredDate = order.required_ship_date || order.due_date
  const shipment = shipments[shipments.length - 1]
  const artworkApproved = artworks.length === 0 || artworks.every(a => ['Approved','Completed'].includes(a.status))
  const workflowDone = [true, artworkApproved, pos.length > 0, ['In Production','QC','Ready to Ship','Shipped','Delivered'].includes(order.status), ['Ready to Ship','Shipped','Delivered'].includes(order.status), ['Ready to Ship','Shipped','Delivered'].includes(order.status), shipments.length > 0]

  const release = () => {
    if (order.status === 'Draft') statusMutation.mutate('Confirmed')
    else if (order.status === 'Confirmed') statusMutation.mutate('In Production')
    else toast.info(`Order already ${order.status}`)
  }

  return (
    <div className="so-page">
      <header className="so-heading">
        <div><button className="so-back" onClick={() => navigate('/orders')}><ArrowLeft size={14}/> Orders</button><h1>{order.order_type === 'dtf' ? 'Sales Order – DTF Transfers' : 'Sales Order'}</h1><p>Manage production flow from sales to shipment.</p></div>
        <div className="so-actions">
          <button onClick={() => navigate(`/orders/${order.id}/print`)}><Eye size={14}/> Preview</button>
          <button onClick={() => navigate(`/orders/${order.id}/print`)}><Printer size={14}/> Print Work Order</button>
          <button onClick={() => toast.info('Task creation will use this Sales Order as its source')}><ClipboardList size={14}/> Create Tasks</button>
          <button onClick={e => setMoreAnchor(e.currentTarget)}><MoreHorizontal size={14}/> More Actions</button>
          <button className="so-primary" onClick={release} disabled={statusMutation.isPending}><Factory size={14}/> Release to Production</button>
        </div>
      </header>

      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        <MenuItem onClick={() => { setMoreAnchor(null); navigate('/orders/new', { state: { editOrderId: order.id } }) }}>Edit operational details</MenuItem>
        <MenuItem onClick={() => { setMoreAnchor(null); navigate('/purchase-orders/new', { state: { fromOrderId: order.id } }) }}>Generate Purchase Order</MenuItem>
        <MenuItem onClick={() => { setMoreAnchor(null); navigate(`/orders/${order.id}/print`) }}>Print Work Order</MenuItem>
      </Menu>

      <section className="so-meta-card">
        <div><small>Order #</small><strong>{order.order_number}</strong><span className="so-green-badge">{order.status}</span></div>
        <div><small>Quote</small>{order.quote_id ? <Link to={`/quotes/${order.quote_id}`}>{order.quote_number || 'View Quote'}</Link> : <strong>—</strong>}</div>
        <div><small>Invoice</small>{order.invoice_id ? <Link to={`/invoices/${order.invoice_id}`}>{order.invoice_number || 'View Invoice'}</Link> : <strong>—</strong>}</div>
        <div><small>Order Date</small><strong>{date(order.order_date)}</strong></div>
        <div><small>Required Ship Date</small><strong>{date(requiredDate)}</strong></div>
        <div><small>Customer</small><strong>{order.customer_name || order.contact_name || order.supplier_name || '—'}</strong></div>
        <div><small>Sales Agent</small><strong>{order.agent_name || '—'}</strong></div>
      </section>

      <div className="so-layout">
        <main className="so-main">
          <section className="so-card so-progress-card">
            <h3>Order Progress</h3>
            <div className="so-progress">
              {FLOW.map(([label, pending], index) => {
                const done = workflowDone[index]
                const state = index === 2 && pos.length ? pos[pos.length - 1].status : index === 6 && shipment ? shipment.status : done ? (index === 0 ? order.status : 'Completed') : pending
                return <div className={cn('so-step', done && 'so-step-done')} key={label}><span>{done ? <Check size={15}/> : index + 1}</span><strong>{label}</strong><small>{state}</small></div>
              })}
            </div>
          </section>

          <section className="so-contact-grid">
            <div className="so-card"><h3><User size={14}/> Customer & Contact</h3><strong>{order.customer_name || order.contact_name || order.supplier_name || '—'}</strong><p>{order.contact_name || ''}</p><a href={order.contact_email ? `mailto:${order.contact_email}` : undefined}>{order.contact_email || '—'}</a><p>{order.contact_phone || '—'}</p></div>
            <div className="so-card"><h3><Truck size={14}/> Shipping Address</h3><strong>{order.shipping_name || order.customer_name || '—'}</strong><p className="so-pre">{order.shipping_address || '—'}</p></div>
            <div className="so-card"><h3><Box size={14}/> Shipping Method</h3><strong>{order.shipping_method || 'Standard Shipping'}</strong><p>{order.courier || shipment?.carrier || 'Courier not assigned'}</p><p>{order.tracking_number || shipment?.tracking_number || 'Tracking will be updated'}</p></div>
            <div className="so-card"><h3><FileText size={14}/> Production Notes</h3><p className="so-pre">{order.production_notes || order.notes || 'No production notes.'}</p></div>
          </section>

          <section className="so-card so-items-card">
            <div className="so-section-head"><h3>{order.order_type === 'dtf' ? <><Wrench size={15}/> DTF Transfer Items</> : <><Package size={15}/> Order Items</>}</h3><span>Artwork is view-only on Sales Orders</span></div>
            <div className="so-table-wrap"><table className="so-table">
              <thead><tr><th>#</th>{order.order_type === 'apparel' ? <><th>Product</th><th>Color</th><th>Size</th><th>Qty</th><th>Artwork Location</th><th>Artwork</th><th>Unit Price</th><th>Amount</th><th>Prod. Status</th></> : order.order_type === 'dtf' ? <><th>Artwork Name / No.</th><th>Front Art</th><th>Back Art</th><th>Size</th><th>Qty</th><th>Unit Price</th><th>Amount</th><th>Prod. Status</th></> : <><th>Gangsheet Size</th><th>Artworks</th><th>Qty</th><th>Preview</th><th>Amount</th><th>Prod. Status</th></>}</tr></thead>
              <tbody>{items.map((item, index) => <tr key={item.id || index}>
                <td>{index + 1}</td>
                {order.order_type === 'apparel' && <>
                  <td><div className="so-product">{item.product_image ? <img src={item.product_image} alt=""/> : <Package size={22}/>}<div><strong>{item.item}</strong><small>{[item.brand,item.model,item.catalog_sku].filter(Boolean).join(' · ')}</small></div></div></td>
                  <td>{item.color || '—'}</td><td>{item.size || '—'}</td><td>{item.qty}</td><td>{item.artwork_no ? 'Front / Back' : '—'}</td>
                  <td><div className="so-art-pair">{[item.front_image,item.back_image].filter(Boolean).map((src:string,i:number)=><a href={src} target="_blank" rel="noreferrer" key={src}><img src={src} alt={i ? 'back' : 'front'}/></a>)}{!item.front_image && !item.back_image && <ImageIcon size={18}/>}</div></td>
                  <td>${fmt(item.unit_price)}</td><td><strong>${fmt(item.amount)}</strong></td><td><span className="so-status-pill">{item.production_status || 'Artwork Approved'}</span></td>
                </>}
                {order.order_type === 'dtf' && <>
                  <td><strong>{item.artwork_name}</strong><small className="so-block">{item.artwork_no || '—'}</small></td>
                  <td>{item.front_image || item.artwork_image ? <a href={item.front_image || item.artwork_image} target="_blank" rel="noreferrer"><img className="so-art" src={item.front_image || item.artwork_image} alt="front"/></a> : '—'}</td>
                  <td>{item.back_image ? <a href={item.back_image} target="_blank" rel="noreferrer"><img className="so-art" src={item.back_image} alt="back"/></a> : '—'}</td>
                  <td>{item.size || '—'}</td><td>{item.qty}</td><td>${fmt(item.unit_price)}</td><td><strong>${fmt(item.amount)}</strong></td><td><span className="so-status-pill">{item.production_status || 'Artwork Approved'}</span></td>
                </>}
                {order.order_type === 'gangsheet' && <><td>{item.size}</td><td>{item.no_artworks}</td><td>{item.qty}</td><td>{item.front_image ? <img className="so-art" src={item.front_image} alt="gangsheet"/> : '—'}</td><td><strong>${fmt(item.amount)}</strong></td><td><span className="so-status-pill">{item.production_status || 'Artwork Approved'}</span></td></>}
              </tr>)}</tbody>
            </table></div>
          </section>

          <section className="so-card so-tabs-card">
            <div className="so-tabs">{['Production Information','Artwork',`Purchase Orders (${pos.length})`,'Production Jobs','QC / QA','Packing','Shipments','Activity Timeline'].map(tab=><button className={cn(activeTab===tab&&'active')} onClick={()=>setActiveTab(tab)} key={tab}>{tab}</button>)}</div>
            {activeTab === 'Production Information' && <div className="so-production-grid"><div><small>Production Method</small><strong>{order.production_method || orderTypeName(order.order_type)}</strong></div><div><small>Print Facility</small><strong>{order.production_facility || 'Decoinks Production'}</strong></div><div><small>Assigned Team</small><strong>{order.assigned_team || (order.order_type === 'dtf' ? 'DTF Team' : 'Production Team')}</strong></div><div><small>Priority</small><strong>{order.production_priority || 'Normal'}</strong></div><div><small>Estimated Production Time</small><strong>{order.estimated_production_time || '1 - 2 Business Days'}</strong></div><div><small>Workflow</small><strong>{orderTypeName(order.order_type)} Workflow</strong></div><div><small>Packing Instructions</small><strong>{order.packing_instructions || '—'}</strong></div><div><small>Shipping Instructions</small><strong>{order.shipping_instructions || '—'}</strong></div></div>}
            {activeTab === 'Artwork' && <div className="so-gallery">{artworks.length ? artworks.map(a=><a href={a.file_url} target="_blank" rel="noreferrer" key={a.id}>{a.thumbnail_url || a.file_url ? <img src={a.thumbnail_url || a.file_url} alt={a.name}/> : <ImageIcon/>}<strong>{a.artwork_no}</strong><small>{a.status}</small></a>) : <p>No separate artwork records. Item artwork previews are shown above.</p>}</div>}
            {activeTab.startsWith('Purchase Orders') && <div className="so-list">{pos.length ? pos.map(po=><Link to={`/purchase-orders/${po.id}`} key={po.id}>{po.po_number}<span>{po.status}</span></Link>) : <button onClick={()=>navigate('/purchase-orders/new',{state:{fromOrderId:order.id}})}>Generate Purchase Order</button>}</div>}
            {activeTab === 'Shipments' && <div className="so-list">{shipments.length ? shipments.map(s=><div key={s.id}><strong>{s.shipment_number}</strong><span>{s.carrier || '—'} · {s.tracking_number || 'No tracking'} · {s.status}</span></div>) : <p>No shipment created yet.</p>}</div>}
            {activeTab === 'Activity Timeline' && <div className="so-list">{(order.activities || []).map((a,i)=><div key={i}><strong>{a.description}</strong><span>{date(a.created_at)}</span></div>)}</div>}
            {!['Production Information','Artwork','Shipments','Activity Timeline'].includes(activeTab) && !activeTab.startsWith('Purchase Orders') && <p className="so-empty">This stage will populate automatically when its workflow starts.</p>}
          </section>

          <section className="so-stats"><div><CalendarDays/><span>Total Pieces<strong>{totalQty} pcs</strong></span></div><div><Wrench/><span>Total Print Locations<strong>{order.total_print_locations || itemArtworkCount || '—'}</strong></span></div><div><ImageIcon/><span>Total Artwork<strong>{totalArtwork}</strong></span></div><div><Factory/><span>Estimated Production Time<strong>{order.estimated_production_time || '1 - 2 Days'}</strong></span></div><div><Truck/><span>Estimated Ship Date<strong>{date(requiredDate)}</strong></span></div></section>
        </main>

        <aside className="so-sidebar">
          <section className="so-card"><h3>Commercial Summary</h3><div className="so-kv"><span>Quote</span><strong>{order.quote_number || '—'}</strong></div><div className="so-kv"><span>Invoice</span><strong>{order.invoice_number || '—'}</strong></div><div className="so-kv"><span>Order Value</span><strong>${fmt(order.total)}</strong></div><div className="so-kv"><span>Rush Services</span><strong>${fmt(order.rush_services)}</strong></div><div className="so-kv"><span>Shipping Method</span><strong>{order.shipping_method || 'Standard'}</strong></div><div className="so-kv"><span>Required Ship Date</span><strong>{date(requiredDate)}</strong></div></section>
          <section className="so-card"><h3>Production Summary</h3><div className="so-kv"><span>Artwork Status</span><b className={artworkApproved?'ok':''}>{artworkApproved?'Approved':'Pending'}</b></div><div className="so-kv"><span>PO Status</span><b>{pos.length ? pos[pos.length-1].status : 'Not Created'}</b></div><div className="so-kv"><span>Production Status</span><b>{order.status}</b></div><div className="so-kv"><span>QC Status</span><b>{workflowDone[4]?'Completed':'Not Started'}</b></div><div className="so-kv"><span>Shipment Status</span><b>{shipment?.status || 'Not Started'}</b></div></section>
          <section className="so-card"><h3>Key Dates</h3><div className="so-kv"><span>Order Date</span><strong>{date(order.order_date)}</strong></div><div className="so-kv"><span>Artwork Approved</span><strong>{artworkApproved ? date(order.order_date) : '—'}</strong></div><div className="so-kv"><span>PO Created</span><strong>{pos.length ? date(pos[0].created_at) : '—'}</strong></div><div className="so-kv"><span>Required Ship Date</span><strong>{date(requiredDate)}</strong></div></section>
          <section className="so-card"><h3>Documents & Links</h3>{order.quote_id && <Link to={`/quotes/${order.quote_id}`}>View Quote ({order.quote_number})</Link>}{order.invoice_id && <Link to={`/invoices/${order.invoice_id}`}>View Invoice ({order.invoice_number})</Link>}{pos.map(po=><Link key={po.id} to={`/purchase-orders/${po.id}`}>View Purchase Order ({po.po_number})</Link>)}<button onClick={()=>navigate(`/orders/${order.id}/print`)}>Print Work Order</button></section>
        </aside>
      </div>

      <footer className="so-footer"><button onClick={()=>navigate('/orders/new',{state:{editOrderId:order.id}})}>Save Order</button><button onClick={()=>navigate(`/orders/${order.id}/print`)}><Eye size={14}/> Preview PDF</button><button onClick={()=>navigate(`/orders/${order.id}/print`)}><Printer size={14}/> Print Work Order</button><button className="so-primary" onClick={release}><Factory size={14}/> Release to Production</button></footer>
    </div>
  )
}

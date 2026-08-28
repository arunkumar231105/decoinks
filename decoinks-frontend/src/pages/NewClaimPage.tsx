import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays, CheckCircle2, ChevronDown, ExternalLink, Eye, FileText, Info,
  Loader2, Save, Send, Trash2, UploadCloud, X,
} from 'lucide-react'
import toast from '../utils/toast'
import '../styles/claims.css'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'

/**
 * New Claim / Refund.
 *
 * Two rules shape this screen. A customer may ask for more than one remedy at
 * once — part refunded and part replaced — so Preferred Resolution is a set of
 * checkboxes, not a single choice. And the internal review belongs to an admin:
 * everyone sees the panel, so anyone raising a claim knows what will be decided
 * and by whom, but only an admin can fill it in. The server refuses the rest.
 */

const CATEGORIES = ['Delayed Shipment', 'Damaged Product', 'Wrong Item', 'Missing Item',
                    'Print Quality', 'Short Shipment', 'Other']
const SUB_ISSUES: Record<string, string[]> = {
  'Delayed Shipment': ['Late Delivery', 'Lost in Transit', 'Held at Customs'],
  'Damaged Product':  ['Damaged Box', 'Damaged Garment', 'Peeling Transfer', 'Water Damage'],
  'Wrong Item':       ['Wrong Size', 'Wrong Colour', 'Wrong Artwork', 'Wrong Style'],
  'Missing Item':     ['Partial Shipment', 'Missing Artwork', 'Missing Accessory'],
  'Print Quality':    ['Colour Mismatch', 'Dull Colours', 'Misaligned Print', 'Cracking'],
  'Short Shipment':   ['Short Quantity'],
  Other:              ['Other'],
}
const REPORTED_VIA = ['Email', 'WhatsApp', 'Phone', 'Portal', 'In Person']
const RESOLUTIONS = ['Full Refund', 'Partial Refund', 'Replacement', 'Credit Note']
const STATUSES = ['Draft', 'Raised', 'Under Review', 'Need More Info', 'Approved', 'Rejected', 'Refunded', 'Closed']
const TIMELINE = ['Raised', 'Under Review', 'Need More Info', 'Approved', 'Refunded', 'Closed']

const money = (v: any) => v == null || v === ''
  ? '—'
  : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const stamp = (v?: string | null) => v
  ? new Date(v).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric',
                                          hour: '2-digit', minute: '2-digit' })
  : '-'
const sizeLabel = (n?: number | null) =>
  !n ? '' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`

type Attachment = {
  id?: string; file_name: string; file_url: string
  file_type?: string; mime_type?: string; file_size?: number
}

export function NewClaimPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { id: claimId } = useParams()
  const editing = Boolean(claimId)
  const isAdmin = useAuthStore(s => s.user?.role) === 'Admin'
  const fileInput = useRef<HTMLInputElement>(null)

  // ── Section 1 ──
  const [customerId, setCustomerId] = useState('')
  const [orderId, setOrderId] = useState('')
  // A sales order can have several POs and several parcels, so which one the
  // complaint is about has to be said, not guessed.
  const [poId, setPoId] = useState('')
  const [shipmentId, setShipmentId] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)

  // ── Section 2 ──
  const [category, setCategory] = useState(CATEGORIES[0])
  const [subIssue, setSubIssue] = useState(SUB_ISSUES[CATEGORIES[0]][0])
  const [quantity, setQuantity] = useState('')
  const [claimedAmount, setClaimedAmount] = useState('')
  const [reportedVia, setReportedVia] = useState(REPORTED_VIA[0])
  const [description, setDescription] = useState('')

  // ── Section 3 ──
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)

  // ── Section 4 — a set, because more than one remedy can be asked for ──
  const [resolutions, setResolutions] = useState<string[]>([])
  const [requestedAmount, setRequestedAmount] = useState('')
  const [urgencyDate, setUrgencyDate] = useState('')
  const [customerComments, setCustomerComments] = useState('')

  // ── Section 5 — admin only ──
  const [reviewNotes, setReviewNotes] = useState('')
  const [decision, setDecision] = useState('')
  const [approvedAmount, setApprovedAmount] = useState('')
  const [resolutionType, setResolutionType] = useState('')
  const [status, setStatus] = useState('Raised')

  const customers = useQuery({
    queryKey: ['claim-customers'],
    queryFn: () => api.get('/customers', { params: { page: 1, limit: 1000 } })
      .then(r => r.data.data?.rows ?? []),
  })

  // The orders of the chosen customer, and only those.
  const orders = useQuery({
    queryKey: ['claim-customer-orders', customerId],
    queryFn: () => api.get(`/claims/customer/${customerId}/orders`).then(r => r.data.data ?? []),
    enabled: Boolean(customerId),
  })

  // The procurement and shipping side of the chosen order.
  const chain = useQuery({
    queryKey: ['claim-order-chain', orderId],
    queryFn: () => api.get(`/claims/order/${orderId}/chain`).then(r => r.data.data),
    enabled: Boolean(orderId),
  })

  useEffect(() => {
    if (!chain.data) return
    // One of a kind needs no choosing; more than one, and the field stays empty
    // until someone picks.
    if (!poId && chain.data.purchase_orders?.length === 1) setPoId(chain.data.purchase_orders[0].id)
    if (!shipmentId && chain.data.shipments?.length === 1) setShipmentId(chain.data.shipments[0].id)
  }, [chain.data])

  const orderDetails = useQuery({
    queryKey: ['claim-order-details', orderId],
    queryFn: () => api.get(`/claims/order/${orderId}/details`).then(r => r.data.data),
    enabled: Boolean(orderId),
  })

  const existing = useQuery({
    queryKey: ['claim', claimId],
    queryFn: () => api.get(`/claims/${claimId}`).then(r => r.data.data),
    enabled: editing,
  })

  useEffect(() => {
    const c = existing.data
    if (!c) return
    setCustomerId(c.customer_id ?? ''); setOrderId(c.order_id ?? '')
    setPoId(c.purchase_order_id ?? ''); setShipmentId(c.shipment_id ?? '')
    setCategory(c.claim_category ?? CATEGORIES[0]); setSubIssue(c.sub_issue ?? '')
    setQuantity(c.quantity_affected ?? ''); setClaimedAmount(c.claimed_amount ?? '')
    setReportedVia(c.reported_via ?? REPORTED_VIA[0]); setDescription(c.description ?? '')
    setResolutions(c.preferred_resolution ?? []); setRequestedAmount(c.requested_amount ?? '')
    setUrgencyDate(c.urgency_by_date ? String(c.urgency_by_date).slice(0, 10) : '')
    setCustomerComments(c.customer_comments ?? ''); setReviewNotes(c.review_notes ?? '')
    setDecision(c.decision === 'Pending' ? '' : c.decision ?? '')
    setApprovedAmount(c.approved_amount ?? ''); setResolutionType(c.resolution_type ?? '')
    setStatus(c.status ?? 'Raised'); setAttachments(c.attachments ?? [])
  }, [existing.data])

  const order = useMemo(
    () => (orders.data ?? []).find((o: any) => o.id === orderId),
    [orders.data, orderId])
  const customer = useMemo(
    () => (customers.data ?? []).find((c: any) => c.id === customerId),
    [customers.data, customerId])

  const toggleResolution = (r: string) =>
    setResolutions(cur => cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r])

  async function uploadFiles(files: FileList | File[]) {
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        const { data } = await api.post('/upload/claim-file', form)
        setAttachments(cur => [...cur, {
          file_name: data.file_name, file_url: data.url, file_type: data.file_type,
          mime_type: data.mime_type, file_size: data.file_size,
        }])
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not upload that file')
    } finally { setUploading(false) }
  }

  const body = () => ({
    customer_id: customerId, order_id: orderId,
    purchase_order_id: poId || null, shipment_id: shipmentId || null,
    claim_category: category, sub_issue: subIssue || null,
    quantity_affected: quantity === '' ? null : Number(quantity),
    claimed_amount: claimedAmount === '' ? null : Number(claimedAmount),
    reported_via: reportedVia, description,
    preferred_resolution: resolutions,
    requested_amount: requestedAmount === '' ? null : Number(requestedAmount),
    urgency_by_date: urgencyDate || null,
    customer_comments: customerComments || null,
    attachments,
  })

  const save = useMutation({
    mutationFn: (asDraft: boolean) => {
      const payload = { ...body(), status: asDraft ? 'Draft' : 'Raised' }
      return editing ? api.put(`/claims/${claimId}`, payload) : api.post('/claims', payload)
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['claims'] })
      toast.success(`Claim ${res.data.data?.claim_number ?? ''} saved`)
      nav('/claims')
    },
    onError: (err: any) => {
      const d = err?.response?.data
      toast.error(d?.details?.[0]?.message ?? d?.message ?? 'Could not save the claim')
    },
  })

  const submitReview = useMutation({
    mutationFn: () => api.post(`/claims/${claimId}/review`, {
      decision, review_notes: reviewNotes || null,
      resolution_type: resolutionType || null,
      approved_amount: approvedAmount === '' ? null : Number(approvedAmount),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim', claimId] })
      toast.success('Decision recorded')
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'Could not record the decision'),
  })

  const check = () => {
    if (!customerId) return 'Choose the customer'
    if (!orderId) return 'Choose the sales order'
    if (!category) return 'Choose the claim category'
    if (!description.trim()) return 'Describe the issue'
    return null
  }
  const handleSave = (asDraft: boolean) => {
    const problem = check()
    if (problem) { toast.error(problem); return }
    save.mutate(asDraft)
  }

  const history: any[] = existing.data?.status_history ?? []
  const at = (s: string) => history.find(h => h.status === s)?.changed_at

  return (
    <div className="clm-page">
      <header className="clm-head">
        <div>
          <h1>{editing ? 'Claim / Refund' : 'New Claim / Refund'}</h1>
          <p className="clm-crumb">Claims <span>›</span> {editing
            ? existing.data?.claim_number ?? 'Claim'
            : 'New Claim (Sales Order)'}</p>
        </div>
        <div className="clm-head-actions">
          <button className="clm-btn" disabled={save.isPending} onClick={() => handleSave(true)}>
            <Save size={16}/> Save as Draft
          </button>
          <button className="clm-btn" onClick={() => nav('/claims')}>Cancel</button>
          <button className="clm-btn primary" disabled={save.isPending} onClick={() => handleSave(false)}>
            {save.isPending ? <Loader2 size={16} className="clm-spin"/> : <Send size={16}/>} Submit Claim
          </button>
        </div>
      </header>

      <div className="clm-body">
        <div className="clm-main">

          {/* ── 1. Select Sales Order ── */}
          <section className="clm-card">
            <h2><i>1.</i> Select Sales Order</h2>
            <div className="clm-row-3">
              <label className="clm-field">
                <span>Customer <b>*</b></span>
                <select value={customerId} onChange={e => { setCustomerId(e.target.value); setOrderId('') }}>
                  <option value="">— Select customer —</option>
                  {(customers.data ?? []).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.display_name ?? c.name}</option>
                  ))}
                </select>
                {customer && <small className="clm-sub">{customer.customer_number}</small>}
              </label>

              <label className="clm-field">
                <span>Sales Order <b>*</b></span>
                <select value={orderId} disabled={!customerId} onChange={e => setOrderId(e.target.value)}>
                  <option value="">{customerId
                    ? orders.isLoading ? 'Loading…' : `— ${(orders.data ?? []).length} orders —`
                    : 'Choose a customer first'}</option>
                  {(orders.data ?? []).map((o: any) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number} · {String(o.order_date).slice(0, 10)} · {money(o.total)}
                    </option>
                  ))}
                </select>
                {order && <small className="clm-sub">
                  Order Date: {String(order.order_date).slice(0, 10)} &nbsp; Order Value: <b>{money(order.total)}</b>
                </small>}
              </label>

              <div className="clm-field clm-field-btn">
                <button className="clm-btn ghost" disabled={!orderId} onClick={() => setPanelOpen(true)}>
                  <Eye size={15}/> View Order Details
                </button>
              </div>
            </div>

            {/* The rest of the chain. Left empty when the order has not reached
                that stage — a claim can be raised before anything ships. */}
            <div className="clm-row-2 clm-chain">
              <label className="clm-field">
                <span>Purchase Order</span>
                <select value={poId} disabled={!orderId} onChange={e => setPoId(e.target.value)}>
                  <option value="">{!orderId ? 'Choose a sales order first'
                    : (chain.data?.purchase_orders?.length ?? 0) === 0 ? 'No purchase order yet'
                    : '— Not specific to one PO —'}</option>
                  {(chain.data?.purchase_orders ?? []).map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.po_number} · {p.supplier_name ?? 'Supplier'} · {money(p.total)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="clm-field">
                <span>Shipment</span>
                <select value={shipmentId} disabled={!orderId} onChange={e => setShipmentId(e.target.value)}>
                  <option value="">{!orderId ? 'Choose a sales order first'
                    : (chain.data?.shipments?.length ?? 0) === 0 ? 'Nothing shipped yet'
                    : '— Not specific to one parcel —'}</option>
                  {(chain.data?.shipments ?? []).map((sh: any) => (
                    <option key={sh.id} value={sh.id}>
                      {sh.shipment_number ?? sh.tracking_number} · {sh.carrier ?? '—'} · {sh.status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <div className="clm-two">
            {/* ── 2. Issue Details ── */}
            <section className="clm-card">
              <h2><i>2.</i> Issue Details</h2>
              <div className="clm-row-2">
                <label className="clm-field">
                  <span>Claim Category <b>*</b></span>
                  <select value={category} onChange={e => {
                    setCategory(e.target.value); setSubIssue(SUB_ISSUES[e.target.value]?.[0] ?? '')
                  }}>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="clm-field">
                  <span>Sub Issue <b>*</b></span>
                  <select value={subIssue} onChange={e => setSubIssue(e.target.value)}>
                    {(SUB_ISSUES[category] ?? []).map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <div className="clm-row-3">
                <label className="clm-field">
                  <span>Quantity Affected <b>*</b></span>
                  <input type="number" min={0} value={quantity} placeholder="0"
                    onChange={e => setQuantity(e.target.value)} />
                </label>
                <label className="clm-field">
                  <span>Claimed Amount (USD) <b>*</b></span>
                  <input type="number" min={0} step="0.01" value={claimedAmount} placeholder="0.00"
                    onChange={e => setClaimedAmount(e.target.value)} />
                </label>
                <label className="clm-field">
                  <span>Reported Via <b>*</b></span>
                  <select value={reportedVia} onChange={e => setReportedVia(e.target.value)}>
                    {REPORTED_VIA.map(r => <option key={r}>{r}</option>)}
                  </select>
                </label>
              </div>
              <label className="clm-field">
                <span>Description <b>*</b></span>
                <textarea rows={4} maxLength={1000} value={description}
                  placeholder="What went wrong, in the customer's words…"
                  onChange={e => setDescription(e.target.value)} />
                <small className="clm-count">{description.length}/1000</small>
              </label>
            </section>

            {/* ── 3. Evidence ── */}
            <section className="clm-card">
              <h2><i>3.</i> Evidence / Attachments</h2>
              <div className={`clm-drop${dragging ? ' over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); uploadFiles(e.dataTransfer.files) }}
                onClick={() => fileInput.current?.click()}>
                {uploading ? <Loader2 size={26} className="clm-spin"/> : <UploadCloud size={26}/>}
                <p><b>Drag &amp; drop files here</b> or <span>click to upload</span></p>
                <small>JPG, PNG, PDF, MP4 up to 20MB each</small>
                <input ref={fileInput} hidden type="file" multiple
                  accept="image/*,application/pdf,video/*"
                  onChange={e => e.target.files && uploadFiles(e.target.files)} />
              </div>

              <div className="clm-files">
                {attachments.map((a, i) => (
                  <figure key={a.file_url + i}>
                    <button className="clm-file-x" title="Remove"
                      onClick={() => setAttachments(cur => cur.filter((_, n) => n !== i))}>
                      <X size={13}/>
                    </button>
                    {a.file_type === 'image'
                      ? <img src={a.file_url} alt={a.file_name} />
                      : a.file_type === 'video'
                        ? <video src={a.file_url} muted />
                        : <span className="clm-file-doc"><FileText size={26}/></span>}
                    <figcaption>{a.file_name}<small>{sizeLabel(a.file_size)}</small></figcaption>
                  </figure>
                ))}
              </div>
            </section>
          </div>

          {/* ── 4. Resolution Requested ── */}
          <section className="clm-card">
            <h2><i>4.</i> Resolution Requested</h2>
            <div className="clm-row-res">
              <div className="clm-field">
                <span>Preferred Resolution <b>*</b></span>
                {/* Checkboxes, not a single choice: part refunded and part
                    replaced is a real answer. */}
                <div className="clm-checks">
                  {RESOLUTIONS.map(r => (
                    <label key={r} className="clm-check">
                      <input type="checkbox" checked={resolutions.includes(r)}
                        onChange={() => toggleResolution(r)} />
                      <span>{r}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="clm-res-right">
                <div className="clm-row-2">
                  <label className="clm-field">
                    <span>Refund / Adjustment Amount (USD) <b>*</b></span>
                    <input type="number" min={0} step="0.01" value={requestedAmount}
                      placeholder="0.00" onChange={e => setRequestedAmount(e.target.value)} />
                  </label>
                  <label className="clm-field">
                    <span>Urgency / By Date</span>
                    <input type="date" value={urgencyDate} onChange={e => setUrgencyDate(e.target.value)} />
                  </label>
                </div>
                <label className="clm-field">
                  <span>Customer / Supplier Comments</span>
                  <textarea rows={3} maxLength={1000} value={customerComments}
                    onChange={e => setCustomerComments(e.target.value)} />
                  <small className="clm-count">{customerComments.length}/1000</small>
                </label>
              </div>
            </div>
          </section>

          {/* ── 5. Internal Review — admin only ── */}
          <section className={`clm-card${isAdmin ? '' : ' locked'}`}>
            <h2>
              <i>5.</i> Internal Review &amp; Approval (Admin)
              <span className="clm-lock-note" title="Only an admin can record this decision">
                <Info size={13}/> {isAdmin ? 'You can decide this claim' : 'Admin only — visible, not editable'}
              </span>
            </h2>
            <fieldset disabled={!isAdmin} className="clm-review">
              <div className="clm-row-2">
                <label className="clm-field">
                  <span>Review Notes</span>
                  <textarea rows={5} maxLength={1000} value={reviewNotes}
                    onChange={e => setReviewNotes(e.target.value)} />
                  <small className="clm-count">{reviewNotes.length}/1000</small>
                </label>
                <div>
                  <div className="clm-field">
                    <span>Decision <b>*</b></span>
                    <div className="clm-radios">
                      {['Approve', 'Reject', 'Need More Info'].map(d => (
                        <label key={d} className="clm-check">
                          <input type="radio" name="decision" checked={decision === d}
                            onChange={() => setDecision(d)} />
                          <span>{d}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="clm-row-2">
                    <label className="clm-field">
                      <span>Approved Refund Amount (USD)</span>
                      <input type="number" min={0} step="0.01" value={approvedAmount}
                        onChange={e => setApprovedAmount(e.target.value)} />
                    </label>
                    <label className="clm-field">
                      <span>Resolution Type</span>
                      <select value={resolutionType} onChange={e => setResolutionType(e.target.value)}>
                        <option value="">— Select —</option>
                        {RESOLUTIONS.map(r => <option key={r}>{r}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="clm-row-2">
                    <label className="clm-field">
                      <span>Responsible Admin</span>
                      <input readOnly value={existing.data?.responsible_admin_name
                        ?? useAuthStore.getState().user?.name ?? ''} />
                    </label>
                    <label className="clm-field">
                      <span>Approval Date</span>
                      <input readOnly value={existing.data?.approval_date
                        ? String(existing.data.approval_date).slice(0, 10) : ''} />
                    </label>
                  </div>
                  {isAdmin && editing && (
                    <button className="clm-btn primary clm-decide" disabled={!decision || submitReview.isPending}
                      onClick={() => submitReview.mutate()}>
                      <CheckCircle2 size={15}/> Record Decision
                    </button>
                  )}
                  {isAdmin && !editing && (
                    <p className="clm-hint">Save the claim first, then record the decision.</p>
                  )}
                </div>
              </div>
            </fieldset>
          </section>
        </div>

        {/* ── Right rail ── */}
        <aside className="clm-side">
          <section className="clm-card">
            <h3>Claim Summary</h3>
            <dl className="clm-summary">
              <dt>Claim ID</dt><dd>{existing.data?.claim_number ?? <i>(Auto Generate)</i>}</dd>
              <dt>Linked To</dt><dd><b>Sales Order</b></dd>
              <dt>Sales Order ID</dt>
              <dd>{order?.order_number ?? existing.data?.order_number ?? '—'}
                {orderId && <ExternalLink size={12} className="clm-ext" onClick={() => setPanelOpen(true)} />}</dd>
              <dt>Customer</dt>
              <dd>{customer?.display_name ?? customer?.name ?? existing.data?.customer_name ?? '—'}</dd>
              <dt>Purchase Order</dt>
              <dd>{(chain.data?.purchase_orders ?? []).find((p: any) => p.id === poId)?.po_number
                ?? existing.data?.po_number ?? '—'}</dd>
              <dt>Shipment</dt>
              <dd>{(() => {
                const sh = (chain.data?.shipments ?? []).find((x: any) => x.id === shipmentId)
                return sh?.shipment_number ?? sh?.tracking_number ?? existing.data?.shipment_number ?? '—'
              })()}</dd>
              <dt>Invoice</dt>
              <dd>{orderDetails.data?.invoice_number ?? existing.data?.invoice_number ?? '—'}</dd>
              <dt>Invoice Value</dt>
              <dd>{money(orderDetails.data?.invoice_total ?? existing.data?.invoice_total)}</dd>
              <dt>Claim Type</dt><dd>{category}</dd>
              <dt>Claimed Amount</dt><dd>{money(claimedAmount)}</dd>
            </dl>
            <div className="clm-proposed">
              <span>Proposed Refund</span>
              <strong>{money(requestedAmount)}</strong>
            </div>
          </section>

          <section className="clm-card">
            <h3>Claim Status</h3>
            <label className="clm-field">
              <span>Current Status</span>
              <select value={status} disabled={!isAdmin} onChange={e => setStatus(e.target.value)}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <ol className="clm-timeline">
              {TIMELINE.map(s => {
                const when = at(s)
                const current = status === s
                return (
                  <li key={s} className={when ? 'done' : current ? 'current' : ''}>
                    <span className="clm-dot" />
                    <span className="clm-tl-label">{s}</span>
                    <span className="clm-tl-time">{when ? stamp(when) : '-'}</span>
                  </li>
                )
              })}
            </ol>
          </section>
        </aside>
      </div>

      {/* ── Order details side panel ── */}
      {panelOpen && (
        <div className="clm-panel-wrap" onClick={() => setPanelOpen(false)}>
          <aside className="clm-panel" onClick={e => e.stopPropagation()}>
            <header>
              <div>
                <h3>{orderDetails.data?.order_number ?? 'Order'}</h3>
                <p>{orderDetails.data?.customer_name} · {orderDetails.data?.customer_number}</p>
              </div>
              <button onClick={() => setPanelOpen(false)}><X size={18}/></button>
            </header>
            {orderDetails.isLoading ? <p className="clm-panel-empty">Loading…</p> : (
              <>
                <dl className="clm-summary">
                  <dt>Order Date</dt><dd>{String(orderDetails.data?.order_date ?? '').slice(0, 10)}</dd>
                  <dt>Type</dt><dd>{orderDetails.data?.order_type}</dd>
                  <dt>Status</dt><dd>{orderDetails.data?.status}</dd>
                  <dt>Subtotal</dt><dd>{money(orderDetails.data?.subtotal)}</dd>
                  <dt>Shipping</dt><dd>{money(orderDetails.data?.shipping_charges)}</dd>
                  <dt>Total</dt><dd><b>{money(orderDetails.data?.total)}</b></dd>
                  <dt>Invoice</dt><dd>{orderDetails.data?.invoice_number ?? '—'}</dd>
                  <dt>Invoice Value</dt><dd>{money(orderDetails.data?.invoice_total)}</dd>
                  <dt>Balance Due</dt><dd>{money(orderDetails.data?.balance_due)}</dd>
                </dl>
                <h4>Lines</h4>
                <table className="clm-panel-table">
                  <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
                  <tbody>
                    {(orderDetails.data?.items ?? []).map((it: any) => (
                      <tr key={it.id}>
                        <td>{it.description || '—'}{it.size && <small> · {it.size}</small>}</td>
                        <td>{it.qty}</td>
                        <td>{money(it.unit_price)}</td>
                        <td>{money(it.amount)}</td>
                      </tr>
                    ))}
                    {!(orderDetails.data?.items ?? []).length &&
                      <tr><td colSpan={4} className="clm-panel-empty">No lines on this order.</td></tr>}
                  </tbody>
                </table>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

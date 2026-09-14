import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, ExternalLink, Eye, FileText, Info,
  Loader2, Save, Send, UploadCloud, X,
} from 'lucide-react'
import toast from '../utils/toast'
import '../styles/claims.css'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'

/**
 * New Claim / Refund.
 *
 * A claim is raised against a purchase order — the document the shop actually
 * works from. The sales order and invoice behind that PO are filled in by the
 * server, so they are shown here but never chosen.
 *
 * Two more rules shape this screen. A customer may ask for more than one remedy
 * at once — part refunded and part replaced — so Preferred Resolution is a set
 * of checkboxes, not a single choice. And the internal review belongs to an
 * admin: everyone sees the panel, so anyone raising a claim knows what will be
 * decided and by whom, but only an admin can fill it in. The server refuses the rest.
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
const MONEY_RESOLUTIONS = ['Full Refund', 'Partial Refund', 'Credit Note']
const STATUSES = ['Draft', 'Raised', 'Under Review', 'Need More Info', 'Approved', 'Rejected', 'Refunded', 'Closed']
const TIMELINE = ['Raised', 'Under Review', 'Need More Info', 'Approved', 'Refunded', 'Closed']

const money = (v: any) => v == null || v === ''
  ? '—'
  : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const stamp = (v?: string | null) => v
  ? new Date(v).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric',
                                          hour: '2-digit', minute: '2-digit' })
  : '-'
const day = (v: any) => (v ? String(v).slice(0, 10) : '—')
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
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'Admin'
  const fileInput = useRef<HTMLInputElement>(null)

  // ── Section 1 ──
  const [customerId, setCustomerId] = useState('')
  const [poId, setPoId] = useState('')
  // A PO can go out in several parcels, so which one the complaint is about has
  // to be said, not guessed.
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
  const [status, setStatus] = useState('Draft')

  const customers = useQuery({
    queryKey: ['claim-customers'],
    queryFn: () => api.get('/customers', { params: { page: 1, limit: 1000 } })
      .then(r => r.data.data?.rows ?? []),
  })

  // The purchase orders of the chosen customer, and only those.
  const purchaseOrders = useQuery({
    queryKey: ['claim-customer-pos', customerId],
    queryFn: () => api.get(`/claims/customer/${customerId}/purchase-orders`).then(r => r.data.data ?? []),
    enabled: Boolean(customerId),
  })

  // The sales order, invoice and parcels behind the chosen PO.
  const chain = useQuery({
    queryKey: ['claim-po-chain', poId],
    queryFn: () => api.get(`/claims/purchase-order/${poId}/chain`).then(r => r.data.data),
    enabled: Boolean(poId),
  })
  const po = chain.data?.purchase_order
  const shipments: any[] = chain.data?.shipments ?? []
  const orderId: string = po?.order_id ?? ''

  useEffect(() => {
    // One parcel needs no choosing; more than one, and the field stays empty
    // until someone picks.
    if (!shipmentId && shipments.length === 1) setShipmentId(shipments[0].id)
  }, [chain.data])

  const orderDetails = useQuery({
    queryKey: ['claim-order-details', orderId],
    queryFn: () => api.get(`/claims/order/${orderId}/details`).then(r => r.data.data),
    enabled: Boolean(orderId) && panelOpen,
  })

  const existing = useQuery({
    queryKey: ['claim', claimId],
    queryFn: () => api.get(`/claims/${claimId}`).then(r => r.data.data),
    enabled: editing,
  })

  useEffect(() => {
    const c = existing.data
    if (!c) return
    setCustomerId(c.customer_id ?? '')
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

  const customer = useMemo(
    () => (customers.data ?? []).find((c: any) => c.id === customerId),
    [customers.data, customerId])
  const shipment = shipments.find((s: any) => s.id === shipmentId)

  // A draft is still the author's to submit; once raised, the claim moves only
  // by decision, and its status is the admin's to change.
  const isDraft = !editing || existing.data?.status === 'Draft'

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
      toast.error(e?.response?.data?.error ?? e?.response?.data?.message ?? 'Could not upload that file')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const body = () => ({
    customer_id: customerId,
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
      const payload: Record<string, any> = body()
      if (isDraft) payload.status = asDraft ? 'Draft' : 'Raised'
      else if (isAdmin && status !== existing.data?.status) payload.status = status
      return editing ? api.put(`/claims/${claimId}`, payload) : api.post('/claims', payload)
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['claims'] })
      qc.invalidateQueries({ queryKey: ['claim', claimId] })
      toast.success(`Claim ${res.data.data?.claim_number ?? ''} saved`)
      nav('/claims')
    },
    onError: (err: any) => {
      const d = err?.response?.data
      toast.error(d?.details?.[0]?.message ?? d?.message ?? d?.error ?? 'Could not save the claim')
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
      qc.invalidateQueries({ queryKey: ['claims'] })
      toast.success('Decision recorded')
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'Could not record the decision'),
  })

  // A draft may be half-filled; a submitted claim carries everything marked *.
  const check = (asDraft: boolean) => {
    if (!customerId) return 'Choose the customer'
    if (!poId) return 'Choose the purchase order'
    if (!category) return 'Choose the claim category'
    if (!description.trim()) return 'Describe the issue'
    if (asDraft) return null
    if (!subIssue) return 'Choose the sub issue'
    if (quantity === '') return 'Enter the quantity affected'
    if (claimedAmount === '') return 'Enter the claimed amount'
    if (!resolutions.length) return 'Choose at least one preferred resolution'
    if (requestedAmount === '' && resolutions.some(r => MONEY_RESOLUTIONS.includes(r))) {
      return 'Enter the refund / adjustment amount'
    }
    return null
  }
  const handleSave = (asDraft: boolean) => {
    const problem = check(asDraft)
    if (problem) { toast.error(problem); return }
    save.mutate(asDraft)
  }

  const history: any[] = existing.data?.status_history ?? []
  const at = (s: string) => [...history].reverse().find(h => h.status === s)?.changed_at

  const poLabel = (p: any) =>
    `${p.po_number} · ${day(p.order_date)} · ${p.supplier_name ?? 'Supplier'} · ${money(p.total)}`

  return (
    <div className="clm-page">
      <header className="clm-head">
        <div>
          <h1>{editing ? 'Claim / Refund' : 'New Claim / Refund'}</h1>
          <p className="clm-crumb">Claims <span>›</span> {editing
            ? existing.data?.claim_number ?? 'Claim'
            : 'New Claim (Purchase Order)'}</p>
        </div>
        <div className="clm-head-actions">
          {isDraft && (
            <button className="clm-btn" disabled={save.isPending} onClick={() => handleSave(true)}>
              <Save size={16}/> Save as Draft
            </button>
          )}
          <button className="clm-btn" onClick={() => nav('/claims')}>Cancel</button>
          <button className="clm-btn primary" disabled={save.isPending} onClick={() => handleSave(false)}>
            {save.isPending ? <Loader2 size={16} className="clm-spin"/> : <Send size={16}/>}
            {isDraft ? ' Submit Claim' : ' Save Changes'}
          </button>
        </div>
      </header>

      <div className="clm-body">
        <div className="clm-main">

          {/* ── 1. Select Purchase Order ── */}
          <section className="clm-card">
            <h2><i>1.</i> Select Purchase Order</h2>
            <div className="clm-row-3">
              <label className="clm-field">
                <span>Customer <b>*</b></span>
                <select value={customerId} onChange={e => {
                  setCustomerId(e.target.value); setPoId(''); setShipmentId('')
                }}>
                  <option value="">— Select customer —</option>
                  {(customers.data ?? []).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.display_name ?? c.name}</option>
                  ))}
                </select>
                {customer && <small className="clm-sub">{customer.customer_number}</small>}
              </label>

              <label className="clm-field">
                <span>Purchase Order <b>*</b></span>
                <select value={poId} disabled={!customerId} onChange={e => {
                  setPoId(e.target.value); setShipmentId('')
                }}>
                  <option value="">{!customerId ? 'Choose a customer first'
                    : purchaseOrders.isLoading ? 'Loading…'
                    : (purchaseOrders.data ?? []).length === 0 ? 'No purchase orders for this customer'
                    : `— ${(purchaseOrders.data ?? []).length} purchase orders —`}</option>
                  {(purchaseOrders.data ?? []).map((p: any) => (
                    <option key={p.id} value={p.id}>{poLabel(p)}</option>
                  ))}
                  {/* An old claim may point at a PO this list no longer offers. */}
                  {poId && po && !(purchaseOrders.data ?? []).some((p: any) => p.id === poId) && (
                    <option value={poId}>{poLabel(po)}</option>
                  )}
                </select>
                {po && <small className="clm-sub">
                  PO Date: {day(po.order_date)} &nbsp; Status: {po.status} &nbsp; PO Value: <b>{money(po.total)}</b>
                </small>}
              </label>

              <div className="clm-field clm-field-btn">
                <button className="clm-btn ghost" disabled={!poId} onClick={() => setPanelOpen(true)}>
                  <Eye size={15}/> View PO Details
                </button>
              </div>
            </div>

            {/* The rest of the chain. The sales order is read off the PO; the
                parcel is left empty when nothing has shipped yet. */}
            <div className="clm-row-2 clm-chain">
              <label className="clm-field">
                <span>Sales Order (from PO)</span>
                <input readOnly value={!poId ? 'Choose a purchase order first'
                  : chain.isLoading ? 'Loading…'
                  : po?.order_number
                    ? `${po.order_number} · ${day(po.sales_order_date)} · ${money(po.order_total)}`
                    : 'No sales order linked'} />
              </label>
              <label className="clm-field">
                <span>Shipment</span>
                <select value={shipmentId} disabled={!poId} onChange={e => setShipmentId(e.target.value)}>
                  <option value="">{!poId ? 'Choose a purchase order first'
                    : shipments.length === 0 ? 'Nothing shipped yet'
                    : '— Not specific to one parcel —'}</option>
                  {shipments.map((sh: any) => (
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
                      <input readOnly value={existing.data?.responsible_admin_name ?? user?.name ?? ''} />
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
              <dt>Linked To</dt><dd><b>Purchase Order</b></dd>
              <dt>Purchase Order</dt>
              <dd>{po?.po_number ?? existing.data?.po_number ?? '—'}
                {poId && <ExternalLink size={12} className="clm-ext" onClick={() => setPanelOpen(true)} />}</dd>
              <dt>Supplier</dt>
              <dd>{po?.supplier_name ?? existing.data?.supplier_name ?? '—'}</dd>
              <dt>Customer</dt>
              <dd>{customer?.display_name ?? customer?.name ?? existing.data?.customer_name ?? '—'}</dd>
              <dt>Sales Order</dt>
              <dd>{po?.order_number ?? existing.data?.order_number ?? '—'}</dd>
              <dt>Shipment</dt>
              <dd>{shipment?.shipment_number ?? shipment?.tracking_number
                ?? (shipmentId ? existing.data?.shipment_number : null) ?? '—'}</dd>
              <dt>Invoice</dt>
              <dd>{po?.invoice_number ?? existing.data?.invoice_number ?? '—'}</dd>
              <dt>Invoice Value</dt>
              <dd>{money(po?.invoice_total ?? existing.data?.invoice_total)}</dd>
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
              {/* Moves by decision; an admin can still set it by hand, e.g. to Refunded or Closed. */}
              <select value={status} disabled={!isAdmin || isDraft} onChange={e => setStatus(e.target.value)}>
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

      {/* ── PO details side panel ── */}
      {panelOpen && (
        <div className="clm-panel-wrap" onClick={() => setPanelOpen(false)}>
          <aside className="clm-panel" onClick={e => e.stopPropagation()}>
            <header>
              <div>
                <h3>{po?.po_number ?? 'Purchase Order'}</h3>
                <p>{customer?.display_name ?? customer?.name ?? existing.data?.customer_name}
                  {po?.supplier_name ? ` · ${po.supplier_name}` : ''}</p>
              </div>
              <button onClick={() => setPanelOpen(false)}><X size={18}/></button>
            </header>
            {chain.isLoading ? <p className="clm-panel-empty">Loading…</p> : (
              <>
                <dl className="clm-summary">
                  <dt>PO Date</dt><dd>{day(po?.order_date)}</dd>
                  <dt>PO Type</dt><dd>{po?.po_type ?? '—'}</dd>
                  <dt>PO Status</dt><dd>{po?.status ?? '—'}</dd>
                  <dt>PO Total</dt><dd><b>{money(po?.total)}</b></dd>
                  <dt>Sales Order</dt><dd>{po?.order_number ?? '—'}</dd>
                  <dt>Order Total</dt><dd>{money(orderDetails.data?.total ?? po?.order_total)}</dd>
                  <dt>Invoice</dt><dd>{po?.invoice_number ?? '—'}</dd>
                  <dt>Invoice Value</dt><dd>{money(po?.invoice_total)}</dd>
                  <dt>Balance Due</dt><dd>{money(po?.balance_due)}</dd>
                </dl>
                <h4>Lines</h4>
                {orderDetails.isLoading ? <p className="clm-panel-empty">Loading…</p> : (
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
                )}
                {poId && (
                  <button className="clm-btn ghost" onClick={() => nav(`/purchase-orders/${poId}`)}>
                    <ExternalLink size={14}/> Open purchase order
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronDown, Copy, Edit3, Eye, Package, Plus, Save, Send, Trash2, UserCheck, X, Check } from 'lucide-react'
import { Menu, MenuItem } from '@mui/material'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { useFormDraft } from '../hooks/useFormDraft'
import { DraftBanner } from '../components/DraftBanner'
import { useAuthStore } from '../store/authStore'
import { APPAREL_CATEGORIES, ApparelCatalogPicker, type ApparelCatalogStyle, type CatalogColor, type CatalogSize, type CatalogVariant } from '../components/ApparelCatalogPicker'

// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// Types
// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

type OrderType = 'apparel' | 'gangsheet' | 'dtf'
type PaymentStatus = 'Unpaid' | 'Partial' | 'Paid' | 'Refunded'

interface Customer {
  id: string; name: string; email?: string; phone?: string; company?: string; company_name?: string
  company_phone_number?: string; mobile_number?: string
  address_line1?: string; address_line2?: string; city?: string; state?: string; zip?: string; country?: string
  billing_address?: string; addresses?: Array<{ address_type?: string; line1?: string; line2?: string; city?: string; state?: string; zipcode?: string; country?: string; is_default?: boolean }>
}
interface Agent { id: string; name: string; role: string }

interface ApparelItem {
  id: string; category: string; item: string; color: string; size: string; qty: number
  artworkNo: string; artworkSize: string; unitPrice: number
  frontImage?: string | null; backImage?: string | null
  frontMockup?: string | null; backMockup?: string | null
  styleId?: string; styleCode?: string; brand?: string; productImage?: string | null; styleDescription?: string | null
  colorId?: string; sizeId?: string; sku?: string
  availableColors?: CatalogColor[]; availableSizes?: CatalogSize[]; availableVariants?: CatalogVariant[]
}
interface GangsheetArtwork { id: string; artworkNo: string; size: string; qty: number; sizeAuto?: boolean; image?: string | null }
interface GangsheetItem { id: string; width: number; height: string; qty: number; pricePerSheet: number }
interface DtfItem {
  id: string; artworkNo: string; width: string; height: string; qty: number; unitPrice: number
  artworkImage?: string | null; frontImage?: string | null
}

// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// Helpers
// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

const uid = () => Math.random().toString(36).slice(2, 9)
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const todayISO = () => new Date().toISOString().split('T')[0]

const DTF_SIZES = ['4 x 4 in', '6 x 6 in', '8 x 10 in', '10 x 12 in', '12 x 16 in', '13 x 17 in']
const GANGSHEET_BREAK_HEIGHT = 108
const gangsheetSheetQty = (height: string | number) => {
  const inches = Math.max(0, Number(height) || 0)
  return inches > 0 ? Math.floor(inches / GANGSHEET_BREAK_HEIGHT) + 1 : 1
}
const parseDimensions = (value?: string | null) => {
  const match = String(value ?? '').match(/([\d.]+)\s*(?:"|in)?\s*[x×]\s*([\d.]+)/i)
  return { width: match?.[1] ?? '', height: match?.[2] ?? '' }
}
const PAYMENT_TERMS = ['Advance', 'Due on Receipt', 'Net 15', 'Net 30', 'Net 60', 'Paid']
const PAYMENT_STATUSES: PaymentStatus[] = ['Unpaid', 'Partial', 'Paid', 'Refunded']

const PAYMENT_STATUS_STYLES: Record<PaymentStatus, { bg: string; color: string }> = {
  Unpaid:   { bg: '#fef2f2', color: '#dc2626' },
  Partial:  { bg: '#fef9c3', color: '#ca8a04' },
  Paid:     { bg: '#f0fdf4', color: '#16a34a' },
  Refunded: { bg: '#f5f3ff', color: '#7c3aed' },
}

const initApparel  = (): ApparelItem[]   => []
const initGangsheet= (): GangsheetItem[] => [{ id: uid(), width: 22, height: '', qty: 1, pricePerSheet: 0 }]
const initGangsheetArtworks = (): GangsheetArtwork[] => [{ id: uid(), artworkNo: 'AW-GS-001', size: '', qty: 1, image: null }]
const initDtf      = (): DtfItem[]       => [{ id: uid(), artworkNo: '', width: '', height: '', qty: 1, unitPrice: 0 }]

// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// ArtworkThumb
// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function ImageUploadCell({
  imageUrl, label, onUpload, onRemove, uploading,
}: {
  imageUrl?: string | null; label: string
  onUpload: (file: File) => void; onRemove: () => void; uploading?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className={`nq-img-cell${uploading ? ' nq-img-uploading' : ''}`}>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) { onUpload(f); e.target.value = '' } }} />
      {imageUrl ? (
        <div className="nq-img-thumb-wrap">
          <img src={imageUrl} className="nq-img-thumb" alt={label} />
          <button type="button" className="nq-img-remove" onClick={e => { e.stopPropagation(); onRemove() }}><X size={8} /></button>
        </div>
      ) : (
        <button type="button" className="nq-img-placeholder" disabled={uploading} onClick={() => inputRef.current?.click()}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <rect width="20" height="20" rx="4" fill="#e2e8f0" />
            <path d="M4 14l4-4 3 3 2-2 3 3" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="7" cy="7" r="1.5" fill="#94a3b8" />
          </svg>
          <span>{uploading ? 'Uploading…' : label}</span>
        </button>
      )}
    </div>
  )
}

function ArtworkSizePicker({ value, onChange, autoDetected = false }: { value: string; onChange: (value: string) => void; autoDetected?: boolean }) {
  const isPreset = DTF_SIZES.includes(value)
  const [custom, setCustom] = useState(Boolean(value) && !isPreset && !autoDetected)

  useEffect(() => {
    if (autoDetected) setCustom(false)
    else if (value && !DTF_SIZES.includes(value)) setCustom(true)
  }, [value, autoDetected])

  return (
    <div className="no-artwork-size-picker">
      <select className="no-table-select" aria-label="Artwork size" value={custom ? '__custom__' : value} onChange={event => {
        if (event.target.value === '__custom__') {
          setCustom(true)
          if (isPreset) onChange('')
        } else {
          setCustom(false)
          onChange(event.target.value)
        }
      }}>
        <option value="">Select size</option>
        {DTF_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
        {autoDetected && value && !isPreset && <option value={value}>{value}</option>}
        <option value="__custom__">Custom…</option>
      </select>
      {custom && <input autoFocus className="no-table-input" placeholder="e.g. 5 x 7 in" value={value} onChange={event => onChange(event.target.value)} />}
    </div>
  )
}

// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// Main component
// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// Payment-method values differ across forms (quotes/invoices may store
// "Bank Transfer" or "bank_transfer"). Normalise known variants to this form's
// option values on convert; any unknown/legacy value is returned unchanged so
// nothing is lost (a fallback <option> renders it).
const PM_KNOWN = ['cashapp', 'zelle', 'paypal', 'bank_transfer', 'cash', 'other']
const normalizePaymentMethod = (v?: string | null): string => {
  const raw = String(v ?? '').trim()
  if (!raw) return ''
  const map: Record<string, string> = {
    'bank transfer': 'bank_transfer', bank_transfer: 'bank_transfer',
    paypal: 'paypal', zelle: 'zelle',
    'cash app': 'cashapp', cash_app: 'cashapp', cashapp: 'cashapp',
    cash: 'cash', other: 'other',
  }
  return map[raw.toLowerCase()] ?? raw
}

export function NewOrderPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { user: me } = useAuthStore()

  // Convert-from-invoice context (set when navigated from InvoiceDetailPage)
  const fromInvoiceId: string | undefined = (location.state as any)?.fromInvoiceId
  const fromOrderType: OrderType | undefined = (location.state as any)?.orderType
  // Edit-existing-order context (set when navigated from OrderDetailPage)
  const editOrderId: string | undefined = (location.state as any)?.editOrderId

  // Header fields
  const [customerId, setCustomerId]       = useState<string | null>(null)
  const [customerText, setCustomerText]   = useState('')
  const [customerOpen, setCustomerOpen]   = useState(false)
  const [agentId, setAgentId] = useState('')
  const [orderDate, setOrderDate] = useState(todayISO())
  const [orderType, setOrderType] = useState<OrderType>(fromOrderType ?? 'apparel')
  const [quotationId, setQuotationId] = useState('')
  const [invoiceId, setInvoiceId] = useState(fromInvoiceId ?? '')

  // Table data
  const [apparel,   setApparel]   = useState<ApparelItem[]>(initApparel)
  const [gangsheet, setGangsheet] = useState<GangsheetItem[]>(initGangsheet)
  const [gangsheetArtworks, setGangsheetArtworks] = useState<GangsheetArtwork[]>(initGangsheetArtworks)
  const [dtf,       setDtf]       = useState<DtfItem[]>(initDtf)

  // Payment
  const [paymentTerms,   setPaymentTerms]   = useState(PAYMENT_TERMS[0])
  const [paymentMethod,  setPaymentMethod]  = useState<string>('zelle')
  const [paymentStatus,  setPaymentStatus]  = useState<PaymentStatus>('Unpaid')
  const [amountPaid,       setAmountPaid]       = useState(0)
  const [paymentReference, setPaymentReference] = useState('')
  // Which payment this order is being raised against. Money lands before the
  // order is keyed in, so the order is attached to a payment that already
  // exists rather than the payment being pointed at an order later.
  const [paymentId, setPaymentId] = useState('')
  const [paymentDate,      setPaymentDate]      = useState('')

  // Dates
  const [dueDate, setDueDate] = useState('')

  // Pricing
  const [rushServices,    setRushServices]    = useState(0)
  const [shippingCharges, setShippingCharges] = useState(0)
  const [discountPct,     setDiscountPct]     = useState(0)
  const [taxPct,          setTaxPct]          = useState(0)

  // Contact panel
  const [contactName,  setContactName]  = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [editingContact, setEditingContact] = useState(false)

  // Shipping panel
  const [shippingName,    setShippingName]    = useState('')
  const [shippingAddress, setShippingAddress] = useState('')
  const [editingShipping, setEditingShipping] = useState(false)

  // Notes
  const [orderNotes, setOrderNotes] = useState('')

  // Send menu
  const [sendAnchor, setSendAnchor] = useState<null | HTMLElement>(null)

  // Currency
  const [currency, setCurrency] = useState('USD')

  // Draft persistence — survives refresh / hard refresh / redeploy.
  // Create mode only: edit and convert-from-quote/invoice flows load their data
  // from the server, so a stale draft must never overwrite it. Transient UI
  // state (dropdown open, upload flags) is deliberately not persisted.
  const { restored, clearDraft } = useFormDraft(
    'order:new',
    { customerId, customerText, agentId, orderDate, orderType, quotationId, invoiceId,
      apparel, gangsheet, gangsheetArtworks, dtf,
      paymentTerms, paymentMethod, paymentStatus, amountPaid, paymentReference, paymentDate,
      dueDate, rushServices, shippingCharges, discountPct, taxPct,
      contactName, contactEmail, contactPhone, shippingName, shippingAddress,
      orderNotes, currency },
    saved => {
      const str = (v: unknown) => typeof v === 'string' ? v : undefined
      const num = (v: unknown) => typeof v === 'number' ? v : undefined
      if (saved.customerId !== undefined) setCustomerId(saved.customerId as string | null)
      if (str(saved.customerText) !== undefined) setCustomerText(saved.customerText as string)
      if (str(saved.agentId) !== undefined) setAgentId(saved.agentId as string)
      if (str(saved.orderDate) !== undefined) setOrderDate(saved.orderDate as string)
      if (str(saved.orderType) !== undefined) setOrderType(saved.orderType as OrderType)
      if (str(saved.quotationId) !== undefined) setQuotationId(saved.quotationId as string)
      if (str(saved.invoiceId) !== undefined) setInvoiceId(saved.invoiceId as string)
      if (Array.isArray(saved.apparel)) setApparel(saved.apparel as ApparelItem[])
      if (Array.isArray(saved.gangsheet)) setGangsheet(saved.gangsheet as GangsheetItem[])
      if (Array.isArray(saved.gangsheetArtworks)) setGangsheetArtworks(saved.gangsheetArtworks as GangsheetArtwork[])
      if (Array.isArray(saved.dtf)) setDtf(saved.dtf as DtfItem[])
      if (str(saved.paymentTerms) !== undefined) setPaymentTerms(saved.paymentTerms as string)
      if (str(saved.paymentMethod) !== undefined) setPaymentMethod(saved.paymentMethod as string)
      if (str(saved.paymentStatus) !== undefined) setPaymentStatus(saved.paymentStatus as PaymentStatus)
      if (num(saved.amountPaid) !== undefined) setAmountPaid(saved.amountPaid as number)
      if (str(saved.paymentReference) !== undefined) setPaymentReference(saved.paymentReference as string)
      if (str(saved.paymentDate) !== undefined) setPaymentDate(saved.paymentDate as string)
      if (str(saved.dueDate) !== undefined) setDueDate(saved.dueDate as string)
      if (num(saved.rushServices) !== undefined) setRushServices(saved.rushServices as number)
      if (num(saved.shippingCharges) !== undefined) setShippingCharges(saved.shippingCharges as number)
      if (num(saved.discountPct) !== undefined) setDiscountPct(saved.discountPct as number)
      if (num(saved.taxPct) !== undefined) setTaxPct(saved.taxPct as number)
      if (str(saved.contactName) !== undefined) setContactName(saved.contactName as string)
      if (str(saved.contactEmail) !== undefined) setContactEmail(saved.contactEmail as string)
      if (str(saved.contactPhone) !== undefined) setContactPhone(saved.contactPhone as string)
      if (str(saved.shippingName) !== undefined) setShippingName(saved.shippingName as string)
      if (str(saved.shippingAddress) !== undefined) setShippingAddress(saved.shippingAddress as string)
      if (str(saved.orderNotes) !== undefined) setOrderNotes(saved.orderNotes as string)
      if (str(saved.currency) !== undefined) setCurrency(saved.currency as string)
    },
    { enabled: !editOrderId && !fromInvoiceId },
  )

  // Image uploads
  const [uploadingImg, setUploadingImg] = useState<Record<string, boolean>>({})
  const uploadItemImage = async (
    rowId: string,
    field: 'frontImage' | 'backImage' | 'artworkImage' | 'frontMockup' | 'backMockup',
    file: File,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updater: (id: string, patch: any) => void,
    autoSizeField?: 'artworkSize' | 'size' | 'dimensions'
  ) => {
    setUploadingImg(prev => ({ ...prev, [`${rowId}-${field}`]: true }))
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post('/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      const autoSize = res.data?.dimensions?.artwork_size
      const dimensions = autoSizeField === 'dimensions' ? parseDimensions(autoSize) : null
      updater(rowId, {
        [field]: res.data.url,
        ...(autoSizeField && autoSize && autoSizeField !== 'dimensions' ? { [autoSizeField]: autoSize } : {}),
        ...(dimensions ? dimensions : {}),
      })
      if (autoSizeField && autoSize) {
        const dpiNote = res.data.dimensions.dpi_source === 'embedded'
          ? `${res.data.dimensions.dpi} DPI`
          : '300 DPI default'
        toast.success(`Artwork size detected: ${autoSize} (${dpiNote})`)
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.error ?? 'Image upload failed. Use JPG, PNG, WEBP or SVG up to 10 MB.')
    } finally {
      setUploadingImg(prev => ({ ...prev, [`${rowId}-${field}`]: false }))
    }
  }

  // ── Fetch existing order when editing ────────────────────────────────────
  // Payments available to attach. Unattached ones come first, because those are
  // almost always the one being looked for; already-attached payments stay
  // selectable so a payment covering several orders can be picked more than
  // once, which the combined-billing jobs need.
  const { data: paymentsData } = useQuery({
    queryKey: ['selectable-payments'],
    queryFn:  () => api.get('/payments', { params: { page: 1, limit: 500 } }).then(r => r.data.data?.rows ?? []),
    staleTime: 30_000,
  })
  const selectablePayments = useMemo(() => {
    const list: any[] = Array.isArray(paymentsData) ? paymentsData : []
    return [...list].sort((a, b) => {
      const aFree = a.order_number ? 1 : 0
      const bFree = b.order_number ? 1 : 0
      if (aFree !== bFree) return aFree - bFree
      return String(b.payment_date || '').localeCompare(String(a.payment_date || ''))
    })
  }, [paymentsData])

  const { data: existingOrder } = useQuery({
    queryKey: ['edit-order', editOrderId],
    queryFn:  () => api.get(`/orders/${editOrderId}`).then(r => r.data.data),
    enabled:  !!editOrderId,
  })

  useEffect(() => {
    if (!existingOrder) return
    setOrderType(existingOrder.order_type as OrderType)
    setCustomerId(existingOrder.customer_id ?? null)
    setCustomerText(existingOrder.customer_name ?? existingOrder.contact_name ?? '')
    setOrderDate(existingOrder.order_date?.slice(0, 10) ?? todayISO())
    setDueDate(existingOrder.due_date?.slice(0, 10) ?? '')
    setPaymentTerms(existingOrder.payment_terms ?? PAYMENT_TERMS[0])
    setPaymentMethod(existingOrder.payment_method ?? 'zelle')
    setPaymentStatus((existingOrder.payment_status ?? 'Unpaid') as PaymentStatus)
    setAmountPaid(Number(existingOrder.amount_paid ?? 0))
    setPaymentReference(existingOrder.payment_reference ?? '')
    setPaymentDate(existingOrder.payment_date?.slice(0, 10) ?? '')
    setCurrency(existingOrder.currency ?? 'USD')
    setRushServices(Number(existingOrder.rush_services ?? 0))
    setShippingCharges(Number(existingOrder.shipping_charges ?? 0))
    setDiscountPct(Number(existingOrder.discount_pct ?? 0))
    setTaxPct(Number(existingOrder.tax_pct ?? 0))
    setQuotationId(existingOrder.quotation_id ?? '')
    setInvoiceId(existingOrder.invoice_id ?? '')
    setContactName(existingOrder.contact_name ?? '')
    setContactEmail(existingOrder.contact_email ?? '')
    setContactPhone(existingOrder.contact_phone ?? '')
    setShippingName(existingOrder.shipping_name ?? '')
    setShippingAddress(existingOrder.shipping_address ?? '')
    setOrderNotes(existingOrder.notes ?? '')
    setAgentId(existingOrder.assigned_to ?? '')

    const items = existingOrder.items ?? []
    if (existingOrder.order_type === 'apparel') {
      setApparel(items.map((r: any) => ({ id: uid(), category: r.category ?? 'T-Shirt', item: r.item ?? '', color: r.color ?? '', size: r.size ?? '', qty: Number(r.qty), artworkNo: r.artwork_no ?? '', artworkSize: r.artwork_size ?? '', unitPrice: Number(r.unit_price), frontImage: r.front_image ?? null, backImage: r.back_image ?? null, frontMockup: r.front_mockup ?? null, backMockup: r.back_mockup ?? null, styleId: r.catalog_style_id, styleCode: r.model, brand: r.brand, productImage: r.product_image, styleDescription: r.style_description, colorId: r.catalog_color_id, sizeId: r.catalog_size_id, sku: r.catalog_sku })))
    } else if (existingOrder.order_type === 'gangsheet') {
      setGangsheet(items.map((r: any) => {
        const dimensions = String(r.size ?? '').match(/([\d.]+)\s*(?:"|in)?\s*[x×]\s*([\d.]+)/i)
        const height = dimensions?.[2] ?? ''
        return { id: uid(), width: 22, height, qty: gangsheetSheetQty(height), pricePerSheet: Number(r.price_per_sheet) }
      }))
      const savedArtworks = items.flatMap((r: any) => Array.isArray(r.artworks) ? r.artworks : [])
      setGangsheetArtworks(savedArtworks.length ? savedArtworks.map((art: any, index: number) => ({ id: uid(), artworkNo: art.artwork_no || `AW-GS-${String(index + 1).padStart(3, '0')}`, size: art.size ?? '', qty: Math.max(1, Number(art.qty) || 1), image: art.image ?? null })) : items.filter((r: any) => r.front_image).map((r: any, index: number) => ({ id: uid(), artworkNo: `AW-GS-${String(index + 1).padStart(3, '0')}`, size: '', qty: 1, image: r.front_image })))
    } else {
      setDtf(items.map((r: any, index: number) => {
        const dimensions = parseDimensions(r.size || r.artwork_name)
        const legacyArtworkNo = !parseDimensions(r.artwork_name).width && r.artwork_name !== 'DTF Transfer'
          ? r.artwork_name
          : ''
        return {
          id: uid(),
          artworkNo: r.artwork_no || legacyArtworkNo || `AW-TF-${String(index + 1).padStart(3, '0')}`,
          width: r.width_inches != null ? String(r.width_inches) : dimensions.width,
          height: r.height_inches != null ? String(r.height_inches) : dimensions.height,
          qty: Number(r.qty),
          unitPrice: Number(r.unit_price),
          artworkImage: r.artwork_image ?? null,
          frontImage: r.front_image ?? r.artwork_image ?? null,
        }
      }))
    }
  }, [existingOrder])

  // ── Fetch source invoice when converting from invoice ────────────────────
  const { data: sourceInvoice } = useQuery({
    queryKey: ['convert-from-invoice', fromInvoiceId],
    queryFn:  () => api.get(`/invoices/${fromInvoiceId}`).then(r => r.data.data ?? r.data),
    enabled:  !!fromInvoiceId,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  // Fetch linked quotation to get items
  const { data: sourceQuote } = useQuery({
    queryKey: ['convert-from-quote', sourceInvoice?.quote_id],
    queryFn:  () => api.get(`/quotations/${sourceInvoice!.quote_id}`).then(r => r.data.data ?? r.data),
    enabled:  !!sourceInvoice?.quote_id,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  useEffect(() => {
    if (!sourceInvoice) return
    if (sourceInvoice.customer_id) setCustomerId(sourceInvoice.customer_id)
    const custName = sourceInvoice.customer_name || sourceInvoice.supplier_name || ''
    if (custName) { setCustomerText(custName); setContactName(custName); setShippingName(custName) }
    if (sourceInvoice.billing_email)    setContactEmail(sourceInvoice.billing_email)
    if (sourceInvoice.contact_number)   setContactPhone(sourceInvoice.contact_number)
    if (sourceInvoice.shipping_address) setShippingAddress(sourceInvoice.shipping_address)
    if (sourceInvoice.payment_method)   setPaymentMethod(normalizePaymentMethod(sourceInvoice.payment_method))
    if (sourceInvoice.payment_terms)    setPaymentTerms(sourceInvoice.payment_terms)
    if (sourceInvoice.notes)            setOrderNotes(sourceInvoice.notes)
    if (sourceInvoice.shipping_charges) setShippingCharges(Number(sourceInvoice.shipping_charges))
    if (sourceInvoice.rush_services)    setRushServices(Number(sourceInvoice.rush_services))
    if (sourceInvoice.discount_pct)     setDiscountPct(Number(sourceInvoice.discount_pct))
  }, [sourceInvoice])

  useEffect(() => {
    if (!sourceQuote?.items?.length) return
    const type: OrderType = (fromOrderType ?? sourceQuote.order_type ?? 'apparel') as OrderType
    setOrderType(type)
    const qItems = sourceQuote.items as Array<{
      description: string; qty: number; unit_price: number; artwork_no?: string | null
      sizes?: string | null; colors?: string | null; artwork_count?: number | null
    }>
    if (type === 'apparel') {
      setApparel(qItems.map(it => ({
        id:          uid(),
        category:    (it as any).category || 'T-Shirt',
        item:        it.description || '',
        color:       it.colors     ?? '',
        size:        it.sizes      ?? '',
        qty:         Number(it.qty),
        artworkNo:   '',
        artworkSize: '',
        unitPrice:   Number(it.unit_price),
        frontImage:  (it as any).front_image ?? null,
        backImage:   (it as any).back_image  ?? null,
        styleId:     (it as any).catalog_style_id,
        styleCode:   (it as any).model,
        brand:       (it as any).brand,
        productImage:(it as any).product_image,
        colorId:     (it as any).catalog_color_id,
        sizeId:      (it as any).catalog_size_id,
        sku:         (it as any).catalog_sku,
      })))
    } else if (type === 'gangsheet') {
      setGangsheet(qItems.map(it => ({
        id:            uid(),
        width:         22,
        height:        String(it.sizes ?? it.description ?? '').match(/[x×]\s*([\d.]+)/i)?.[1] ?? '',
        qty:           gangsheetSheetQty(String(it.sizes ?? it.description ?? '').match(/[x×]\s*([\d.]+)/i)?.[1] ?? ''),
        pricePerSheet: Number(it.unit_price),
      })))
      setGangsheetArtworks(qItems.flatMap((it, index) => {
        const image = (it as any).front_image ?? (it as any).artwork_image ?? null
        return image ? [{ id: uid(), artworkNo: `AW-GS-${String(index + 1).padStart(3, '0')}`, size: '', qty: Math.max(1, Number(it.qty) || 1), image }] : []
      }))
    } else {
      setDtf(qItems.map((it, index) => {
        const dimensions = parseDimensions(it.sizes || it.description)
        return {
        id:            uid(),
        artworkNo:     it.artwork_no ?? `AW-TF-${String(index + 1).padStart(3, '0')}`,
        width:         dimensions.width,
        height:        dimensions.height,
        qty:           Number(it.qty),
        unitPrice:     Number(it.unit_price),
        artworkImage:  (it as any).front_image ?? (it as any).artwork_image ?? null,
        frontImage:    (it as any).front_image ?? (it as any).artwork_image ?? null,
      }}))
    }
  }, [sourceQuote])

  // Convert/edit apparel rows carry catalog IDs but not the option lists, so the
  // Color/Size dropdowns render empty. Hydrate colors/sizes/variants (+ display
  // names, SKU and preview) from the product master so the saved selection shows
  // and isn't wiped on re-save. Mirrors the invoice form's backfill; snapshots
  // are untouched (values only fill when currently empty).
  useEffect(() => {
    const missing = apparel.filter(item => item.styleId && !item.availableColors)
    if (!missing.length) return
    let cancelled = false
    Promise.all(missing.map(async item => {
      try {
        const style = (await api.get(`/products/${item.styleId}`)).data.data as ApparelCatalogStyle
        const color = style.colors?.find(value => value.style_color_id === item.colorId)
        const size = style.sizes?.find(value => value.style_size_id === item.sizeId)
        const variant = style.variants?.find(value => value.style_color_id === item.colorId && value.style_size_id === item.sizeId)
        return {
          id: item.id,
          patch: {
            item:             item.item || style.name,
            styleCode:        item.styleCode || style.sku,
            brand:            item.brand || style.brand,
            productImage:     item.productImage || style.images?.[0]?.image_url || style.image_url,
            styleDescription: item.styleDescription || style.description,
            availableColors:  style.colors ?? [],
            availableSizes:   style.sizes ?? [],
            availableVariants: style.variants ?? [],
            color:            item.color || color?.display_name || '',
            size:             item.size || size?.size_name || '',
            sku:              item.sku || variant?.sku_code || '',
          } as Partial<ApparelItem>,
        }
      } catch {
        return null
      }
    })).then(results => {
      if (cancelled) return
      setApparel(previous => previous.map(item => {
        const match = results.find(result => result?.id === item.id)
        return match ? { ...item, ...match.patch } : item
      }))
    })
    return () => { cancelled = true }
  }, [apparel])

  // ── Load customers & agents ──
  const { data: customerData } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => api.get('/customers', { params: { limit: 200 } }).then(r => r.data.data.rows as Customer[]),
  })
  const customers: Customer[] = customerData ?? []

  const { data: agentData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users', { params: { limit: 100 } }).then(r => r.data.data.rows as Agent[]),
  })
  const agents: Agent[] = agentData ?? []

  const { data: quoteData } = useQuery({
    queryKey: ['order-quote-options'],
    queryFn: () => api.get('/quotations', { params: { limit: 200 } }).then(r => r.data.data.rows),
  })
  const { data: invoiceData } = useQuery({
    queryKey: ['order-invoice-options'],
    queryFn: () => api.get('/invoices', { params: { limit: 200 } }).then(r => r.data.data.rows),
  })
  const quoteOptions: any[] = quoteData ?? []
  const invoiceOptions: any[] = invoiceData ?? []

  // Set default agent once list loads (no auto-select for customer)


  useEffect(() => {
    if (agents.length && !agentId) {
      const match = agents.find(u => u.id === me?.id)
      setAgentId(match?.id ?? agents[0]?.id ?? '')
    }
  }, [agents, me?.id])

  // Load the complete customer record so contact and the default shipping
  // address always come from Customers, not from the supplier directory.
  useEffect(() => {
    if (!customerId) return
    let cancelled = false
    api.get(`/customers/${customerId}`).then(response => {
      if (cancelled) return
      const c = response.data.data as Customer
      const shipping = c.addresses?.find(a => a.address_type === 'shipping' && a.is_default)
        ?? c.addresses?.find(a => a.address_type === 'shipping')
      const address = shipping ?? {
        line1: c.address_line1,
        line2: c.address_line2,
        city: c.city,
        state: c.state,
        zipcode: c.zip,
        country: c.country,
      }
      const zip = address.zipcode
      setCustomerText(c.name)
      setContactName(c.name)
      setContactEmail(c.email ?? '')
      setContactPhone(c.mobile_number ?? c.company_phone_number ?? c.phone ?? '')
      setShippingName(c.company_name ?? c.company ?? c.name)
      const addrParts = [address.line1 ?? c.address_line1, address.line2 ?? c.address_line2, address.city ?? c.city, (address.state ?? c.state) && zip ? `${address.state ?? c.state} ${zip}` : (address.state ?? c.state ?? zip), address.country ?? c.country].filter(Boolean)
      setShippingAddress(addrParts.join(', '))
      setEditingContact(false)
      setEditingShipping(false)
    }).catch(() => toast.error('Could not load the selected customer details'))
    return () => { cancelled = true }
  }, [customerId])

  // â"€â"€ Derived totals â"€â"€
  const itemsTotal  = useMemo(() => {
    if (orderType === 'apparel')   return apparel.reduce((s, r) => s + r.unitPrice * r.qty, 0)
    if (orderType === 'gangsheet') return gangsheet.reduce((s, r) => s + r.pricePerSheet * r.qty, 0)
    return dtf.reduce((s, r) => s + r.unitPrice * r.qty, 0)
  }, [orderType, apparel, gangsheet, dtf])
  const apparelQty = useMemo(() => apparel.reduce((sum, row) => sum + row.qty, 0), [apparel])
  // Live apparel weight from the selected BlankTex size's per-size garment weight
  // (grams → lbs). Display-only; does not change the saved order payload.
  const GRAMS_PER_LB = 453.59237
  const orderUnitWeightG = (row: ApparelItem) => {
    const g = Number(row.availableSizes?.find(s => s.style_size_id === row.sizeId)?.size_spec?.garment_weight_g)
    return Number.isFinite(g) ? g : 0
  }
  const apparelWeightLbs = useMemo(
    () => +(apparel.reduce((sum, row) => sum + orderUnitWeightG(row) * row.qty, 0) / GRAMS_PER_LB).toFixed(2),
    [apparel]
  )
  const gangsheetQty = useMemo(() => gangsheet.reduce((sum, row) => sum + row.qty, 0), [gangsheet])
  const gangsheetArtworkCount = useMemo(() => gangsheetArtworks.reduce((sum, row) => sum + Math.max(1, Number(row.qty) || 1), 0), [gangsheetArtworks])
  const dtfQty = useMemo(() => dtf.reduce((sum, row) => sum + row.qty, 0), [dtf])

  // Subtotal is the item lines only; rush and shipping are added on top of it.
  const subtotal    = useMemo(() => itemsTotal, [itemsTotal])
  const discountAmt = useMemo(() => +(subtotal * (discountPct / 100)).toFixed(2), [subtotal, discountPct])
  const charged     = useMemo(() => +(subtotal - discountAmt + rushServices + shippingCharges).toFixed(2), [subtotal, discountAmt, rushServices, shippingCharges])
  const taxAmt      = useMemo(() => +(charged * (taxPct / 100)).toFixed(2), [charged, taxPct])
  const total       = useMemo(() => +(charged + taxAmt).toFixed(2), [charged, taxAmt])
  const balanceDue  = useMemo(() => +Math.max(0, total - (Number(amountPaid) || 0)).toFixed(2), [total, amountPaid])

  // â"€â"€ Table helpers â"€â"€
  const updateApparel  = (id: string, p: Partial<ApparelItem>)   => setApparel(prev => prev.map(r => r.id === id ? { ...r, ...p } : r))
  const removeApparel  = (id: string) => setApparel(prev => prev.filter(r => r.id !== id))
  // Adding the same style a second time should not mean going back through the
  // catalogue search. This copies the row in place — style, colour, size,
  // artwork, price, images and the catalogue ids behind them — and drops the
  // copy directly beneath the original, so only the field that differs needs
  // touching. A fresh id keeps React's row identity and the delete button
  // working per row.
  const duplicateApparel = (id: string) => setApparel(prev => {
    const i = prev.findIndex(r => r.id === id)
    if (i === -1) return prev
    return [...prev.slice(0, i + 1), { ...prev[i], id: uid() }, ...prev.slice(i + 1)]
  })
  const addApparel = (style?: ApparelCatalogStyle) => setApparel(prev => [...prev, { id: uid(), category: 'T-Shirt', item: style?.name ?? '', color: '', size: '', qty: 1, artworkNo: '', artworkSize: '', unitPrice: 0, frontImage: null, backImage: null, styleId: style?.id, styleCode: style?.sku, brand: style?.brand, productImage: style?.images?.[0]?.image_url ?? style?.image_url, styleDescription: style?.description, availableColors: style?.colors ?? [], availableSizes: style?.sizes ?? [], availableVariants: style?.variants ?? [] }])
  const selectOrderApparelColor = (item: ApparelItem, colorId: string) => {
    const color = item.availableColors?.find(value => value.style_color_id === colorId)
    const variant = item.availableVariants?.find(value => value.style_color_id === colorId && value.style_size_id === item.sizeId)
    updateApparel(item.id, { colorId, color: color?.display_name ?? '', sku: variant?.sku_code ?? '' })
  }
  const selectOrderApparelSize = (item: ApparelItem, sizeId: string) => {
    const size = item.availableSizes?.find(value => value.style_size_id === sizeId)
    const variant = item.availableVariants?.find(value => value.style_size_id === sizeId && value.style_color_id === item.colorId)
    updateApparel(item.id, { sizeId, size: size?.size_name ?? '', sku: variant?.sku_code ?? '' })
  }

  const updateGangsheet= (id: string, p: Partial<GangsheetItem>) => setGangsheet(prev => prev.map(r => r.id === id ? { ...r, ...p } : r))
  const updateGangsheetHeight = (id: string, height: string) => {
    updateGangsheet(id, { height, qty: gangsheetSheetQty(height) })
  }
  const removeGangsheet= (id: string) => setGangsheet(prev => prev.filter(r => r.id !== id))
  const addGangsheet   = () => setGangsheet(prev => [...prev, { id: uid(), width: 22, height: '', qty: 1, pricePerSheet: 0 }])
  const addGangsheetArtwork = () => setGangsheetArtworks(prev => [...prev, { id: uid(), artworkNo: `AW-GS-${String(prev.length + 1).padStart(3, '0')}`, size: '', qty: 1, image: null }])
  const updateGangsheetArtwork = (id: string, patch: Partial<GangsheetArtwork>) => setGangsheetArtworks(prev => prev.map(row => row.id === id ? { ...row, ...patch } : row))
  const removeGangsheetArtwork = (id: string) => setGangsheetArtworks(prev => prev.filter(row => row.id !== id))

  const updateDtf      = (id: string, p: Partial<DtfItem>)       => setDtf(prev => prev.map(r => r.id === id ? { ...r, ...p } : r))
  const removeDtf      = (id: string) => setDtf(prev => prev.filter(r => r.id !== id))
  const addDtf         = () => setDtf(prev => [...prev, { id: uid(), artworkNo: `AW-TF-${String(prev.length + 1).padStart(3, '0')}`, width: '', height: '', qty: 1, unitPrice: 0 }])

  // â"€â"€ Save â"€â"€
  const createOrder = useMutation({
    mutationFn: (payload: object) => api.post('/orders', payload),
    onSuccess: async (res) => {
      const order = res.data.data
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      clearDraft()   // saved for real — the draft is no longer needed
      toast.success(`Order ${order.order_number ?? ''} created!`)
      navigate('/orders')
    },
    onError: (err: any) => {
      const data = err?.response?.data
      if (data?.details?.length) {
        const first = data.details[0]
        toast.error(`${first.field ? first.field + ': ' : ''}${first.message}`)
      } else {
        toast.error(data?.message ?? 'Failed to save order')
      }
    },
  })

  const updateOrder = useMutation({
    mutationFn: (payload: object) => api.put(`/orders/${editOrderId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['order', editOrderId] })
      toast.success('Order updated!')
      navigate(`/orders/${editOrderId}`)
    },
    onError: (err: any) => {
      const data = err?.response?.data
      if (data?.details?.length) {
        const first = data.details[0]
        toast.error(`${first.field ? first.field + ': ' : ''}${first.message}`)
      } else {
        toast.error(data?.message ?? 'Failed to update order')
      }
    },
  })

  const buildPayload = () => {
    const itemsPayload = orderType === 'apparel'
      ? apparel.map(r => ({ category: r.category, item: r.item, color: r.color, size: r.size, qty: r.qty, artwork_no: r.artworkNo || null, artwork_size: r.artworkSize || null, unit_price: r.unitPrice, front_image: r.frontImage || null, back_image: r.backImage || null, front_mockup: r.frontMockup || null, back_mockup: r.backMockup || null, catalog_style_id: r.styleId || null, catalog_color_id: r.colorId || null, catalog_size_id: r.sizeId || null, catalog_sku: r.sku || null, brand: r.brand || null, model: r.styleCode || null, product_image: r.productImage || null, style_description: r.styleDescription || null }))
      : orderType === 'gangsheet'
        ? gangsheet.map((r, index) => ({
            size: `22" x ${Number(r.height) || 0}"`,
            no_artworks: Math.max(1, gangsheetArtworkCount),
            qty: r.qty,
            price_per_sheet: r.pricePerSheet,
            front_image: index === 0 ? gangsheetArtworks[0]?.image || null : null,
            artworks: index === 0 ? gangsheetArtworks.map(art => ({ artwork_no: art.artworkNo, size: art.size, image: art.image || null, qty: Math.max(1, Number(art.qty) || 1) })) : [],
          }))
        : dtf.map(r => ({
            artwork_name: 'DTF Transfer',
            artwork_no: r.artworkNo || null,
            width_inches: Number(r.width) || null,
            height_inches: Number(r.height) || null,
            size: r.width && r.height ? `${r.width} x ${r.height} in` : null,
            qty: r.qty,
            unit_price: r.unitPrice,
            artwork_image: r.frontImage || r.artworkImage || null,
            front_image: r.frontImage || r.artworkImage || null,
            back_image: null,
          }))

    return {
      customer_id:        customerId,
      supplier_id:        null,
      supplier_name_text: null,
      invoice_id:         invoiceId || null,
      quotation_id:       quotationId || sourceInvoice?.quote_id || null,
      order_type:       orderType,
      order_date:       orderDate,
      due_date:         dueDate || null,
      payment_terms:    paymentTerms === 'Paid' ? 'Due on Receipt' : paymentTerms,
      payment_method:   paymentMethod,
      payment_status:   paymentStatus,
      amount_paid:      Number(amountPaid) || 0,
      payment_reference: paymentReference || null,
      payment_id:       paymentId || null,
      payment_date:     paymentDate || null,
      currency:         currency,
      rush_services:    rushServices,
      shipping_charges: shippingCharges,
      discount_pct:     discountPct,
      tax_pct:          taxPct,
      notes:            orderNotes || null,
      assigned_to:      agentId || null,
      contact_name:     contactName || null,
      contact_email:    contactEmail || null,
      contact_phone:    contactPhone || null,
      shipping_name:    shippingName || null,
      shipping_address: shippingAddress || null,
      items:            itemsPayload,
    }
  }

  const validateItems = (): string | null => {
    if (orderType === 'apparel') {
      for (let i = 0; i < apparel.length; i++) {
        const row = apparel[i]
        if (!row.item.trim()) return `Row ${i + 1}: Item name is required`
        // Catalog items (picked from a Product Master style) must have a colour
        // and size selected and a price — this is what was saving blank rows.
        // Legacy free-text rows (no styleId) are intentionally left untouched.
        if (row.styleId) {
          if (!row.colorId) return `Row ${i + 1}: Select a colour for this catalog item`
          if (!row.sizeId)  return `Row ${i + 1}: Select a size for this catalog item`
          if (!(Number(row.unitPrice) > 0)) return `Row ${i + 1}: Enter a unit price`
        }
      }
    }
    if (orderType === 'dtf') {
      for (let i = 0; i < dtf.length; i++) {
        if (!dtf[i].artworkNo.trim()) return `Row ${i + 1}: Artwork No. is required`
        if (!(Number(dtf[i].width) > 0)) return `Row ${i + 1}: Width is required`
        if (!(Number(dtf[i].height) > 0)) return `Row ${i + 1}: Height is required`
        if (!(Number(dtf[i].unitPrice) > 0)) return `Row ${i + 1}: Enter a unit price`
      }
    }
    if (orderType === 'gangsheet') {
      for (let i = 0; i < gangsheet.length; i++) {
        if (!(Number(gangsheet[i].height) > 0)) return `Gangsheet ${i + 1}: Height is required`
        if (!(Number(gangsheet[i].pricePerSheet) > 0)) return `Gangsheet ${i + 1}: Enter a price per sheet`
      }
    }
    return null
  }

  const handleSave = (_asDraft = false) => {
    if (!customerId) { toast.error('Please select a customer'); return }
    // Required on a new order only. Editing an existing one must not demand a
    // payment it never had, and the invoice→order conversion does not come
    // through this form at all.
    if (!editOrderId && !paymentId) {
      toast.error('Add the payment for this sales order first, then select it here')
      return
    }
    const activeItems = orderType === 'apparel' ? apparel : orderType === 'gangsheet' ? gangsheet : dtf
    if (activeItems.length > 0) {
      const itemErr = validateItems()
      if (itemErr) { toast.error(itemErr); return }
    }
    if (editOrderId) {
      updateOrder.mutate(buildPayload())
    } else {
      createOrder.mutate(buildPayload())
    }
  }

  const handleSendToCustomer = () => {
    if (!customerId) { toast.error('Please select a customer'); return }
    const activeItems = orderType === 'apparel' ? apparel : orderType === 'gangsheet' ? gangsheet : dtf
    if (!activeItems.length) { toast.error('Add at least one item'); return }
    const itemErr = validateItems()
    if (itemErr) { toast.error(itemErr); return }
    createOrder.mutate(buildPayload())
  }

  const psStyle = PAYMENT_STATUS_STYLES[paymentStatus]

  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Render
  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  return (
    <div className="no-page">
      <DraftBanner show={restored} onDiscard={() => { clearDraft(); window.location.reload() }} />

      {/* â"€â"€ Top action bar â"€â"€ */}
      <div className="no-topbar">
        <button className="no-topbar-btn" onClick={() => editOrderId ? navigate(`/orders/${editOrderId}/print`) : toast.info('Save the order to preview it')}><Eye size={14} /> Preview</button>
        {!editOrderId && (
          <button className="no-topbar-btn no-topbar-draft" onClick={() => handleSave(true)} disabled={createOrder.isPending || updateOrder.isPending}><Save size={14} /> Save Draft</button>
        )}
        <button className="no-topbar-btn" onClick={() => toast.info('All fields are already editable')}><Edit3 size={14} /> Edit</button>
        <button className="no-topbar-btn no-topbar-delete" onClick={() => editOrderId ? toast.info('Use the order details menu to permanently delete this order') : navigate(-1)}><Trash2 size={14} /> Delete</button>
        {!editOrderId && (
          <div className="no-split-wrap">
            <button className="no-topbar-btn no-topbar-send" onClick={handleSendToCustomer} disabled={createOrder.isPending}>
              <Send size={13} /> Send to Customer
            </button>
            <button className="no-topbar-btn no-topbar-send no-split-chevron" onClick={e => setSendAnchor(e.currentTarget)}>
              <ChevronDown size={13} />
            </button>
          </div>
        )}
        <Menu anchorEl={sendAnchor} open={Boolean(sendAnchor)} onClose={() => setSendAnchor(null)}>
          <MenuItem onClick={() => { toast.info('Email integration coming soon - share order link manually'); setSendAnchor(null) }}>Send via Email</MenuItem>
          <MenuItem onClick={() => { toast.info('WhatsApp integration coming soon'); setSendAnchor(null) }}>Send via WhatsApp</MenuItem>
          <MenuItem onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success('Order link copied'); setSendAnchor(null) }}>Copy Link</MenuItem>
        </Menu>
        <button className="no-topbar-btn no-topbar-save" onClick={() => handleSave()} disabled={createOrder.isPending || updateOrder.isPending}>
          <Save size={14} /> {(createOrder.isPending || updateOrder.isPending) ? 'Saving...' : editOrderId ? 'Update' : 'Save'}
        </button>
        <button className="no-topbar-btn no-topbar-approval" onClick={() => toast.success('Approval request will be available after saving the order')}><UserCheck size={14} /> Request Approval</button>
      </div>

      {/* â"€â"€ Info bar â"€â"€ */}
      <div className="no-info-bar">
        <div className="no-info-field no-order-type-field">
          <span className="no-info-label">Order Type <span style={{ color: '#ef4444' }}>*</span></span>
          {([
            { key: 'apparel', label: 'Custom Printed Apparel' },
            { key: 'gangsheet', label: 'DTF Gangsheet' },
            { key: 'dtf', label: 'DTF Transfers' },
          ] as { key: OrderType; label: string }[]).map(({ key, label }) => (
            <label key={key} className="no-type-inline">
              <input type="radio" name="headerOrderType" checked={orderType === key} onChange={() => setOrderType(key)} />
              {label}
            </label>
          ))}
        </div>
        <div className="no-info-field">
          <span className="no-info-label">Order #</span>
          <strong className="no-info-value no-order-badge">Auto</strong>
          <small>Auto generated</small>
        </div>

        <div className="no-info-field no-info-select-field">
          <span className="no-info-label">{orderType === 'apparel' ? 'Invoice' : 'Quote'}</span>
          {orderType === 'apparel' ? (
            <select className="no-info-select" value={invoiceId} onChange={e => setInvoiceId(e.target.value)}>
              <option value="">Select invoice</option>
              {invoiceOptions.map(inv => <option key={inv.id} value={inv.id}>{inv.invoice_number}</option>)}
            </select>
          ) : (
            <select className="no-info-select" value={quotationId} onChange={e => setQuotationId(e.target.value)}>
              <option value="">Select quote</option>
              {quoteOptions.map(q => <option key={q.id} value={q.id}>{q.quotation_number ?? q.quote_number}</option>)}
            </select>
          )}
        </div>

        <div className="no-info-field no-info-select-field" style={{ position: 'relative' }}>
          <span className="no-info-label">Customer <span style={{ color: '#ef4444' }}>*</span></span>
          <input
            className="no-info-select no-customer-input"
            placeholder="Search customer name, company, email or phone..."
            value={customerText}
            autoComplete="off"
            onChange={e => {
              setCustomerText(e.target.value)
              setCustomerId(null)
              setCustomerOpen(true)
            }}
            onFocus={() => setCustomerOpen(true)}
            onBlur={() => setTimeout(() => setCustomerOpen(false), 150)}
          />
          {customerOpen && customers.filter(c => [c.name, c.company_name, c.email, c.company_phone_number, c.mobile_number].some(value => value?.toLowerCase().includes(customerText.toLowerCase()))).length > 0 && (
            <ul className="no-customer-suggestions">
              {customers
                .filter(c => [c.name, c.company_name, c.email, c.company_phone_number, c.mobile_number].some(value => value?.toLowerCase().includes(customerText.toLowerCase())))
                .slice(0, 8)
                .map(c => (
                  <li
                    key={c.id}
                    className="no-customer-suggestion-item"
                    onMouseDown={() => {
                      setCustomerId(c.id)
                      setCustomerText(c.name)
                      setCustomerOpen(false)
                    }}
                  >
                    <span className="no-cust-name">{c.name}</span>
                    {c.company_name && <span className="no-cust-email">{c.company_name}</span>}
                    {c.email && <span className="no-cust-email">{c.email}</span>}
                  </li>
                ))}
            </ul>
          )}
        </div>

        <div className="no-info-field no-info-select-field">
          <span className="no-info-label">Order Date</span>
          <input type="date" className="no-info-select" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
        </div>

        <div className="no-info-field no-info-select-field">
          <span className="no-info-label">Due Date</span>
          <input type="date" className="no-info-select" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>

        <div className="no-info-field no-info-select-field">
          <span className="no-info-label">Payment Status</span>
          <select
            className="no-info-select no-payment-status-select"
            value={paymentStatus}
            onChange={e => setPaymentStatus(e.target.value as PaymentStatus)}
            style={{ color: psStyle.color, fontWeight: 700 }}
          >
            {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="no-info-field no-info-select-field">
          <span className="no-info-label">Sales Agent</span>
          <select className="no-info-select" value={agentId} onChange={e => setAgentId(e.target.value)}>
            <option value="">- Unassigned -</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {/* â"€â"€ Two-column body â"€â"€ */}
      <div className="no-body no-body-cols">

        {/* â"€â"€ LEFT / MAIN â"€â"€ */}
        <div className="no-main">

          {/* Table card */}
          <div className="no-card">
            <h3 className="no-section-title">
              {orderType === 'apparel' && 'Custom Printed Apparel'}
              {orderType === 'gangsheet' && 'DTF Gangsheet'}
              {orderType === 'dtf' && 'DTF Transfers'}
            </h3>

            {/* â"€â"€ Apparel table â"€â"€ */}
            {orderType === 'apparel' && (
              <>
                <p className="nq-items-hint">Select a Product Master style. Colors, sizes, SKU, brand and preview fill automatically.</p>
                <ApparelCatalogPicker onSelect={addApparel} />
                <div className="no-table-wrap">
                  <table className="no-table no-catalog-apparel-table">
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}>S.No</th>
                        <th>Category</th>
                        <th>Item</th>
                        <th>Color</th>
                        <th>Size</th>
                        <th>SKU</th>
                        <th>Qty</th>
                        <th>Artwork</th>
                        <th>Mockup <small>Optional</small></th>
                        <th>Unit Price</th>
                        <th>Amount</th>
                        <th>Weight</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {apparel.map((row, idx) => (
                        <tr key={row.id} className="no-row">
                          <td className="no-td-num">{idx + 1}</td>
                          <td><select className="no-table-select" value={row.category} onChange={e => updateApparel(row.id, { category: e.target.value })}>{APPAREL_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></td>
                          <td>
                            <div className="nq-quote-product"><div className="nq-quote-product-image">{row.productImage ? <img src={row.productImage} alt={row.item} /> : <Package size={20} />}</div><div><strong>{row.item || 'Legacy apparel item'}</strong><span>Brand: {row.brand || '—'}</span><span>Style: {row.styleCode || '—'}</span></div></div>
                          </td>
                          <td>
                            {row.styleId ? <select className="no-table-select" value={row.colorId ?? ''} onChange={e => selectOrderApparelColor(row, e.target.value)}><option value="">Select color</option>{(row.availableColors ?? []).map(color => <option key={color.style_color_id} value={color.style_color_id}>{color.display_name}</option>)}</select> : <input className="no-table-input" value={row.color} onChange={e => updateApparel(row.id, { color: e.target.value })} />}
                          </td>
                          <td>
                            {row.styleId ? <select className="no-table-select no-size-select" value={row.sizeId ?? ''} onChange={e => selectOrderApparelSize(row, e.target.value)}><option value="">Select size</option>{(row.availableSizes ?? []).map(size => <option key={size.style_size_id} value={size.style_size_id}>{size.size_name}</option>)}</select> : <input className="no-table-input" value={row.size} onChange={e => updateApparel(row.id, { size: e.target.value })} />}
                          </td>
                          <td><code className="nq-item-sku">{row.sku || (row.colorId && row.sizeId ? 'No SKU' : 'Select color + size')}</code></td>
                          <td>
                            <input type="number" className="no-table-input" min={1} value={row.qty} onFocus={e => e.target.select()} onChange={e => updateApparel(row.id, { qty: Math.max(1, +e.target.value) })} />
                          </td>
                          <td><div className="nq-artwork-pair"><ImageUploadCell imageUrl={row.frontImage} label="Front" uploading={uploadingImg[`${row.id}-frontImage`]} onUpload={f => uploadItemImage(row.id, 'frontImage', f, updateApparel, 'artworkSize')} onRemove={() => updateApparel(row.id, { frontImage: null })} /><ImageUploadCell imageUrl={row.backImage} label="Back" uploading={uploadingImg[`${row.id}-backImage`]} onUpload={f => uploadItemImage(row.id, 'backImage', f, updateApparel, 'artworkSize')} onRemove={() => updateApparel(row.id, { backImage: null })} /></div></td>
                          <td><div className="nq-artwork-pair"><ImageUploadCell imageUrl={row.frontMockup} label="Front" uploading={uploadingImg[`${row.id}-frontMockup`]} onUpload={f => uploadItemImage(row.id, 'frontMockup', f, updateApparel)} onRemove={() => updateApparel(row.id, { frontMockup: null })} /><ImageUploadCell imageUrl={row.backMockup} label="Back" uploading={uploadingImg[`${row.id}-backMockup`]} onUpload={f => uploadItemImage(row.id, 'backMockup', f, updateApparel)} onRemove={() => updateApparel(row.id, { backMockup: null })} /></div></td>
                          <td>
                            <div className="no-price-input">
                              <span>$</span>
                              <input type="number" min={0} step={0.01} value={row.unitPrice} onFocus={e => e.target.select()} onChange={e => updateApparel(row.id, { unitPrice: +e.target.value })} />
                            </div>
                          </td>
                          <td className="no-td-amount">${fmt(row.unitPrice * row.qty)}</td>
                          <td>{orderUnitWeightG(row) ? `${(orderUnitWeightG(row) * row.qty / GRAMS_PER_LB).toFixed(2)} lbs` : '—'}</td>
                          <td>
                            <button className="no-action-icon-btn" onClick={() => duplicateApparel(row.id)} title="Add another of this item">
                              <Copy size={13} />
                            </button>
                            <button className="no-action-icon-btn no-delete-icon" onClick={() => removeApparel(row.id)} title="Remove row">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="live-summary-row">
                      <td colSpan={6}><span className="live-summary-title">Apparel Summary</span></td>
                      <td><div className="live-summary-stat"><span>Total Qty</span><strong>{apparelQty}</strong></div></td>
                      <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{apparel.length}</strong></div></td>
                      <td><div className="live-summary-stat"><span>Total Weight</span><strong>{apparelWeightLbs ? `${apparelWeightLbs} lbs` : '—'}</strong></div></td>
                      <td></td>
                      <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(itemsTotal)}</strong></div></td>
                      <td colSpan={2}></td>
                    </tr></tfoot>
                  </table>
                </div>
              </>
            )}

            {/* â"€â"€ Gangsheet table â"€â"€ */}
            {orderType === 'gangsheet' && (
              <>
                <div className="no-table-wrap">
                  <table className="no-table no-gangsheet-spec-table">
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}>S.No</th>
                        <th>Width (in)</th>
                        <th>Height (in)</th>
                        <th>Artworks</th>
                        <th>Sheets <small>Auto / 108 in</small></th>
                        <th>Price/Sheet (USD)</th>
                        <th>Amount (USD)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {gangsheet.map((row, idx) => (
                        <tr key={row.id} className="no-row">
                          <td className="no-td-num">{idx + 1}</td>
                          <td><div className="no-fixed-dimension"><strong>22</strong><span>in</span></div></td>
                          <td><div className="no-dimension-field"><input type="number" className="no-table-input" min={1} step="any" placeholder="Height" value={row.height} onChange={e => updateGangsheetHeight(row.id, e.target.value)} /><span>in</span></div></td>
                          <td><strong>{gangsheetArtworkCount}</strong></td>
                          <td><output className="no-auto-sheets" title={`One sheet per ${GANGSHEET_BREAK_HEIGHT} inches`}>{row.qty}</output></td>
                          <td>
                            <div className="no-price-input">
                              <span>$</span>
                              <input type="number" min={0} step={0.01} value={row.pricePerSheet} onFocus={e => e.target.select()} onChange={e => updateGangsheet(row.id, { pricePerSheet: +e.target.value })} />
                            </div>
                          </td>
                          <td className="no-td-amount">${fmt(row.pricePerSheet * row.qty)}</td>
                          <td>
                            <button className="no-action-icon-btn no-delete-icon" onClick={() => removeGangsheet(row.id)} title="Remove row">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="live-summary-row">
                      <td colSpan={3}><span className="live-summary-title">Gangsheet Summary</span></td>
                      <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{gangsheetArtworkCount}</strong></div></td>
                      <td><div className="live-summary-stat"><span>Total Sheets</span><strong>{gangsheetQty}</strong></div></td>
                      <td></td>
                      <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(itemsTotal)}</strong></div></td>
                      <td></td>
                    </tr></tfoot>
                  </table>
                </div>
                <button className="no-add-item-btn" onClick={addGangsheet}><Plus size={13} /> Add Item</button>
                <h3 className="no-subsection-title">Artworks in Gangsheet</h3>
                <div className="no-table-wrap">
                  <table className="no-table no-gangsheet-art-table">
                    <thead><tr><th>S.No</th><th>Artwork No.</th><th>Artwork</th><th>Artwork Size</th><th>Qty</th><th>Action</th></tr></thead>
                    <tbody>{gangsheetArtworks.map((row, idx) => (
                      <tr key={`art-${row.id}`}>
                        <td className="no-td-num">{idx + 1}</td>
                        <td><input className="no-table-input no-artwork-number-input" value={row.artworkNo} onChange={e => updateGangsheetArtwork(row.id, { artworkNo: e.target.value })} /></td>
                        <td><ImageUploadCell imageUrl={row.image} label="Upload" uploading={uploadingImg[`${row.id}-frontImage`]} onUpload={f => uploadItemImage(row.id, 'frontImage', f, (id, patch) => updateGangsheetArtwork(id, { image: patch.frontImage, size: patch.size, sizeAuto: Boolean(patch.size) }), 'size')} onRemove={() => updateGangsheetArtwork(row.id, { image: null, size: '', sizeAuto: false })} /></td>
                        <td><ArtworkSizePicker value={row.size} autoDetected={row.sizeAuto} onChange={size => updateGangsheetArtwork(row.id, { size, sizeAuto: false })} /></td>
                        <td><input type="number" className="no-table-input" min={1} value={row.qty} onFocus={event => event.currentTarget.select()} onChange={event => updateGangsheetArtwork(row.id, { qty: Math.max(1, Number(event.target.value) || 1) })} aria-label={`Quantity for ${row.artworkNo || `artwork ${idx + 1}`}`} /></td>
                        <td><button type="button" className="no-action-icon-btn no-delete-icon" onClick={() => removeGangsheetArtwork(row.id)} title="Delete artwork"><Trash2 size={13} /></button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <button className="no-add-item-btn" onClick={addGangsheetArtwork}><Plus size={13} /> Add Artwork</button>
              </>
            )}

            {/* â"€â"€ DTF Transfers table â"€â"€ */}
            {orderType === 'dtf' && (
              <>
                <div className="no-table-wrap">
                  <table className="no-table">
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}>S.No</th>
                        <th>Artwork No.</th>
                        <th>Width (in)</th>
                        <th>Height (in)</th>
                        <th>Qty</th>
                        <th>Artwork</th>
                        <th>Rate (USD)</th>
                        <th>Amount (USD)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dtf.map((row, idx) => (
                        <tr key={row.id} className="no-row">
                          <td className="no-td-num">{idx + 1}</td>
                          <td>
                            <input type="text" className="no-table-input no-table-input-wide" placeholder="AW-TF-001" value={row.artworkNo} onChange={e => updateDtf(row.id, { artworkNo: e.target.value })} />
                          </td>
                          <td>
                            <input type="number" className="no-table-input" min={0.01} step={0.01} placeholder="Width" value={row.width} onChange={e => updateDtf(row.id, { width: e.target.value })} />
                          </td>
                          <td>
                            <input type="number" className="no-table-input" min={0.01} step={0.01} placeholder="Height" value={row.height} onChange={e => updateDtf(row.id, { height: e.target.value })} />
                          </td>
                          <td>
                            <input type="number" className="no-table-input" min={1} value={row.qty} onFocus={e => e.target.select()} onChange={e => updateDtf(row.id, { qty: Math.max(1, +e.target.value) })} />
                          </td>
                          <td><ImageUploadCell imageUrl={row.frontImage ?? row.artworkImage} label="Artwork" uploading={uploadingImg[`${row.id}-frontImage`]} onUpload={f => uploadItemImage(row.id, 'frontImage', f, updateDtf, 'dimensions')} onRemove={() => updateDtf(row.id, { frontImage: null, artworkImage: null })} /></td>
                          <td>
                            <div className="no-price-input">
                              <span>$</span>
                              <input type="number" min={0} step={0.01} value={row.unitPrice} onFocus={e => e.target.select()} onChange={e => updateDtf(row.id, { unitPrice: +e.target.value })} />
                            </div>
                          </td>
                          <td className="no-td-amount">${fmt(row.unitPrice * row.qty)}</td>
                          <td>
                            <button className="no-action-icon-btn no-delete-icon" onClick={() => removeDtf(row.id)} title="Remove row">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="live-summary-row">
                      <td colSpan={2}><span className="live-summary-title">DTF Summary</span></td>
                      <td></td>
                      <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{dtf.length}</strong></div></td>
                      <td><div className="live-summary-stat"><span>Total Qty</span><strong>{dtfQty}</strong></div></td>
                      <td></td>
                      <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(itemsTotal)}</strong></div></td>
                      <td></td>
                    </tr></tfoot>
                  </table>
                </div>
                <button className="no-add-item-btn" onClick={addDtf}><Plus size={13} /> Add Item</button>
              </>
            )}
          </div>

          {/* â"€â"€ Bottom 3-panel row â"€â"€ */}
          <div className="no-bottom-panels">

            {/* Main Contact */}
            <div className="no-card no-contact-card">
              <div className="no-panel-header">
                <h4 className="no-panel-title">Main Contact</h4>
                <button className="no-panel-edit-btn" onClick={() => setEditingContact(v => !v)}>
                  {editingContact ? <><X size={13} /> Cancel</> : <><Edit3 size={13} /> Edit</>}
                </button>
              </div>
              {editingContact ? (
                <div className="no-contact-edit">
                  <input className="no-contact-input" placeholder="Name" value={contactName} onChange={e => setContactName(e.target.value)} />
                  <input className="no-contact-input" placeholder="Email" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
                  <input className="no-contact-input" placeholder="Phone" value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
                  <button className="no-contact-save-btn" onClick={() => setEditingContact(false)}><Check size={12} /> Save</button>
                </div>
              ) : (
                <div className="no-contact-details">
                  {contactName  ? <p className="no-contact-name">{contactName}</p>  : <p className="no-contact-empty">No contact info</p>}
                  {contactEmail && <p className="no-contact-line">{contactEmail}</p>}
                  {contactPhone && <p className="no-contact-line">{contactPhone}</p>}
                </div>
              )}
            </div>

            {/* Shipping Address */}
            <div className="no-card no-shipping-card">
              <div className="no-panel-header">
                <h4 className="no-panel-title">Shipping Address</h4>
                <button className="no-panel-edit-btn" onClick={() => setEditingShipping(v => !v)}>
                  {editingShipping ? <><X size={13} /> Cancel</> : <><Edit3 size={13} /> Edit</>}
                </button>
              </div>
              {editingShipping ? (
                <div className="no-contact-edit">
                  <input className="no-contact-input" placeholder="Ship to name" value={shippingName} onChange={e => setShippingName(e.target.value)} />
                  <textarea className="no-contact-textarea" placeholder="Full address" rows={3} value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} />
                  <button className="no-contact-save-btn" onClick={() => setEditingShipping(false)}><Check size={12} /> Save</button>
                </div>
              ) : (
                <div className="no-contact-details">
                  {shippingName ? <p className="no-contact-name">{shippingName}</p> : <p className="no-contact-empty">No shipping address</p>}
                  {shippingAddress && shippingAddress.split(',').map((line, i) => (
                    <p key={i} className="no-contact-line">{line.trim()}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Order Notes */}
            <div className="no-card no-notes-card">
              <div className="no-panel-header">
                <h4 className="no-panel-title">Order Notes</h4>
              </div>
              <textarea className="no-notes-textarea" placeholder="Internal notes about this order..." value={orderNotes} onChange={e => setOrderNotes(e.target.value)} />
            </div>
          </div>
        </div>

        {/* â"€â"€ RIGHT SIDEBAR â"€â"€ */}
        <div className="no-sidebar">

          {/* Price Summary */}
          <div className="no-card no-pricing-card">
            <h4 className="no-section-title">Price Summary</h4>

            <div className="no-pricing-row">
              <span>Items Total</span>
              <strong>${fmt(itemsTotal)}</strong>
            </div>
            <div className="no-pricing-row">
              <span>Rush Services</span>
              <div className="no-pricing-input-group">
                <span className="no-pricing-sym">$</span>
                <input type="number" className="no-pricing-input" min={0} step={0.01} value={rushServices} onFocus={e => e.target.select()} onChange={e => setRushServices(+e.target.value)} />
              </div>
            </div>
            <div className="no-pricing-row">
              <span>Shipping Charges</span>
              <div className="no-pricing-input-group">
                <span className="no-pricing-sym">$</span>
                <input type="number" className="no-pricing-input" min={0} step={0.01} value={shippingCharges} onFocus={e => e.target.select()} onChange={e => setShippingCharges(+e.target.value)} />
              </div>
            </div>
            <div className="no-pricing-row no-pricing-subtotal">
              <span>Subtotal</span>
              <strong>${fmt(subtotal)}</strong>
            </div>
            <div className="no-pricing-row">
              <span>Discount</span>
              <div className="no-pricing-input-group">
                <input type="number" className="no-pricing-input no-pricing-pct" min={0} max={100} value={discountPct} onFocus={e => e.target.select()} onChange={e => setDiscountPct(+e.target.value)} />
                <span className="no-pricing-sym">%</span>
                <span className="no-pricing-neg">-${fmt(discountAmt)}</span>
              </div>
            </div>
            <div className="no-pricing-row">
              <span>Tax</span>
              <div className="no-pricing-input-group">
                <input type="number" className="no-pricing-input no-pricing-pct" min={0} max={100} value={taxPct} onFocus={e => e.target.select()} onChange={e => setTaxPct(+e.target.value)} />
                <span className="no-pricing-sym">%</span>
                <strong>${fmt(taxAmt)}</strong>
              </div>
            </div>
            <div className="no-pricing-total-row">
              <span>Total</span>
              <strong className="no-net-amount">${fmt(total)}</strong>
            </div>
          </div>

          {/* Payment Information */}
          <div className="no-card no-payment-card">
            <h4 className="no-section-title">Payment Information</h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="no-payment-field">
                <label className="no-payment-label">Payment Terms</label>
                <select className="no-info-select" value={paymentTerms} onChange={e => {
                  const val = e.target.value
                  setPaymentTerms(val)
                  if (val === 'Paid') setPaymentStatus('Paid')
                }}>
                  {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              <div className="no-payment-field">
                <label className="no-payment-label">Payment Method</label>
                <select className="no-info-select" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  {paymentMethod && !PM_KNOWN.includes(paymentMethod) && <option value={paymentMethod}>{paymentMethod}</option>}
                  <option value="cashapp">CashApp</option>
                  <option value="zelle">Zelle</option>
                  <option value="paypal">PayPal</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="no-payment-field">
                <label className="no-payment-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Amount Received</span>
                  <button type="button" onClick={() => { setAmountPaid(total); setPaymentStatus('Paid') }}
                    style={{ fontSize: 10.5, color: '#2563eb', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, textTransform: 'none' }}>Full</button>
                </label>
                <div style={{ position: 'relative', width: '100%' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontWeight: 600, pointerEvents: 'none' }}>$</span>
                  <input
                    type="number"
                    className="no-info-select"
                    style={{ width: '100%', paddingLeft: 22 }}
                    min={0}
                    step={0.01}
                    value={amountPaid}
                    onFocus={e => e.target.select()}
                    onChange={e => {
                      const v = Math.max(0, +e.target.value)
                      setAmountPaid(v)
                      setPaymentStatus(v <= 0 ? 'Unpaid' : v >= total ? 'Paid' : 'Partial')
                    }}
                  />
                </div>
              </div>

              <div className="no-payment-field">
                <label className="no-payment-label">Currency</label>
                <select className="no-info-select" value={currency} onChange={e => setCurrency(e.target.value)}>
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="CAD">CAD - Canadian Dollar</option>
                  <option value="GBP">GBP - British Pound</option>
                  <option value="AUD">AUD - Australian Dollar</option>
                </select>
              </div>

              <div className="no-payment-field">
                <label className="no-payment-label">
                  Payment <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <select
                  className="no-info-select"
                  value={paymentId}
                  onChange={e => {
                    const id = e.target.value
                    setPaymentId(id)
                    // Carry the payment's own details onto the order so the two
                    // never disagree about how or when it was paid.
                    const chosen = selectablePayments.find(p => p.id === id)
                    if (chosen) {
                      if (chosen.payment_method) setPaymentMethod(normalizePaymentMethod(chosen.payment_method))
                      if (chosen.payment_date) setPaymentDate(String(chosen.payment_date).slice(0, 10))
                      if (chosen.payment_number) setPaymentReference(chosen.payment_number)
                      setAmountPaid(Number(chosen.amount) || 0)
                    }
                  }}
                >
                  <option value="">— Select the payment for this order —</option>
                  {selectablePayments.map(p => (
                    <option key={p.id} value={p.id}>
                      {[p.payment_number, p.payment_date ? String(p.payment_date).slice(0, 10) : null,
                        p.customer_name, `$${Number(p.amount || 0).toFixed(2)}`,
                        p.order_number ? `(already on ${p.order_number})` : null]
                        .filter(Boolean).join('  ·  ')}
                    </option>
                  ))}
                </select>
                {!paymentId && (
                  <small style={{ color: '#6b7280', fontSize: 11.5 }}>
                    Record the payment first, then pick it here.
                  </small>
                )}
              </div>

              <div className="no-payment-field">
                <label className="no-payment-label">Payment Reference</label>
                <input
                  type="text"
                  className="no-info-select"
                  placeholder="Txn / confirmation #"
                  value={paymentReference}
                  onChange={e => setPaymentReference(e.target.value)}
                />
              </div>

              <div className="no-payment-field">
                <label className="no-payment-label">Payment Date</label>
                <input
                  type="date"
                  className="no-info-select"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                />
              </div>
            </div>

            <div className="no-pricing-row" style={{ marginTop: 10 }}>
              <span>Balance Due</span>
              <strong style={{ color: balanceDue > 0 ? '#dc2626' : '#16a34a' }}>${fmt(balanceDue)}</strong>
            </div>

            <div className="no-payment-field" style={{ marginTop: 8 }}>
              <label className="no-payment-label">Payment Status</label>
              <select
                className="no-info-select no-payment-status-select"
                value={paymentStatus}
                onChange={e => setPaymentStatus(e.target.value as PaymentStatus)}
                style={{ color: psStyle.color, fontWeight: 700, background: psStyle.bg }}
              >
                {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* â"€â"€ Sticky bottom bar â"€â"€ */}
      <div className="no-bottom-bar">
        <div className="no-bottom-left">
          <button className="no-topbar-btn no-topbar-cancel" onClick={() => navigate(-1)}>Cancel</button>
          {!editOrderId && <button className="no-topbar-btn no-topbar-draft" onClick={() => handleSave(true)} disabled={createOrder.isPending || updateOrder.isPending}>Save</button>}
        </div>
        <button className="no-topbar-btn no-topbar-save" onClick={() => handleSave()} disabled={createOrder.isPending || updateOrder.isPending}>
          {(createOrder.isPending || updateOrder.isPending) ? 'Saving...' : editOrderId ? 'Update Order' : 'Save Order'}
        </button>
      </div>

    </div>
  )
}

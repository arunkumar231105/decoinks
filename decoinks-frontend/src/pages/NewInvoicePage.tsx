import { useMemo, useRef, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from '../utils/toast'
import { Avatar, Menu, MenuItem } from '@mui/material'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { copyText, printPanel } from '../utils/actions'
import { cn } from '../utils/cn'
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Eye,
  FileText,
  Image as ImageIcon,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Send,
  Trash2,
  UserCheck,
} from 'lucide-react'

// â"€â"€â"€ Types â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

type OrderType = 'apparel' | 'gangsheet' | 'dtf'
type InvoiceStatus = 'Draft' | 'Pending Approval' | 'Approved' | 'Sent' | 'Paid' | 'Cancelled'
type DiscountType = 'percentage' | 'fixed'

interface ApparelItem {
  id: string
  description: string
  color: string
  sizes: string
  qty: number
  unitPrice: number
  front_image?: string | null
  back_image?: string | null
}

interface GangsheetItem {
  id: string
  size: string
  numArtworks: number
  qtySheets: number
  pricePerSheet: number
  front_image?: string | null
  back_image?: string | null
}

interface TransferItem {
  id: string
  width: string
  height: string
  qty: number
  unitPrice: number
  artwork_image?: string | null
}

// â"€â"€â"€ Consoanos â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

const uid = () => Math.random().toString(36).slice(2, 9)
const todayISO = () => new Date().toISOString().split('T')[0]
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const parseTransferSize = (size: unknown) => {
  const match = String(size ?? '').match(/([\d.]+)\s*(?:"|in(?:ches)?)?\s*[x×]\s*([\d.]+)/i)
  return match ? { width: match[1], height: match[2] } : { width: '', height: '' }
}

const formatTransferSize = (width: string, height: string) =>
  width.trim() && height.trim() ? `${width.trim()}" x ${height.trim()}"` : 'DTF Transfer'

function InvoiceArtworkUpload({ imageUrl, label, onChange }: {
  imageUrl?: string | null
  label: string
  onChange: (url: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await api.post('/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      onChange(response.data.url)
    } catch {
      toast.error('Artwork upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={`nq-img-cell${uploading ? ' nq-img-uploading' : ''}`}>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={e => {
        const file = e.target.files?.[0]
        if (file) upload(file)
        e.target.value = ''
      }} />
      {imageUrl ? (
        <div className="nq-img-thumb-wrap">
          <img src={imageUrl} className="nq-img-thumb" alt={label} />
          <button type="button" className="nq-img-remove" onClick={() => onChange(null)}><Trash2 size={9} /></button>
        </div>
      ) : (
        <button type="button" className="nq-img-placeholder" onClick={() => inputRef.current?.click()} disabled={uploading}>
          <ImageIcon size={15} /><span>{uploading ? 'Uploading' : label}</span>
        </button>
      )}
    </div>
  )
}

const GS_SIZES = ['22"x60"', '22"x120"', '24"x60"', '30"x60"']
const STATUS_BADGE_CLASS: Record<InvoiceStatus, string> = {
  Draft: 'ni-badge-yellow',
  'Pending Approval': 'ni-badge-blue',
  Approved: 'ni-badge-green',
  Sent: 'ni-badge-blue',
  Paid: 'ni-badge-green',
  Cancelled: 'ni-badge-red',
}

// â"€â"€â"€ Customer combobox â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function SupplierCombobox({ value, onChange }: { value: string; onChange: (text: string, id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data: suppliers = [] } = useQuery({
    queryKey: ['customers-for-invoice'],
    queryFn: () => api.get('/customers', { params: { limit: 100 } }).then(r => r.data.data.rows),
  })
  const filtered = suppliers.filter((c: any) => (c.name ?? '').toLowerCase().includes(value.toLowerCase()))
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <input className="ni-info-select" value={value} placeholder="Search customer name..."
        onChange={e => { onChange(e.target.value, ''); setOpen(true) }}
        onFocus={() => setOpen(true)}
        style={{ width: '100%' }}
      />
      {open && filtered.length > 0 && (
        <div className="no-customer-suggestions" style={{ top: '100%', zIndex: 999 }}>
          {filtered.slice(0, 6).map((c: any) => (
            <div key={c.id} className="no-customer-suggestion-item"
              onMouseDown={() => { onChange(c.name, c.id); setOpen(false) }}>
              <span className="no-cust-name">{c.name}</span>
              {c.email && <span className="no-cust-email">{c.email}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// â"€â"€â"€ Inline SVG Thumbnails â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function ShiroThumb() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <rect width="36" height="36" rx="6" fill="#f1f5f9" />
      <path d="M10 14 L6 11 L10 8 L14 10 C14 10 16 9 18 9 C20 9 22 10 22 10 L26 8 L30 11 L26 14 L24 13 L24 28 L12 28 L12 13 Z" fill="#0d9488" opacity="0.7" />
    </svg>
  )
}

function ArtworkThumb40({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? 'png'
  const colors: Record<string, [string, string]> = {
    png: ['#0d9488', '#0891b2'],
    ai: ['#f59e0b', '#ef4444'],
    default: ['#6366f1', '#8b5cf6'],
  }
  const [c1, c2] = colors[ext] ?? colors.default
  const gradId = `og-${name.replace(/[^a-z0-9]/gi, '')}`
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="6" fill={`url(#${gradId})`} />
      <rect x="10" y="8" width="20" height="16" rx="3" fill="rgba(255,255,255,0.25)" />
      <circle cx="20" cy="16" r="5" fill="rgba(255,255,255,0.35)" />
      <text x="20" y="33" textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="7" fontWeight="700">
        {ext.toUpperCase()}
      </text>
    </svg>
  )
}

function ArtworkThumb60({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? 'png'
  const colors: Record<string, [string, string]> = {
    png: ['#0d9488', '#0891b2'],
    ai: ['#f59e0b', '#ef4444'],
    default: ['#6366f1', '#8b5cf6'],
  }
  const [c1, c2] = colors[ext] ?? colors.default
  const gradId = `og60-${name.replace(/[^a-z0-9]/gi, '')}`
  return (
    <svg width="60" height="50" viewBox="0 0 60 50" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </linearGradient>
      </defs>
      <rect width="60" height="50" rx="7" fill={`url(#${gradId})`} />
      <rect x="12" y="8" width="36" height="24" rx="4" fill="rgba(255,255,255,0.22)" />
      <circle cx="30" cy="20" r="8" fill="rgba(255,255,255,0.32)" />
      <text x="30" y="42" textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="8" fontWeight="700">
        {ext.toUpperCase()}
      </text>
    </svg>
  )
}

function calculateItemsTotal(
  orderType: OrderType,
  apparelItems: ApparelItem[],
  gangsheetItems: GangsheetItem[],
  transferItems: TransferItem[],
) {
  if (orderType === 'apparel') {
    return apparelItems.reduce((sum, row) => sum + row.qty * row.unitPrice, 0)
  }

  if (orderType === 'gangsheet') {
    return gangsheetItems.reduce((sum, row) => sum + row.qtySheets * row.pricePerSheet, 0)
  }

  return transferItems.reduce((sum, row) => sum + row.qty * row.unitPrice, 0)
}

function calculateInvoiceTotals({
  itemsTotal,
  rushCharges,
  shippingCharges,
  rushServices,
  discountType,
  discountValue,
}: {
  itemsTotal: number
  rushCharges: number
  shippingCharges: number
  rushServices: number
  discountType: DiscountType
  discountValue: number
}) {
  const subtotal = itemsTotal + rushCharges + shippingCharges + rushServices
  const rawDiscount = discountType === 'percentage' ? subtotal * (discountValue / 100) : discountValue
  const discountAmt = +Math.min(Math.max(rawDiscount, 0), subtotal).toFixed(2)
  const total = +(Math.max(subtotal - discountAmt, 0)).toFixed(2)

  return { subtotal, discountAmt, taxAmt: 0, total }
}

function getInvoiceCounters(
  orderType: OrderType,
  apparelItems: ApparelItem[],
  gangsheetItems: GangsheetItem[],
  transferItems: TransferItem[],
) {
  if (orderType === 'apparel') {
    return {
      totalItems: apparelItems.length,
      totalArtworks: apparelItems.reduce((sum, row) => sum + Number(Boolean(row.front_image)) + Number(Boolean(row.back_image)), 0),
      totalqtySheets: apparelItems.reduce((sum, row) => sum + row.qty, 0),
    }
  }

  if (orderType === 'gangsheet') {
    return {
      totalItems: gangsheetItems.length,
      totalArtworks: gangsheetItems.reduce((sum, row) => sum + row.numArtworks, 0),
      totalqtySheets: gangsheetItems.reduce((sum, row) => sum + row.qtySheets, 0),
    }
  }

  return {
    totalItems: transferItems.length,
    totalArtworks: transferItems.length,
    totalqtySheets: transferItems.reduce((sum, row) => sum + row.qty, 0),
  }
}

// â"€â"€â"€ Componeno â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export function NewInvoicePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()

  // Convert-from-quote context (set when navigated from QuotesListPage)
  const fromQuoteId: string | undefined = (location.state as any)?.fromQuoteId

  // Rates locked from approved quotation
  const [ratesLocked, setRatesLocked] = useState(false)

  // Header / Info
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>('Draft')
  const [isEditing, setIsEditing] = useState(true)
  const [quoteText, setQuoteText] = useState('')
  const [quoteId, setQuoteId] = useState<string>(fromQuoteId ?? '')
  const [invoiceDate, setInvoiceDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [supplierText, setsupplierText] = useState('')
  const [agentText, setAgentText] = useState(user?.name ?? '')

  // Order type
  const [orderType, setOrderType] = useState<OrderType>('apparel')

  // Items
  const [apparelItems, setApparelItems] = useState<ApparelItem[]>([])
  const [gangsheetItems, setGangsheetItems] = useState<GangsheetItem[]>([])
  const [transferItems, setTransferItems] = useState<TransferItem[]>([])

  // Notes
  const [internalNotes, setInternalNotes] = useState('')
  const [supplierNotes, setSupplierNotes] = useState('')

  // Summary
  const [rushCharges, setRushCharges] = useState(0)
  const [shippingCharges, setShippingCharges] = useState(0)
  const [rushServices, setRushServices] = useState(0)
  const [discountType, setDiscountType] = useState<DiscountType>('percentage')
  const [discountValue, setDiscountValue] = useState(0)

  // Customer details
  const [billingEmail,    setBillingEmail]    = useState('')
  const [contactNumber,   setContactNumber]   = useState('')
  const [billingAddress,  setBillingAddress]  = useState('')
  const [shippingAddress, setShippingAddress] = useState('')

  // Payment
  const [paymentTerms, setPaymentTerms] = useState('Due on Receipt')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [currency, setCurrency] = useState('USD - US Dollar')
  const [sendPaymentLink, setSendPaymentLink] = useState(false)
  const [isPaid, setIsPaid] = useState(false)

  // ── Fetch source quote when converting from quote ──────────────────────────
  const { data: sourceQuote } = useQuery({
    queryKey: ['convert-from-quote', fromQuoteId],
    queryFn:  () => api.get(`/quotations/${fromQuoteId}`).then(r => r.data.data ?? r.data),
    enabled:  !!fromQuoteId,
  })

  // Pre-populate form fields from quote once data arrives
  useEffect(() => {
    if (!sourceQuote) return
    // Lock rates if the source quote is Approved
    if (sourceQuote.status === 'Approved') {
      setRatesLocked(true)
    }
    // Supplier / Customer
    if (sourceQuote.supplier_id)   setSupplierId(sourceQuote.supplier_id)
    const supplierName = sourceQuote.customer_name ?? sourceQuote.supplier_name ?? sourceQuote.company_name ?? ''
    if (supplierName) setsupplierText(supplierName)
    if (sourceQuote.billing_email)  setBillingEmail(sourceQuote.billing_email)
    if (sourceQuote.contact_number) setContactNumber(sourceQuote.contact_number)
    if (sourceQuote.billing_address) setBillingAddress(sourceQuote.billing_address)
    if (sourceQuote.shipping_address) setShippingAddress(sourceQuote.shipping_address)
    // Quote ref
    if (sourceQuote.quote_number)  { setQuoteText(sourceQuote.quote_number); setQuoteId(sourceQuote.id) }
    // Order type
    if (sourceQuote.order_type) {
      setOrderType(sourceQuote.order_type as OrderType)
    }
    // Notes
    if (sourceQuote.notes) setInternalNotes(sourceQuote.notes)
    if (sourceQuote.customer_notes) setSupplierNotes(sourceQuote.customer_notes)
    // Totals
    if (sourceQuote.estimated_shipping) setShippingCharges(Number(sourceQuote.estimated_shipping))
    if (sourceQuote.rush_services)    setRushServices(Number(sourceQuote.rush_services))
    if (sourceQuote.payment_method)   setPaymentMethod(sourceQuote.payment_method)
    if (sourceQuote.payment_terms)    setPaymentTerms(sourceQuote.payment_terms)
    if (sourceQuote.discount_pct)     { setDiscountType('percentage'); setDiscountValue(Number(sourceQuote.discount_pct)) }
    else if (sourceQuote.discount_amt && Number(sourceQuote.discount_amt) > 0) {
      setDiscountType('fixed'); setDiscountValue(Number(sourceQuote.discount_amt))
    }
    // Pre-populate items
    const items = sourceQuote.items ?? []
    if (sourceQuote.order_type === 'apparel') {
      setApparelItems(items.map((it: any) => ({
        id: uid(), description: it.description || it.item || '',
        color: it.colors || it.color || '', sizes: it.sizes || it.size || '',
        qty: Number(it.qty) || 1,
        unitPrice: Number(it.unit_price) || 0,
        front_image: it.front_image ?? null,
        back_image:  it.back_image  ?? null,
      })))
    } else if (sourceQuote.order_type === 'dtf') {
      setTransferItems(items.map((it: any) => ({
        id: uid(), ...parseTransferSize(it.size || it.description), qty: Number(it.qty) || 1,
        unitPrice: Number(it.unit_price) || 0,
        artwork_image: it.artwork_image ?? it.front_image ?? null,
      })))
    } else if (sourceQuote.order_type === 'gangsheet') {
      setGangsheetItems(items.map((it: any) => ({
        id: uid(), size: it.size || it.description || '22"x60"',
        numArtworks: Number(it.artwork_count) || 0,
        qtySheets: Number(it.qty) || 1,
        pricePerSheet: Number(it.unit_price) || 18,
        front_image: it.front_image ?? null,
        back_image:  it.back_image  ?? null,
      })))
    }
  }, [sourceQuote])

  // More menu
  const [moreAnchor, setMoreAnchor] = useState<null | HTMLElement>(null)
  const [sendAnchor, setSendAnchor] = useState<null | HTMLElement>(null)

  // After save, navigate to print if preview was triggered — otherwise go to invoice detail
  const navigateAfterSave = useRef<'print' | null>(null)

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (data: any) => api.post('/invoices', data).then(r => r.data.data ?? r.data),
    onSuccess: (inv: any) => {
      if (navigateAfterSave.current === 'print' && inv?.id) {
        navigateAfterSave.current = null
        navigate(`/invoices/${inv.id}/print`)
        return
      }
      navigateAfterSave.current = null
      toast.success('Invoice saved')
      navigate(inv?.id ? `/invoices/${inv.id}` : '/invoices')
    },
    onError: (err: any) => {
      navigateAfterSave.current = null
      toast.error(err.response?.data?.message ?? 'Failed to save invoice')
    },
  })

  // â"€â"€ Compuoed totals â"€â"€
  const itemsTotal = useMemo(
    () => calculateItemsTotal(orderType, apparelItems, gangsheetItems, transferItems),
    [orderType, apparelItems, gangsheetItems, transferItems],
  )

  const { subtotal, discountAmt, taxAmt, total } = useMemo(
    () => calculateInvoiceTotals({
      itemsTotal,
      rushCharges,
      shippingCharges,
      rushServices,
      discountType,
      discountValue,
    }),
    [itemsTotal, rushCharges, shippingCharges, rushServices, discountType, discountValue],
  )

  const invoiceCounoers = useMemo(
    () => getInvoiceCounters(orderType, apparelItems, gangsheetItems, transferItems),
    [orderType, apparelItems, gangsheetItems, transferItems],
  )

  // â"€â"€ Apparel handlers â"€â"€
  const addApparelItem = () =>
    setApparelItems(prev => [...prev, { id: uid(), description: '', color: '', sizes: '', qty: 1, unitPrice: 0, front_image: null, back_image: null }])
  const updateApparelItem = (id: string, patch: Partial<ApparelItem>) =>
    setApparelItems(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  const removeApparelItem = (id: string) => setApparelItems(prev => prev.filter(r => r.id !== id))

  // â"€â"€ Gangsheet handlers â"€â"€
  const addGangsheetItem = () =>
    setGangsheetItems(prev => [...prev, { id: uid(), size: '22"x60"', numArtworks: 0, qtySheets: 1, pricePerSheet: 18 }])
  const updateGangsheetItem = (id: string, patch: Partial<GangsheetItem>) =>
    setGangsheetItems(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  const removeGangsheetItem = (id: string) => setGangsheetItems(prev => prev.filter(r => r.id !== id))

  // â"€â"€ Transfer handlers â"€â"€
  const addTransferItem = () =>
    setTransferItems(prev => [...prev, { id: uid(), width: '', height: '', qty: 1, unitPrice: 0, artwork_image: null }])
  const updateTransferItem = (id: string, patch: Partial<TransferItem>) =>
    setTransferItems(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  const removeTransferItem = (id: string) => setTransferItems(prev => prev.filter(r => r.id !== id))

  // Build items payload based on order type (always — so images are stored)
  const buildItemsPayload = () => {
    if (orderType === 'gangsheet') {
      return gangsheetItems.map((row, i) => ({
        description:   row.size,
        qty:           row.qtySheets,
        unit_price:    row.pricePerSheet,
        amount:        row.qtySheets * row.pricePerSheet,
        artwork_count: row.numArtworks,
        sort_order:    i,
        front_image:   row.front_image || null,
        back_image:    row.back_image  || null,
      }))
    }
    if (orderType === 'apparel') {
      return apparelItems.map((row, i) => ({
        description:   row.description,
        qty:           row.qty,
        unit_price:    row.unitPrice,
        amount:        row.qty * row.unitPrice,
        artwork_count: Number(Boolean(row.front_image)) + Number(Boolean(row.back_image)),
        sizes:          row.sizes || null,
        colors:         row.color || null,
        sort_order:    i,
        front_image:   row.front_image || null,
        back_image:    row.back_image  || null,
      }))
    }
    if (orderType === 'dtf') {
      return transferItems.map((row, i) => ({
        description:   formatTransferSize(row.width, row.height),
        qty:           row.qty,
        unit_price:    row.unitPrice,
        amount:        row.qty * row.unitPrice,
        artwork_count: row.artwork_image ? 1 : 0,
        sort_order:    i,
        artwork_image: row.artwork_image || null,
      }))
    }
    return undefined
  }

  const buildPayload = () => ({
    customer_id:      supplierId || null,
    quote_id:         quoteId || null,
    notes:            internalNotes || null,
    customer_notes:   supplierNotes || null,
    sales_agent_name: agentText || null,
    issue_date:       invoiceDate || null,
    due_date:         dueDate || null,
    subtotal:         subtotal,
    discount_amt:     discountAmt,
    tax_amt:          taxAmt,
    customer_name:    supplierText || null,
    billing_email:    billingEmail || null,
    contact_number:   contactNumber || null,
    billing_address:  billingAddress || null,
    shipping_address: shippingAddress || null,
    order_type:       orderType,
    items:            buildItemsPayload(),
    payment_terms:    paymentTerms || null,
    payment_method:   paymentMethod || null,
    currency:         currency.split(' - ')[0] || 'USD',
    rush_services:    rushServices,
    rush_charges:     rushCharges,
    shipping_charges: shippingCharges,
    discount_type:    discountType,
    discount_value:   discountValue,
  })

  const saveDraft = () => {
    if (!supplierId && !supplierText) {
      toast.error('Please select a customer before saving')
      return
    }
    saveMutation.mutate(buildPayload())
  }

  const previewInvoice = () => {
    if (!supplierId && !supplierText) {
      toast.error('Please select a customer before saving')
      return
    }
    navigateAfterSave.current = 'print'
    saveMutation.mutate(buildPayload())
  }

  const requestApproval = () => { toast.error('Save the invoice first, then update status from the invoice detail page') }

  const sendInvoice = () => { toast.error('Save the invoice first, then update status from the invoice detail page') }

  const togglePaid = () => {
    setIsPaid(prev => {
      const next = !prev
      setInvoiceStatus(next ? 'Paid' : 'Sent')
      return next
    })
  }

  const cancelInvoice = () => {
    if (!window.confirm('Cancel this invoice? The invoice status will be set to Cancelled.')) return
    setInvoiceStatus('Cancelled')
    setIsPaid(false)
  }

  return (
    <div className="ni-page">

      {/* â"€â"€ HEADER â"€â"€ */}
      <div className="ni-header">
        <div>
          <nav className="ni-breadcrumb">
            <span>Invoices</span>
            <span className="ni-bc-sep">/</span>
            <strong>New Invoice</strong>
          </nav>
          <h2 className="ni-page-title">New Invoice</h2>
        </div>
        <div className="ni-header-actions">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button className="lb-action-btn" onClick={previewInvoice}><Eye size={13} /> Preview</button>
          <button className="lb-action-btn lb-action-primary" onClick={saveDraft} style={{ gap: 6 }}><Save size={14} /> Save Invoice</button>
          <button className="lb-action-btn" title={isEditing ? 'Invoice is editable' : 'Edit invoice'} onClick={() => setIsEditing(true)}>
            <Pencil size={13} /> Edit
          </button>
          <button className="lb-action-btn ni-danger-action" onClick={cancelInvoice}>
            Cancel Invoice
          </button>
          <button className="lb-action-btn ni-approval-action" onClick={requestApproval}>
            <UserCheck size={13} /> Request Approval
          </button>
          <button
            className="lb-action-btn"
            onClick={e => setMoreAnchor(e.currentTarget)}
          >
            <MoreHorizontal size={14} /> More Actions <ChevronDown size={12} />
          </button>
          <div className="ni-send-split">
            <button className="lb-action-btn lb-action-primary ni-send-main" onClick={sendInvoice}>
              <Send size={13} /> Send Invoice
            </button>
            <button
              className="lb-action-btn lb-action-primary ni-send-chevron"
              onClick={e => setSendAnchor(e.currentTarget)}
            >
              <ChevronDown size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* â"€â"€ INFO BAR â"€â"€ */}
      <div className="ni-info-bar">
        <div className="ni-info-cell">
          <span className="ni-info-label">Invoice #</span>
          <strong className="ni-info-val ni-teal">AUTO-GENERATED</strong>
          <span className={cn('ni-badge', STATUS_BADGE_CLASS[invoiceStatus])}>{invoiceStatus}</span>
        </div>
        <div className="ni-info-cell ni-info-cell-field">
          <span className="ni-info-label">Quote</span>
          <input className="ni-info-select" value={quoteText} placeholder="Quote #" onChange={e => setQuoteText(e.target.value)} />
        </div>
        <div className="ni-info-cell ni-info-cell-field">
          <span className="ni-info-label">Invoice Date</span>
          <input type="date" className="ni-date-input" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
        </div>
        <div className="ni-info-cell ni-info-cell-field">
          <span className="ni-info-label">Due Date</span>
          <input type="date" className="ni-date-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
        <div className="ni-info-cell ni-info-cell-field">
          <span className="ni-info-label">Customer</span>
          <SupplierCombobox value={supplierText} onChange={(text, id) => { setsupplierText(text); setSupplierId(id) }} />
        </div>
        <div className="ni-info-cell ni-info-cell-field">
          <span className="ni-info-label">Sales Agent</span>
          <div className="ni-agent-select">
            <Avatar sx={{ width: 24, height: 24, fontSize: 10, bgcolor: '#0d9488' }}>
              {agentText.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'AG'}
            </Avatar>
            <input className="ni-info-select ni-agent-dropdown" value={agentText} placeholder="Agent name" onChange={e => setAgentText(e.target.value)} />
          </div>
        </div>
      </div>

      {/* â"€â"€ ORDER TYPE SELECTOR â"€â"€ */}
      <div className="ni-type-selector">
        <span className="ni-type-label">Order Type</span>
        <div className="ni-type-pills">
          {(['apparel', 'gangsheet', 'dtf'] as OrderType[]).map(o => (
            <button
              key={o}
              className={cn('ni-type-pill', orderType === o && 'ni-type-pill-active')}
              onClick={() => setOrderType(o)}
            >
              {o === 'apparel' && 'Custom Printed Apparel'}
              {o === 'gangsheet' && 'DTF Gangsheet'}
              {o === 'dtf' && 'DTF Transfers'}
            </button>
          ))}
        </div>
      </div>

      {/* â"€â"€ TWO COLUMN LAYOUT â"€â"€ */}
      <div className="ni-layout">

        {/* â"€â"€ LEFT COLUMN â"€â"€ */}
        <main className="ni-main">

          {/* Customer / Address */}
          <div className="ni-card ni-section">
            <div className="ni-section-heading">
              <span className="ni-section-num">1</span>
              <h3>Customer / Address</h3>
            </div>
            <div className="ni-address-grid">
              <div className="ni-address-block">
                <p className="ni-addr-block-title">Customer Info</p>
                <input
                  className="al-input"
                  style={{ fontSize: 13, marginBottom: 4 }}
                  value={supplierText}
                  onChange={e => setsupplierText(e.target.value)}
                  placeholder="Customer name..."
                />
                <input
                  className="al-input"
                  type="email"
                  style={{ fontSize: 13, marginBottom: 4 }}
                  value={billingEmail}
                  onChange={e => setBillingEmail(e.target.value)}
                  placeholder="Email address (optional)"
                />
                <input
                  className="al-input"
                  style={{ fontSize: 13 }}
                  value={contactNumber}
                  onChange={e => setContactNumber(e.target.value)}
                  placeholder="Phone / WhatsApp (optional)"
                />
              </div>
              <div className="ni-address-block">
                <p className="ni-addr-block-title">Billing Address</p>
                <textarea className="al-textarea" rows={3} placeholder="Enter billing address..." style={{ fontSize: 13 }} value={billingAddress} onChange={e => setBillingAddress(e.target.value)} />
              </div>
              <div className="ni-address-block">
                <p className="ni-addr-block-title">Shipping Address</p>
                <textarea className="al-textarea" rows={3} placeholder="Enter shipping address..." style={{ fontSize: 13 }} value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Quote Summary Panel — shown only when converting from a quote */}
          {sourceQuote && (
            <div className="ni-card ni-ai-panel">
              <div className="ni-ai-header">
                <div className="ni-ai-title">
                  <FileText size={16} className="ni-ai-icon" />
                  <strong>From Quotation: {sourceQuote.quote_number ?? ''}</strong>
                </div>
                <span className="ni-badge ni-badge-green">auto-filled</span>
              </div>
              <div className="ni-ai-items">
                {[
                  { label: 'Customer', value: sourceQuote.customer_name ?? sourceQuote.supplier_name ?? '—' },
                  { label: 'Order Type', value: String(sourceQuote.order_type ?? '—') },
                  { label: 'Items', value: String(Array.isArray(sourceQuote.items) ? sourceQuote.items.length : '—') },
                  { label: 'Subtotal', value: sourceQuote.subtotal != null ? `$${Number(sourceQuote.subtotal).toFixed(2)}` : '—' },
                  { label: 'Total', value: sourceQuote.total != null ? `$${Number(sourceQuote.total).toFixed(2)}` : '—' },
                  sourceQuote.customer_requirement_summary
                    ? { label: 'Requirements', value: String(sourceQuote.customer_requirement_summary) }
                    : null,
                ].filter(Boolean).map((item: any) => (
                  <div key={item.label} className="ni-ai-item">
                    <Check size={13} className="ni-ai-check" />
                    <span className="ni-ai-label">{item.label}:</span>
                    <strong className="ni-ai-val">{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Items Table */}
          <div className="ni-card ni-section">
            <div className="ni-section-heading">
              <span className="ni-section-num">2</span>
              <h3>Invoice Items</h3>
            </div>

            {ratesLocked && (
              <div className="ni-rates-locked-notice" style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 13, color: '#713f12' }}>
                Rates are locked from the approved quotation. To change rates, revise and re-approve the quotation first.
              </div>
            )}

            {/* -- Custom Printed Apparel -- */}
            {orderType === 'apparel' && (
              <>
                <div className="ni-table-wrap">
                  <table className="ni-table ni-mobile-stack-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>#</th>
                        <th>Item Description <small>Brand | Model</small></th>
                        <th>Color</th>
                        <th>Qty (Shirts)</th>
                        <th>Sizes <small>Size Ratio</small></th>
                        <th>Front Artwork</th>
                        <th>Back Artwork</th>
                        <th>Unit Price (USD)</th>
                        <th>Total Amount (USD)</th>
                        <th style={{ width: 36 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {apparelItems.map((row, i) => (
                        <tr key={row.id}>
                          <td className="ni-od-num" data-label="S.No">{i + 1}</td>
                          <td data-label="Item Description"><textarea rows={2} className="ni-table-input ni-wide-input ni-description-input" value={row.description} onChange={e => updateApparelItem(row.id, { description: e.target.value })} placeholder="T-Shirt Premium — Gildan | 18500" /></td>
                          <td data-label="Color">
                            <input className="ni-table-input" value={row.color} onChange={e => updateApparelItem(row.id, { color: e.target.value })} />
                          </td>
                          <td data-label="Qty (Shirts)">
                            <input type="number" className="ni-table-input ni-num-input" min={0} value={row.qty} onFocus={e => e.target.select()} onChange={e => updateApparelItem(row.id, { qty: +e.target.value })} />
                          </td>
                          <td data-label="Sizes"><input className="ni-table-input ni-wide-input" value={row.sizes} onChange={e => updateApparelItem(row.id, { sizes: e.target.value })} placeholder="S:10, M:20, L:15" /></td>
                          <td data-label="Front Artwork"><InvoiceArtworkUpload imageUrl={row.front_image} label="Front" onChange={url => updateApparelItem(row.id, { front_image: url })} /></td>
                          <td data-label="Back Artwork"><InvoiceArtworkUpload imageUrl={row.back_image} label="Back" onChange={url => updateApparelItem(row.id, { back_image: url })} /></td>
                          <td data-label="Unit Price">
                            {ratesLocked ? (
                              <span className="ni-price-locked">${fmt(row.unitPrice)}</span>
                            ) : (
                              <div className="ni-price-cell">
                                <span>$</span>
                                <input type="number" min={0} step={0.01} className="ni-price-input" value={row.unitPrice} onFocus={e => e.target.select()} onChange={e => updateApparelItem(row.id, { unitPrice: +e.target.value })} />
                              </div>
                            )}
                          </td>
                          <td className="ni-amount" data-label="Amount">${fmt(row.qty * row.unitPrice)}</td>
                          <td data-label="Action">
                            <button className="ni-del-btn" onClick={() => removeApparelItem(row.id)}><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="live-summary-row">
                      <td colSpan={3}><span className="live-summary-title">Apparel Summary</span></td>
                      <td><div className="live-summary-stat"><span>Total Qty</span><strong>{invoiceCounoers.totalqtySheets}</strong></div></td>
                      <td></td>
                      <td colSpan={2}><div className="live-summary-stat"><span>Total Artworks</span><strong>{invoiceCounoers.totalArtworks}</strong></div></td>
                      <td></td>
                      <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(itemsTotal)}</strong></div></td>
                      <td></td>
                    </tr></tfoot>
                  </table>
                </div>
                <button className="ni-add-item-btn" onClick={addApparelItem}>
                  <Plus size={13} /> Add Item
                </button>
              </>
            )}

            {/* â"€â"€ DTF Gangsheet â"€â"€ */}
            {orderType === 'gangsheet' && (
              <>
                <div className="ni-table-wrap">
                  <table className="ni-table ni-mobile-stack-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>#</th>
                        <th>Gangsheet Size</th>
                        <th>No. Artworks</th>
                        <th>Qty Sheets</th>
                        <th>Front Artwork</th>
                        <th>Back Artwork</th>
                        <th>Unit Price (USD)</th>
                        <th>Total Amount (USD)</th>
                        <th style={{ width: 36 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {gangsheetItems.map((row, i) => (
                        <tr key={row.id}>
                          <td className="ni-od-num" data-label="S.No">{i + 1}</td>
                          <td data-label="Gangsheet Size">
                            {GS_SIZES.includes(row.size) ? (
                              <select className="ni-table-select" value={row.size} onChange={e => updateGangsheetItem(row.id, { size: e.target.value === '__custom__' ? '' : e.target.value })}>
                                {GS_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                                <option value="__custom__">Custom...</option>
                              </select>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input
                                  className="ni-table-input"
                                  style={{ width: 88 }}
                                  placeholder='e.g. 36"x60"'
                                  value={row.size}
                                  onChange={e => updateGangsheetItem(row.id, { size: e.target.value })}
                                  autoFocus
                                />
                                <button type="button" title="Back to list" onClick={() => updateGangsheetItem(row.id, { size: '22"x60"' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 13, lineHeight: 1 }}>✕</button>
                              </div>
                            )}
                          </td>
                          <td data-label="No. Artworks">
                            <input type="number" className="ni-table-input ni-num-input" min={0} value={row.numArtworks} onChange={e => updateGangsheetItem(row.id, { numArtworks: +e.target.value })} />
                          </td>
                          <td data-label="qty Sheets">
                            <input type="number" className="ni-table-input ni-num-input" min={1} value={row.qtySheets} onChange={e => updateGangsheetItem(row.id, { qtySheets: +e.target.value })} />
                          </td>
                          <td data-label="Front Artwork"><InvoiceArtworkUpload imageUrl={row.front_image} label="Front" onChange={url => updateGangsheetItem(row.id, { front_image: url })} /></td>
                          <td data-label="Back Artwork"><InvoiceArtworkUpload imageUrl={row.back_image} label="Back" onChange={url => updateGangsheetItem(row.id, { back_image: url })} /></td>
                          <td data-label="Price / Sheet">
                            {ratesLocked ? (
                              <span className="ni-price-locked">${fmt(row.pricePerSheet)}</span>
                            ) : (
                              <div className="ni-price-cell">
                                <span>$</span>
                                <input type="number" min={0} step={0.01} className="ni-price-input" value={row.pricePerSheet} onChange={e => updateGangsheetItem(row.id, { pricePerSheet: +e.target.value })} />
                              </div>
                            )}
                          </td>
                          <td className="ni-amount" data-label="Amount">${fmt(row.qtySheets * row.pricePerSheet)}</td>
                          <td data-label="Action">
                            <button className="ni-del-btn" onClick={() => removeGangsheetItem(row.id)}><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="live-summary-row">
                      <td colSpan={2}><span className="live-summary-title">Gangsheet Summary</span></td>
                      <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{gangsheetItems.reduce((sum, row) => sum + row.numArtworks, 0)}</strong></div></td>
                      <td><div className="live-summary-stat"><span>Total Sheets</span><strong>{invoiceCounoers.totalqtySheets}</strong></div></td>
                      <td colSpan={3}></td>
                      <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(itemsTotal)}</strong></div></td>
                      <td></td>
                    </tr></tfoot>
                  </table>
                </div>
                <button className="ni-add-item-btn" onClick={addGangsheetItem}>
                  <Plus size={13} /> Add Item
                </button>

              </>
            )}

            {/* -- DTF Transfers -- */}
            {orderType === 'dtf' && (
              <>
                <div className="ni-table-wrap">
                  <table className="ni-table ni-mobile-stack-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>#</th>
                        <th>Width (in)</th>
                        <th>Height (in)</th>
                        <th>Qty</th>
                        <th>Artwork</th>
                        <th>Unit Price (USD)</th>
                        <th>Total Amount (USD)</th>
                        <th style={{ width: 36 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {transferItems.map((row, i) => (
                        <tr key={row.id}>
                          <td className="ni-od-num" data-label="S.No">{i + 1}</td>
                          <td data-label="Width (in)"><input type="number" min={0} step="any" className="ni-table-input ni-num-input" value={row.width} onChange={e => updateTransferItem(row.id, { width: e.target.value })} placeholder="Width" /></td>
                          <td data-label="Height (in)"><input type="number" min={0} step="any" className="ni-table-input ni-num-input" value={row.height} onChange={e => updateTransferItem(row.id, { height: e.target.value })} placeholder="Height" /></td>
                          <td data-label="Qty">
                            <input type="number" className="ni-table-input ni-num-input" min={0} value={row.qty} onChange={e => updateTransferItem(row.id, { qty: +e.target.value })} />
                          </td>
                          <td data-label="Artwork"><InvoiceArtworkUpload imageUrl={row.artwork_image} label="Artwork" onChange={url => updateTransferItem(row.id, { artwork_image: url })} /></td>
                          <td data-label="Amount">
                            {ratesLocked ? (
                              <span className="ni-price-locked">${fmt(row.unitPrice)}</span>
                            ) : (
                              <div className="ni-price-cell">
                                <span>$</span>
                                <input type="number" min={0} step={0.01} className="ni-price-input" value={row.unitPrice} onChange={e => updateTransferItem(row.id, { unitPrice: +e.target.value })} />
                              </div>
                            )}
                          </td>
                          <td className="ni-amount" data-label="Line Total">${fmt(row.qty * row.unitPrice)}</td>
                          <td data-label="Action">
                            <button className="ni-del-btn" onClick={() => removeTransferItem(row.id)}><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="live-summary-row">
                      <td colSpan={3}><span className="live-summary-title">DTF Summary</span></td>
                      <td><div className="live-summary-stat"><span>Total Qty</span><strong>{invoiceCounoers.totalqtySheets}</strong></div></td>
                      <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{invoiceCounoers.totalArtworks}</strong></div></td>
                      <td></td>
                      <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(itemsTotal)}</strong></div></td>
                      <td></td>
                    </tr></tfoot>
                  </table>
                </div>
                <button className="ni-add-item-btn" onClick={addTransferItem}>
                  <Plus size={13} /> Add Item
                </button>
              </>
            )}
          </div>

          {/* Notes */}
          <div className="ni-card ni-section">
            <div className="ni-section-heading">
              <span className="ni-section-num">{orderType === 'gangsheet' ? '4' : '3'}</span>
              <h3>Notes</h3>
            </div>
            <div className="ni-notes-grid">
              <div className="ni-notes-field">
                <label className="ni-notes-label">Internal Notes</label>
                <textarea
                  className="ni-textarea"
                  rows={3}
                  placeholder="Internal use only..."
                  value={internalNotes}
                  onChange={e => setInternalNotes(e.target.value)}
                />
              </div>
              <div className="ni-notes-field">
                <label className="ni-notes-label">
                  Customer Notes <small>(visible to customer)</small>
                </label>
                <textarea
                  className="ni-textarea"
                  rows={3}
                  placeholder="Thank you for your business!"
                  value={supplierNotes}
                  onChange={e => setSupplierNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

        </main>

        {/* â"€â"€ RIGHT SIDEBAR â"€â"€ */}
        <aside className="ni-sidebar">

          {/* Invoice Summary */}
          <div className="ni-card ni-summary-card">
            <h3 className="ni-sidebar-title">Invoice Summary</h3>
            <div className="ni-summary-rows">
              <div className="ni-summary-row">
                <span>Items Total</span>
                <strong>${fmt(itemsTotal)}</strong>
              </div>
              <div className="ni-summary-row">
                <span>Rush Charges</span>
                <div className="ni-inline-input">
                  <span>$</span>
                  <input type="number" min={0} step={0.01} value={rushCharges} onChange={e => setRushCharges(+e.target.value)} />
                </div>
              </div>
              <div className="ni-summary-row">
                <span>Shipping Charges</span>
                <div className="ni-inline-input">
                  <span>$</span>
                  <input type="number" min={0} step={0.01} value={shippingCharges} onChange={e => setShippingCharges(+e.target.value)} />
                </div>
              </div>
              <div className="ni-summary-row">
                <span>Rush Services</span>
                <div className="ni-inline-input">
                  <span>$</span>
                  <input type="number" min={0} step={0.01} value={rushServices} onChange={e => setRushServices(+e.target.value)} />
                </div>
              </div>
              <div className="ni-summary-row ni-summary-subtotal">
                <span>Subtotal</span>
                <strong>${fmt(subtotal)}</strong>
              </div>
              <div className="ni-summary-row">
                <span>Discount</span>
                <div className="ni-discount-row">
                  <select className="ni-discount-type" value={discountType} onChange={e => setDiscountType(e.target.value as DiscountType)}>
                    <option value="percentage">%</option>
                    <option value="fixed">$</option>
                  </select>
                  <div className="ni-pct-input">
                    <input type="number" min={0} max={discountType === 'percentage' ? 100 : undefined} value={discountValue} onChange={e => setDiscountValue(+e.target.value)} />
                    <span>{discountType === 'percentage' ? '%' : '$'}</span>
                  </div>
                  <strong className="ni-discount-amt">-${fmt(discountAmt)}</strong>
                </div>
              </div>
            </div>
            <div className="ni-total-row">
              <span>Total</span>
              <strong className="ni-total-val">${fmt(total)}</strong>
            </div>
          </div>

          {/* Payment Information */}
          <div className="ni-card ni-payment-card">
            <h3 className="ni-sidebar-title">Payment Information</h3>
            <div className="ni-payment-fields">
              <div className="ni-payment-field">
                <label className="ni-payment-label">Payment Terms</label>
                <select className="ni-select" value={paymentTerms} onChange={e => {
                  const val = e.target.value
                  setPaymentTerms(val)
                  if (val === 'Paid') {
                    setIsPaid(true)
                    setInvoiceStatus('Paid')
                  } else if (isPaid) {
                    setIsPaid(false)
                    setInvoiceStatus('Sent')
                  }
                }}>
                  <option>Net 15</option>
                  <option>Net 30</option>
                  <option>Due on Receipt</option>
                  <option>Paid</option>
                </select>
              </div>
              <div className="ni-payment-field">
                <label className="ni-payment-label">Payment Method</label>
                <select className="ni-select" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  <option value="cashapp">Cashapp</option>
                  <option value="zelle">Zelle</option>
                  <option value="paypal">PayPal</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="ni-payment-field">
                <label className="ni-payment-label">Currency</label>
                <select className="ni-select" value={currency} onChange={e => setCurrency(e.target.value)}>
                  <option>USD - US Dollar</option>
                  <option>CAD - Canadian Dollar</option>
                  <option>GBP - Pound Sterling</option>
                </select>
              </div>
              <div className="ni-payment-field">
                <label className="ni-payment-label">Payment Link</label>
                <div className="ni-link-row">
                  <input className="ni-link-input" readOnly placeholder="Generated after saving invoice" value="" />
                </div>
              </div>
              <label className="ni-checkbox-row">
                <input
                  type="checkbox"
                  checked={sendPaymentLink}
                  onChange={e => setSendPaymentLink(e.target.checked)}
                />
                <span>Send payment link to customer</span>
              </label>
              <div className="ni-payment-status-row">
                <span className={cn('ni-badge', isPaid ? 'ni-badge-green' : 'ni-badge-red')}>
                  {isPaid ? 'Paid' : 'Unpaid'}
                </span>
                <button
                  className={cn('ni-mark-paid-btn', isPaid && 'ni-mark-paid-btn-active')}
                  onClick={togglePaid}
                >
                  {isPaid ? <Check size={13} /> : null}
                  {isPaid ? 'Marked Paid' : 'Mark as Paid'}
                </button>
              </div>
            </div>
          </div>

        </aside>
      </div>

      {/* â"€â"€ BOTTOM BAR â"€â"€ */}
      <div className="ni-bottom-bar">
        <div className="ni-bottom-left">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button className="lb-action-btn lb-action-primary" onClick={saveDraft} style={{ gap: 6 }}><Save size={14} /> Save Invoice</button>
          <button className="lb-action-btn" onClick={previewInvoice}><Eye size={13} /> Preview</button>
        </div>
        <div className="ni-bottom-right">
          <div className="ni-send-split">
            <button className="lb-action-btn lb-action-primary ni-send-main" onClick={sendInvoice}>
              <Send size={13} /> Send Invoice
            </button>
            <button
              className="lb-action-btn lb-action-primary ni-send-chevron"
              onClick={e => setSendAnchor(e.currentTarget)}
            >
              <ChevronDown size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* More Actions menu */}
      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        <MenuItem onClick={() => { setInvoiceStatus('Approved'); toast.success('Invoice approved'); setMoreAnchor(null) }}>Mark Approved</MenuItem>
        <MenuItem onClick={() => { copyText(JSON.stringify({ supplierText, invoiceStatus }), 'Invoice link copied'); setMoreAnchor(null) }}>Duplicate Invoice</MenuItem>
        <MenuItem onClick={() => { toast.info('Template feature coming soon'); setMoreAnchor(null) }}>Apply Template</MenuItem>
        <MenuItem onClick={() => { previewInvoice(); setMoreAnchor(null) }}>Export PDF</MenuItem>
        <MenuItem onClick={() => { previewInvoice(); setMoreAnchor(null) }}>Print Invoice</MenuItem>
      </Menu>

      {/* Send split menu */}
      <Menu anchorEl={sendAnchor} open={Boolean(sendAnchor)} onClose={() => setSendAnchor(null)}>
        <MenuItem onClick={() => { sendInvoice(); setSendAnchor(null) }}>
          <Mail size={14} /> Send via Email
        </MenuItem>
        <MenuItem onClick={() => { sendInvoice(); setSendAnchor(null) }}>
          <MessageCircle size={14} /> Send to Messenger
        </MenuItem>
      </Menu>

    </div>
  )
}

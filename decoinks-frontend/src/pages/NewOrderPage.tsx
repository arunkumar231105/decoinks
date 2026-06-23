import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronDown, Edit3, Plus, Send, Trash2, X, Check } from 'lucide-react'
import { Menu, MenuItem } from '@mui/material'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'

// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// Types
// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

type OrderType = 'apparel' | 'gangsheet' | 'dtf'
type PaymentStatus = 'Unpaid' | 'Partial' | 'Paid' | 'Refunded'

interface Supplier {
  id: string; name: string; email: string; phone: string; company?: string
  address_line1?: string; address_line2?: string; city?: string; state?: string; zip?: string; country?: string
}
interface Agent { id: string; name: string; role: string }

interface ApparelItem {
  id: string; item: string; color: string; size: string; qty: number
  artworkNo: string; artworkSize: string; unitPrice: number
  frontImage?: string | null; backImage?: string | null
}
interface GangsheetItem { id: string; size: string; noArtworks: number; qty: number; pricePerSheet: number; frontImage?: string | null; backImage?: string | null }
interface DtfItem { id: string; artworkName: string; size: string; qty: number; unitPrice: number; artworkImage?: string | null; frontImage?: string | null; backImage?: string | null }

// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// Helpers
// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

const uid = () => Math.random().toString(36).slice(2, 9)
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const todayISO = () => new Date().toISOString().split('T')[0]

const ITEMS = ['T-Shirt (Premium)', 'Hoodie', 'Cap', 'Sweatshirt', 'Polo Shirt', 'Tank Top']
const COLORS = ['White', 'Black', 'Navy Blue', 'Grey', 'Red', 'Forest Green']
const SIZES = ['S', 'M', 'L', 'XL', '2XL', 'One Size']
const GS_SIZES = ['22" x 60"', '22" x 120"', '13" x 19"', '22" x 36"']
const DTF_SIZES = ['4 x 4 in', '6 x 6 in', '8 x 10 in', '10 x 12 in', '12 x 16 in', '13 x 17 in']
const PAYMENT_TERMS = ['Due on Receipt', 'Net 15', 'Net 30', 'Net 60']
const PAYMENT_STATUSES: PaymentStatus[] = ['Unpaid', 'Partial', 'Paid', 'Refunded']

const PAYMENT_STATUS_STYLES: Record<PaymentStatus, { bg: string; color: string }> = {
  Unpaid:   { bg: '#fef2f2', color: '#dc2626' },
  Partial:  { bg: '#fef9c3', color: '#ca8a04' },
  Paid:     { bg: '#f0fdf4', color: '#16a34a' },
  Refunded: { bg: '#f5f3ff', color: '#7c3aed' },
}

const initApparel  = (): ApparelItem[]   => [{ id: uid(), item: 'T-Shirt (Premium)', color: 'White', size: 'M', qty: 1, artworkNo: '', artworkSize: '', unitPrice: 0 }]
const initGangsheet= (): GangsheetItem[] => [{ id: uid(), size: '', noArtworks: 1, qty: 1, pricePerSheet: 0 }]
const initDtf      = (): DtfItem[]       => [{ id: uid(), artworkName: '', size: '', qty: 1, unitPrice: 0 }]

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
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) { onUpload(f); e.target.value = '' } }} />
      {imageUrl ? (
        <div className="nq-img-thumb-wrap">
          <img src={imageUrl} className="nq-img-thumb" alt={label} />
          <button className="nq-img-remove" onClick={e => { e.stopPropagation(); onRemove() }}><X size={8} /></button>
        </div>
      ) : (
        <div className="nq-img-placeholder" onClick={() => inputRef.current?.click()}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <rect width="20" height="20" rx="4" fill="#e2e8f0" />
            <path d="M4 14l4-4 3 3 2-2 3 3" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="7" cy="7" r="1.5" fill="#94a3b8" />
          </svg>
          <span>{label}</span>
        </div>
      )}
    </div>
  )
}

// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// Main component
// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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
  const [supplierId, setSupplierId]       = useState<string | null>(null)
  const [supplierText, setSupplierText]   = useState('')
  const [supplierOpen, setSupplierOpen]   = useState(false)
  const [agentId, setAgentId] = useState('')
  const [orderDate, setOrderDate] = useState(todayISO())
  const [orderType, setOrderType] = useState<OrderType>(fromOrderType ?? 'apparel')

  // Table data
  const [apparel,   setApparel]   = useState<ApparelItem[]>(initApparel)
  const [gangsheet, setGangsheet] = useState<GangsheetItem[]>(initGangsheet)
  const [dtf,       setDtf]       = useState<DtfItem[]>(initDtf)

  // Payment
  const [paymentTerms,   setPaymentTerms]   = useState(PAYMENT_TERMS[0])
  const [paymentMethod,  setPaymentMethod]  = useState<string>('zelle')
  const [paymentStatus,  setPaymentStatus]  = useState<PaymentStatus>('Unpaid')

  // Dates
  const [dueDate, setDueDate] = useState('')

  // Pricing
  const [rushServices,    setRushServices]    = useState(0)
  const [shippingCharges, setShippingCharges] = useState(0)
  const [discountPct,     setDiscountPct]     = useState(0)

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

  // Image uploads
  const [uploadingImg, setUploadingImg] = useState<Record<string, boolean>>({})
  const uploadItemImage = async (
    rowId: string,
    field: 'frontImage' | 'backImage' | 'artworkImage',
    file: File,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updater: (id: string, patch: any) => void
  ) => {
    setUploadingImg(prev => ({ ...prev, [`${rowId}-${field}`]: true }))
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post('/upload/image', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      updater(rowId, { [field]: res.data.url })
    } catch {
      toast.error('Image upload failed')
    } finally {
      setUploadingImg(prev => ({ ...prev, [`${rowId}-${field}`]: false }))
    }
  }

  // ── Fetch existing order when editing ────────────────────────────────────
  const { data: existingOrder } = useQuery({
    queryKey: ['edit-order', editOrderId],
    queryFn:  () => api.get(`/orders/${editOrderId}`).then(r => r.data.data),
    enabled:  !!editOrderId,
  })

  useEffect(() => {
    if (!existingOrder) return
    setOrderType(existingOrder.order_type as OrderType)
    setSupplierId(existingOrder.supplier_id ?? null)
    setSupplierText(existingOrder.supplier_name ?? '')
    setOrderDate(existingOrder.order_date?.slice(0, 10) ?? todayISO())
    setDueDate(existingOrder.due_date?.slice(0, 10) ?? '')
    setPaymentTerms(existingOrder.payment_terms ?? PAYMENT_TERMS[0])
    setPaymentMethod(existingOrder.payment_method ?? 'zelle')
    setPaymentStatus((existingOrder.payment_status ?? 'Unpaid') as PaymentStatus)
    setCurrency(existingOrder.currency ?? 'USD')
    setRushServices(Number(existingOrder.rush_services ?? 0))
    setShippingCharges(Number(existingOrder.shipping_charges ?? 0))
    setDiscountPct(Number(existingOrder.discount_pct ?? 0))
    setContactName(existingOrder.contact_name ?? '')
    setContactEmail(existingOrder.contact_email ?? '')
    setContactPhone(existingOrder.contact_phone ?? '')
    setShippingName(existingOrder.shipping_name ?? '')
    setShippingAddress(existingOrder.shipping_address ?? '')
    setOrderNotes(existingOrder.notes ?? '')
    setAgentId(existingOrder.assigned_to ?? '')

    const items = existingOrder.items ?? []
    if (existingOrder.order_type === 'apparel') {
      setApparel(items.map((r: any) => ({ id: uid(), item: r.item ?? '', color: r.color ?? 'Black', size: r.size ?? 'M', qty: Number(r.qty), artworkNo: r.artwork_no ?? '', artworkSize: r.artwork_size ?? '', unitPrice: Number(r.unit_price), frontImage: r.front_image ?? null, backImage: r.back_image ?? null })))
    } else if (existingOrder.order_type === 'gangsheet') {
      setGangsheet(items.map((r: any) => ({ id: uid(), size: r.size ?? '', noArtworks: Number(r.no_artworks ?? 1), qty: Number(r.qty), pricePerSheet: Number(r.price_per_sheet), frontImage: r.front_image ?? null, backImage: r.back_image ?? null })))
    } else {
      setDtf(items.map((r: any) => ({ id: uid(), artworkName: r.artwork_name ?? '', size: r.size ?? '', qty: Number(r.qty), unitPrice: Number(r.unit_price), artworkImage: r.artwork_image ?? null, frontImage: r.front_image ?? r.artwork_image ?? null, backImage: r.back_image ?? null })))
    }
  }, [existingOrder])

  // ── Fetch source invoice when converting from invoice ────────────────────
  const { data: sourceInvoice } = useQuery({
    queryKey: ['convert-from-invoice', fromInvoiceId],
    queryFn:  () => api.get(`/invoices/${fromInvoiceId}`).then(r => r.data.data ?? r.data),
    enabled:  !!fromInvoiceId,
  })

  // Fetch linked quotation to get items
  const { data: sourceQuote } = useQuery({
    queryKey: ['convert-from-quote', sourceInvoice?.quote_id],
    queryFn:  () => api.get(`/quotations/${sourceInvoice!.quote_id}`).then(r => r.data.data ?? r.data),
    enabled:  !!sourceInvoice?.quote_id,
  })

  useEffect(() => {
    if (!sourceInvoice) return
    if (sourceInvoice.supplier_id) setSupplierId(sourceInvoice.supplier_id)
    const custName = sourceInvoice.customer_name || sourceInvoice.supplier_name || ''
    if (custName) { setSupplierText(custName); setContactName(custName); setShippingName(custName) }
    if (sourceInvoice.billing_email)    setContactEmail(sourceInvoice.billing_email)
    if (sourceInvoice.contact_number)   setContactPhone(sourceInvoice.contact_number)
    if (sourceInvoice.shipping_address) setShippingAddress(sourceInvoice.shipping_address)
    if (sourceInvoice.payment_method)   setPaymentMethod(sourceInvoice.payment_method)
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
      description: string; qty: number; unit_price: number
      sizes?: string | null; colors?: string | null; artwork_count?: number | null
    }>
    if (type === 'apparel') {
      setApparel(qItems.map(it => ({
        id:          uid(),
        item:        it.description || 'T-Shirt (Premium)',
        color:       it.colors     ?? '',
        size:        it.sizes      ?? '',
        qty:         Number(it.qty),
        artworkNo:   '',
        artworkSize: '',
        unitPrice:   Number(it.unit_price),
        frontImage:  (it as any).front_image ?? null,
        backImage:   (it as any).back_image  ?? null,
      })))
    } else if (type === 'gangsheet') {
      setGangsheet(qItems.map(it => ({
        id:            uid(),
        size:          it.sizes ?? it.description ?? '',
        noArtworks:    Number(it.artwork_count ?? 1),
        qty:           Number(it.qty),
        pricePerSheet: Number(it.unit_price),
        frontImage:    (it as any).front_image ?? null,
        backImage:     (it as any).back_image  ?? null,
      })))
    } else {
      setDtf(qItems.map(it => ({
        id:            uid(),
        artworkName:   it.description ?? '',
        size:          it.sizes ?? '',
        qty:           Number(it.qty),
        unitPrice:     Number(it.unit_price),
        artworkImage:  (it as any).front_image ?? (it as any).artwork_image ?? null,
        frontImage:    (it as any).front_image ?? (it as any).artwork_image ?? null,
        backImage:     (it as any).back_image  ?? null,
      })))
    }
  }, [sourceQuote])

  // ── Load customers & agents ──
  const { data: supplierData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers', { params: { limit: 200 } }).then(r => r.data.data.rows as Supplier[]),
  })
  const suppliers: Supplier[] = supplierData ?? []

  const { data: agentData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users', { params: { limit: 100 } }).then(r => r.data.data.rows as Agent[]),
  })
  const agents: Agent[] = agentData ?? []

  // Set default agent once list loads (no auto-select for customer)


  useEffect(() => {
    if (agents.length && !agentId) {
      const match = agents.find(u => u.id === me?.id)
      setAgentId(match?.id ?? agents[0]?.id ?? '')
    }
  }, [agents, me?.id])

  // Auto-fill contact/shipping when a supplier is selected from suggestions
  useEffect(() => {
    if (!supplierId) return
    const c = suppliers.find(x => x.id === supplierId)
    if (!c) return
    setContactName(c.name)
    setContactEmail(c.email ?? '')
    setContactPhone(c.phone ?? '')
    setShippingName(c.name)
    const addrParts = [c.address_line1, c.address_line2, c.city, c.state && c.zip ? `${c.state} ${c.zip}` : (c.state ?? c.zip), c.country].filter(Boolean)
    setShippingAddress(addrParts.join(', '))
    setEditingContact(false)
    setEditingShipping(false)
  }, [supplierId])

  // â"€â"€ Derived totals â"€â"€
  const itemsTotal  = useMemo(() => {
    if (orderType === 'apparel')   return apparel.reduce((s, r) => s + r.unitPrice * r.qty, 0)
    if (orderType === 'gangsheet') return gangsheet.reduce((s, r) => s + r.pricePerSheet * r.qty, 0)
    return dtf.reduce((s, r) => s + r.unitPrice * r.qty, 0)
  }, [orderType, apparel, gangsheet, dtf])

  const subtotal    = useMemo(() => itemsTotal + rushServices + shippingCharges, [itemsTotal, rushServices, shippingCharges])
  const discountAmt = useMemo(() => +(subtotal * (discountPct / 100)).toFixed(2), [subtotal, discountPct])
  const total       = useMemo(() => +(subtotal - discountAmt).toFixed(2), [subtotal, discountAmt])

  // â"€â"€ Table helpers â"€â"€
  const updateApparel  = (id: string, p: Partial<ApparelItem>)   => setApparel(prev => prev.map(r => r.id === id ? { ...r, ...p } : r))
  const removeApparel  = (id: string) => setApparel(prev => prev.filter(r => r.id !== id))
  const addApparel     = () => setApparel(prev => [...prev, { id: uid(), item: 'T-Shirt (Premium)', color: 'Black', size: 'M', qty: 1, artworkNo: '', artworkSize: '', unitPrice: 0 }])

  const updateGangsheet= (id: string, p: Partial<GangsheetItem>) => setGangsheet(prev => prev.map(r => r.id === id ? { ...r, ...p } : r))
  const removeGangsheet= (id: string) => setGangsheet(prev => prev.filter(r => r.id !== id))
  const addGangsheet   = () => setGangsheet(prev => [...prev, { id: uid(), size: '22" x 60"', noArtworks: 1, qty: 1, pricePerSheet: 0 }])

  const updateDtf      = (id: string, p: Partial<DtfItem>)       => setDtf(prev => prev.map(r => r.id === id ? { ...r, ...p } : r))
  const removeDtf      = (id: string) => setDtf(prev => prev.filter(r => r.id !== id))
  const addDtf         = () => setDtf(prev => [...prev, { id: uid(), artworkName: '', size: '12 x 16 in', qty: 1, unitPrice: 0 }])

  // â"€â"€ Save â"€â"€
  const [sendToPortalAfterSave, setSendToPortalAfterSave] = useState(false)

  const createOrder = useMutation({
    mutationFn: (payload: object) => api.post('/orders', payload),
    onSuccess: async (res) => {
      const order = res.data.data
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      if (sendToPortalAfterSave && order.supplier_id) {
        try {
          await api.post(`/orders/${order.id}/send-to-portal`)
          toast.success(`Order ${order.order_number ?? ''} created and sent to customer portal!`)
        } catch {
          toast.success(`Order ${order.order_number ?? ''} created!`)
          toast.error('Could not send to portal - open the order and try again')
        }
        navigate(`/orders/${order.id}`)
      } else {
        toast.success(`Order ${order.order_number ?? ''} created!`)
        navigate('/orders')
      }
      setSendToPortalAfterSave(false)
    },
    onError: (err: any) => {
      setSendToPortalAfterSave(false)
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
      toast.error(data?.message ?? 'Failed to update order')
    },
  })

  const buildPayload = () => {
    const itemsPayload = orderType === 'apparel'
      ? apparel.map(r => ({ item: r.item, color: r.color, size: r.size, qty: r.qty, artwork_no: r.artworkNo || null, artwork_size: r.artworkSize || null, unit_price: r.unitPrice, front_image: r.frontImage || null, back_image: r.backImage || null }))
      : orderType === 'gangsheet'
        ? gangsheet.map(r => ({ size: r.size, no_artworks: r.noArtworks, qty: r.qty, price_per_sheet: r.pricePerSheet, front_image: r.frontImage || null, back_image: r.backImage || null }))
        : dtf.map(r => ({ artwork_name: r.artworkName, size: r.size, qty: r.qty, unit_price: r.unitPrice, artwork_image: r.frontImage || r.artworkImage || null, front_image: r.frontImage || r.artworkImage || null, back_image: r.backImage || null }))

    return {
      supplier_id:        supplierId || null,
      supplier_name_text: !supplierId ? supplierText.trim() : null,
      invoice_id:         fromInvoiceId || null,
      quotation_id:       sourceInvoice?.quote_id || null,
      order_type:       orderType,
      order_date:       orderDate,
      due_date:         dueDate || null,
      payment_terms:    paymentTerms,
      payment_method:   paymentMethod,
      payment_status:   paymentStatus,
      currency:         currency,
      rush_services:    rushServices,
      shipping_charges: shippingCharges,
      discount_pct:     discountPct,
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
        if (!apparel[i].item.trim()) return `Row ${i + 1}: Item name is required`
      }
    }
    if (orderType === 'dtf') {
      for (let i = 0; i < dtf.length; i++) {
        if (!dtf[i].artworkName.trim()) return `Row ${i + 1}: Artwork Name is required`
      }
    }
    return null
  }

  const handleSave = (_asDraft = false) => {
    if (!supplierId && !supplierText.trim()) { toast.error('Please enter a supplier name'); return }
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

  const handleSendToSupplier = () => {
    if (!supplierId) { toast.error('Please select a supplier to send the order to their portal'); return }
    const activeItems = orderType === 'apparel' ? apparel : orderType === 'gangsheet' ? gangsheet : dtf
    if (!activeItems.length) { toast.error('Add at least one item'); return }
    const itemErr = validateItems()
    if (itemErr) { toast.error(itemErr); return }
    setSendToPortalAfterSave(true)
    createOrder.mutate(buildPayload())
  }

  const psStyle = PAYMENT_STATUS_STYLES[paymentStatus]

  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Render
  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  return (
    <div className="no-page">

      {/* â"€â"€ Top action bar â"€â"€ */}
      <div className="no-topbar">
        <button className="no-topbar-btn no-topbar-cancel" onClick={() => navigate(-1)}>Cancel</button>
        {!editOrderId && (
          <button className="no-topbar-btn no-topbar-draft" onClick={() => handleSave(true)} disabled={createOrder.isPending || updateOrder.isPending}>Save</button>
        )}
        {!editOrderId && (
          <div className="no-split-wrap">
            <button className="no-topbar-btn no-topbar-send" onClick={handleSendToSupplier} disabled={createOrder.isPending}>
              <Send size={13} /> Send to Supplier
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
          {(createOrder.isPending || updateOrder.isPending) ? 'Saving...' : editOrderId ? 'Update Order' : 'Save Order'}
        </button>
      </div>

      {/* â"€â"€ Info bar â"€â"€ */}
      <div className="no-info-bar">
        <div className="no-info-field">
          <span className="no-info-label">Order #</span>
          <strong className="no-info-value no-order-badge">Auto</strong>
          <small>Auto generated</small>
        </div>

        <div className="no-info-field no-info-select-field" style={{ position: 'relative' }}>
          <span className="no-info-label">Supplier <span style={{ color: '#ef4444' }}>*</span></span>
          <input
            className="no-info-select no-customer-input"
            placeholder="Type supplier name..."
            value={supplierText}
            autoComplete="off"
            onChange={e => {
              setSupplierText(e.target.value)
              setSupplierId(null)
              setSupplierOpen(true)
            }}
            onFocus={() => setSupplierOpen(true)}
            onBlur={() => setTimeout(() => setSupplierOpen(false), 150)}
          />
          {supplierOpen && suppliers.filter(c => c.name.toLowerCase().includes(supplierText.toLowerCase())).length > 0 && (
            <ul className="no-customer-suggestions">
              {suppliers
                .filter(c => c.name.toLowerCase().includes(supplierText.toLowerCase()))
                .slice(0, 8)
                .map(c => (
                  <li
                    key={c.id}
                    className="no-customer-suggestion-item"
                    onMouseDown={() => {
                      setSupplierId(c.id)
                      setSupplierText(c.name)
                      setSupplierOpen(false)
                    }}
                  >
                    <span className="no-cust-name">{c.name}</span>
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

      {/* â"€â"€ Order Type pills â"€â"€ */}
      <div className="no-order-type-row">
        <span className="no-type-row-label">Order Type</span>
        {([
          { key: 'apparel',   label: 'Custom Printed Apparel' },
          { key: 'gangsheet', label: 'DTF Gangsheet' },
          { key: 'dtf',       label: 'DTF Transfers' },
        ] as { key: OrderType; label: string }[]).map(({ key, label }) => (
          <label key={key} className={`no-type-pill${orderType === key ? ' no-type-pill-active' : ''}`}>
            <input type="radio" name="orderType" value={key} checked={orderType === key} onChange={() => setOrderType(key)} className="no-type-radio" />
            {label}
          </label>
        ))}
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
                <div className="no-table-wrap">
                  <table className="no-table">
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}>S.No</th>
                        <th>Item</th>
                        <th>Color</th>
                        <th>Size</th>
                        <th>Qty</th>
                        <th>FR AW Image</th>
                        <th>BK AW Image</th>
                        <th>Artwork No</th>
                        <th>Artwork Size</th>
                        <th>Unit Price (USD)</th>
                        <th>Amount (USD)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {apparel.map((row, idx) => (
                        <tr key={row.id} className="no-row">
                          <td className="no-td-num">{idx + 1}</td>
                          <td>
                            <select className="no-table-select" value={row.item} onChange={e => updateApparel(row.id, { item: e.target.value })}>
                              {ITEMS.map(i => <option key={i}>{i}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="no-table-select" value={row.color} onChange={e => updateApparel(row.id, { color: e.target.value })}>
                              {COLORS.map(c => <option key={c}>{c}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="no-table-select no-size-select" value={row.size} onChange={e => updateApparel(row.id, { size: e.target.value })}>
                              {SIZES.map(s => <option key={s}>{s}</option>)}
                            </select>
                          </td>
                          <td>
                            <input type="number" className="no-table-input" min={1} value={row.qty} onFocus={e => e.target.select()} onChange={e => updateApparel(row.id, { qty: Math.max(1, +e.target.value) })} />
                          </td>
                          <td><ImageUploadCell imageUrl={row.frontImage} label="Front" uploading={uploadingImg[`${row.id}-frontImage`]} onUpload={f => uploadItemImage(row.id, 'frontImage', f, updateApparel)} onRemove={() => updateApparel(row.id, { frontImage: null })} /></td>
                          <td><ImageUploadCell imageUrl={row.backImage} label="Back" uploading={uploadingImg[`${row.id}-backImage`]} onUpload={f => uploadItemImage(row.id, 'backImage', f, updateApparel)} onRemove={() => updateApparel(row.id, { backImage: null })} /></td>
                          <td>
                            <input
                              type="text"
                              className="no-table-input"
                              placeholder="AW-0001"
                              value={row.artworkNo}
                              onChange={e => updateApparel(row.id, { artworkNo: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              className="no-table-input"
                              placeholder="e.g. 12x16 in"
                              value={row.artworkSize}
                              onChange={e => updateApparel(row.id, { artworkSize: e.target.value })}
                              style={{ width: '110px' }}
                            />
                          </td>
                          <td>
                            <div className="no-price-input">
                              <span>$</span>
                              <input type="number" min={0} step={0.01} value={row.unitPrice} onFocus={e => e.target.select()} onChange={e => updateApparel(row.id, { unitPrice: +e.target.value })} />
                            </div>
                          </td>
                          <td className="no-td-amount">${fmt(row.unitPrice * row.qty)}</td>
                          <td>
                            <button className="no-action-icon-btn no-delete-icon" onClick={() => removeApparel(row.id)} title="Remove row">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className="no-add-item-btn" onClick={addApparel}><Plus size={13} /> Add Item</button>
              </>
            )}

            {/* â"€â"€ Gangsheet table â"€â"€ */}
            {orderType === 'gangsheet' && (
              <>
                <div className="no-table-wrap">
                  <table className="no-table">
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}>S.No</th>
                        <th>Gangsheet Size</th>
                        <th>No. Artworks</th>
                        <th>Qty (Sheets)</th>
                        <th>Front Art</th>
                        <th>Back Art</th>
                        <th>Price/Sheet (USD)</th>
                        <th>Amount (USD)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {gangsheet.map((row, idx) => (
                        <tr key={row.id} className="no-row">
                          <td className="no-td-num">{idx + 1}</td>
                          <td>
                            <input
                              className="no-table-input"
                              placeholder='e.g. 22" x 60"'
                              value={row.size}
                              onChange={e => updateGangsheet(row.id, { size: e.target.value })}
                              style={{ width: '110px' }}
                            />
                          </td>
                          <td>
                            <input type="number" className="no-table-input" min={1} value={row.noArtworks} onFocus={e => e.target.select()} onChange={e => updateGangsheet(row.id, { noArtworks: Math.max(1, +e.target.value) })} />
                          </td>
                          <td>
                            <input type="number" className="no-table-input" min={1} value={row.qty} onFocus={e => e.target.select()} onChange={e => updateGangsheet(row.id, { qty: Math.max(1, +e.target.value) })} />
                          </td>
                          <td><ImageUploadCell imageUrl={row.frontImage} label="Front" uploading={uploadingImg[`${row.id}-frontImage`]} onUpload={f => uploadItemImage(row.id, 'frontImage', f, updateGangsheet)} onRemove={() => updateGangsheet(row.id, { frontImage: null })} /></td>
                          <td><ImageUploadCell imageUrl={row.backImage} label="Back" uploading={uploadingImg[`${row.id}-backImage`]} onUpload={f => uploadItemImage(row.id, 'backImage', f, updateGangsheet)} onRemove={() => updateGangsheet(row.id, { backImage: null })} /></td>
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
                  </table>
                </div>
                <button className="no-add-item-btn" onClick={addGangsheet}><Plus size={13} /> Add Item</button>
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
                        <th>Front Art</th>
                        <th>Back Art</th>
                        <th>Artwork Name</th>
                        <th>Size</th>
                        <th>Qty</th>
                        <th>Unit Price (USD)</th>
                        <th>Amount (USD)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dtf.map((row, idx) => (
                        <tr key={row.id} className="no-row">
                          <td className="no-td-num">{idx + 1}</td>
                          <td><ImageUploadCell imageUrl={row.frontImage ?? row.artworkImage} label="Front" uploading={uploadingImg[`${row.id}-frontImage`]} onUpload={f => uploadItemImage(row.id, 'frontImage', f, updateDtf)} onRemove={() => updateDtf(row.id, { frontImage: null, artworkImage: null })} /></td>
                          <td><ImageUploadCell imageUrl={row.backImage} label="Back" uploading={uploadingImg[`${row.id}-backImage`]} onUpload={f => uploadItemImage(row.id, 'backImage', f, updateDtf)} onRemove={() => updateDtf(row.id, { backImage: null })} /></td>
                          <td>
                            <input type="text" className="no-table-input no-table-input-wide" placeholder="Artwork name" value={row.artworkName} onChange={e => updateDtf(row.id, { artworkName: e.target.value })} />
                          </td>
                          <td>
                            <input
                              className="no-table-input"
                              placeholder="e.g. 10x12 in"
                              value={row.size}
                              onChange={e => updateDtf(row.id, { size: e.target.value })}
                              style={{ width: '110px' }}
                            />
                          </td>
                          <td>
                            <input type="number" className="no-table-input" min={1} value={row.qty} onFocus={e => e.target.select()} onChange={e => updateDtf(row.id, { qty: Math.max(1, +e.target.value) })} />
                          </td>
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
            <div className="no-pricing-total-row">
              <span>Total</span>
              <strong className="no-net-amount">${fmt(total)}</strong>
            </div>
          </div>

          {/* Payment Information */}
          <div className="no-card no-payment-card">
            <h4 className="no-section-title">Payment Information</h4>

            <div className="no-payment-field">
              <label className="no-payment-label">Payment Terms</label>
              <select className="no-info-select" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}>
                {PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>

            <div className="no-payment-field">
              <label className="no-payment-label">Payment Method</label>
              <select className="no-info-select" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as typeof paymentMethod)}>
                <option value="cashapp">CashApp</option>
                <option value="zelle">Zelle</option>
                <option value="paypal">PayPal</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
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

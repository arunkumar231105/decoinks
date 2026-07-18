import { useReducer, useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import { useNavigate, useLocation, Link, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from '../utils/toast'
import {
  ChevronRight, Plus, Save, Trash2, Info, Mail, MessageCircle,
  ExternalLink, UploadCloud, Pencil, X, FileText,
} from 'lucide-react'
import { cn } from '../utils/cn'
import { api } from '../services/api'

// ── Types ──────────────────────────────────────────────────────────────────────

type POType = 'gangsheet' | 'apparel'

interface POLineItem {
  id: string
  item_name: string
  brand: string
  color: string
  size: string
  qty_ordered: number
  unit_price: number
  line_total: number
  artwork_id: string | null
  artwork_no: string
  artwork_url: string | null
  artwork_size_front: string
  artwork_size_back: string
  catalog_style_id: string
  catalog_color_id: string
  catalog_size_id: string
  catalog_sku: string
  product_image: string | null
  style_description: string
  sort_order: number
  // Preserved fields (no UI column, but must survive an edit round-trip)
  description: string
  hsn_code: string
  uom: string
  discount_pct: number
  tax_pct: number
  remarks: string
  required_by_date: string
}

interface CoveredOrder {
  order_id: string
  order_number: string
  no_artworks: number
  qty: number
  width: string
  length: string
  status: string
  order_date: string | null
  due_date: string | null
  agent_name: string
}

interface Fragment {
  id: string
  fragment_no: string
  order_id: string
  width: string
  length: string
  artworks_count: number
  qty: number
  file_url: string
}

interface AttachedArtwork {
  id: string
  artwork_no: string
  name: string
  file_url: string | null
  thumbnail_url: string | null
  file_type: string | null
}

interface SupplierContact {
  id: string
  name: string
  email: string | null
  phone: string | null
  wechat_id: string | null
  is_primary: boolean
}

interface POFormState {
  po_type: POType
  order_date: string
  expected_date: string
  supplier_id: string
  supplier_name: string
  supplier_contact_id: string
  contact_name: string
  contact_email: string
  contact_phone: string
  communication_method: 'email' | 'wechat'
  payment_status: 'Unpaid' | 'Partial' | 'Paid'
  buyer_id: string
  notes: string
  terms_conditions: string
  items: POLineItem[]
  orders: CoveredOrder[]
  fragments: Fragment[]
  artworks: AttachedArtwork[]
}

type Action =
  | { type: 'SET'; field: keyof POFormState; value: any }
  | { type: 'ADD_ITEM' }
  | { type: 'UPDATE_ITEM'; id: string; patch: Partial<POLineItem> }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'ADD_ORDER'; order: CoveredOrder }
  | { type: 'REMOVE_ORDER'; order_id: string }
  | { type: 'ADD_FRAGMENT' }
  | { type: 'UPDATE_FRAGMENT'; id: string; patch: Partial<Fragment> }
  | { type: 'REMOVE_FRAGMENT'; id: string }
  | { type: 'ADD_ARTWORK'; artwork: AttachedArtwork }
  | { type: 'REMOVE_ARTWORK'; id: string }
  | { type: 'INIT'; payload: Partial<POFormState> }

// ── Helpers ────────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9)
const todayISO = () => new Date().toISOString().split('T')[0]

const lineTotal = (qty: number, price: number) => +(qty * price).toFixed(2)

/** Parses '22x60', '22" x 60"', '22 X 60' → { width: '22', length: '60' } */
function parseSheetSize(size?: string | null): { width: string; length: string } {
  const m = /([\d.]+)\s*["']?\s*[x×]\s*([\d.]+)/i.exec(size ?? '')
  return m ? { width: m[1], length: m[2] } : { width: '', length: '' }
}

function newItem(idx: number): POLineItem {
  return {
    id: uid(), item_name: '', brand: '', color: '', size: '',
    qty_ordered: 1, unit_price: 0, line_total: 0,
    artwork_id: null, artwork_no: '', artwork_url: null,
    artwork_size_front: '', artwork_size_back: '',
    catalog_style_id: '', catalog_color_id: '', catalog_size_id: '', catalog_sku: '',
    product_image: null, style_description: '',
    sort_order: idx,
    description: '', hsn_code: '', uom: 'pcs',
    discount_pct: 0, tax_pct: 0, remarks: '', required_by_date: '',
  }
}

function newFragment(): Fragment {
  return {
    id: uid(), fragment_no: '', order_id: '',
    width: '', length: '', artworks_count: 0, qty: 0, file_url: '',
  }
}

const STATUS_BADGE: Record<string, string> = {
  Draft: 'np-badge-yellow', Sent: 'np-badge-orange', Confirmed: 'np-badge-blue',
  'In Production': 'np-badge-blue', Delivered: 'np-badge-green', Shipped: 'np-badge-blue',
}

// ── Reducer ────────────────────────────────────────────────────────────────────

const initialState: POFormState = {
  po_type: 'gangsheet',
  order_date: todayISO(),
  expected_date: '',
  supplier_id: '',
  supplier_name: '',
  supplier_contact_id: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  communication_method: 'email',
  payment_status: 'Unpaid',
  buyer_id: '',
  notes: '',
  terms_conditions: '',
  items: [],
  orders: [],
  fragments: [],
  artworks: [],
}

function reducer(state: POFormState, action: Action): POFormState {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.field]: action.value }
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, newItem(state.items.length)] }
    case 'UPDATE_ITEM': {
      const items = state.items.map(it => {
        if (it.id !== action.id) return it
        const u = { ...it, ...action.patch }
        u.line_total = lineTotal(u.qty_ordered, u.unit_price)
        return u
      })
      return { ...state, items }
    }
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter(it => it.id !== action.id) }
    case 'ADD_ORDER':
      if (state.orders.some(o => o.order_id === action.order.order_id)) return state
      if (state.po_type === 'apparel' && state.orders.length >= 1) return state
      return { ...state, orders: [...state.orders, action.order] }
    case 'REMOVE_ORDER':
      return { ...state, orders: state.orders.filter(o => o.order_id !== action.order_id) }
    case 'ADD_FRAGMENT':
      return { ...state, fragments: [...state.fragments, newFragment()] }
    case 'UPDATE_FRAGMENT':
      return {
        ...state,
        fragments: state.fragments.map(f => (f.id === action.id ? { ...f, ...action.patch } : f)),
      }
    case 'REMOVE_FRAGMENT':
      return { ...state, fragments: state.fragments.filter(f => f.id !== action.id) }
    case 'ADD_ARTWORK':
      if (state.artworks.some(a => a.id === action.artwork.id)) return state
      return { ...state, artworks: [...state.artworks, action.artwork] }
    case 'REMOVE_ARTWORK':
      return { ...state, artworks: state.artworks.filter(a => a.id !== action.id) }
    case 'INIT':
      return { ...state, ...action.payload }
    default:
      return state
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function NewPurchaseOrderPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id: editId } = useParams<{ id: string }>()
  const isEdit = !!editId
  const [state, dispatch] = useReducer(reducer, initialState)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [orderPickerOpen, setOrderPickerOpen] = useState(false)
  const [artworkPickerOpen, setArtworkPickerOpen] = useState(false)
  const [newContactMode, setNewContactMode] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fromOrderId: string | undefined = (location.state as any)?.fromOrderId

  const set = (field: keyof POFormState, value: any) => dispatch({ type: 'SET', field, value })

  // ── Reference data ──────────────────────────────────────────────────────────

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-for-po'],
    queryFn: () => api.get('/suppliers', { params: { limit: 200 } }).then(r => r.data.data?.rows ?? []),
  })
  const suppliers: { id: string; name: string; email: string }[] = suppliersData ?? []

  const { data: usersData } = useQuery({
    queryKey: ['users-for-po'],
    queryFn: () => api.get('/users', { params: { limit: 100 } }).then(r => r.data.data?.rows ?? r.data?.rows ?? []),
  })
  const users: { id: string; name: string }[] = usersData ?? []

  const { data: contactsData, refetch: refetchContacts } = useQuery({
    queryKey: ['supplier-contacts', state.supplier_id],
    queryFn: () => api.get(`/suppliers/${state.supplier_id}/contacts`).then(r => r.data.data ?? []),
    enabled: !!state.supplier_id,
  })
  const contacts: SupplierContact[] = contactsData ?? []

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
    (s.email ?? '').toLowerCase().includes(supplierSearch.toLowerCase())
  )

  // ── Load existing PO (edit mode) ────────────────────────────────────────────

  const { data: existingPO } = useQuery({
    queryKey: ['po-edit', editId],
    queryFn: () => api.get(`/purchase-orders/${editId}`).then(r => r.data.data ?? r.data),
    enabled: isEdit,
  })

  useEffect(() => {
    if (!existingPO) return
    if (existingPO.supplier_name) setSupplierSearch(existingPO.supplier_name)
    dispatch({
      type: 'INIT',
      payload: {
        po_type:              existingPO.po_type === 'gangsheet' ? 'gangsheet' : 'apparel',
        order_date:           existingPO.order_date ? existingPO.order_date.split('T')[0] : todayISO(),
        expected_date:        existingPO.expected_date ? existingPO.expected_date.split('T')[0] : '',
        supplier_id:          existingPO.supplier_id || '',
        supplier_name:        existingPO.supplier_name || existingPO.vendor_name || '',
        supplier_contact_id:  existingPO.supplier_contact_id || '',
        contact_name:         existingPO.contact_name || '',
        contact_email:        existingPO.contact_email || '',
        contact_phone:        existingPO.contact_phone || existingPO.contact_wechat || '',
        communication_method: existingPO.communication_method === 'wechat' ? 'wechat' : 'email',
        payment_status:       existingPO.payment_status || 'Unpaid',
        buyer_id:             existingPO.buyer_id || '',
        notes:                existingPO.notes || '',
        terms_conditions:     existingPO.terms_conditions || '',
        orders: (existingPO.orders ?? []).map((o: any): CoveredOrder => {
          const sz = parseSheetSize(o.gangsheet_sizes)
          return {
            order_id: o.id, order_number: o.order_number,
            no_artworks: Number(o.no_artworks) || 0, qty: Number(o.qty) || 0,
            width: sz.width, length: sz.length,
            status: o.status, order_date: o.order_date, due_date: o.due_date,
            agent_name: o.agent_name || '',
          }
        }),
        fragments: (existingPO.fragments ?? []).map((f: any): Fragment => ({
          id: f.id || uid(),
          fragment_no: f.fragment_no || '',
          order_id: f.order_id || '',
          width: f.width_inches != null ? String(f.width_inches) : '',
          length: f.length_inches != null ? String(f.length_inches) : '',
          artworks_count: Number(f.artworks_count) || 0,
          qty: Number(f.qty) || 0,
          file_url: f.file_url || '',
        })),
        artworks: (existingPO.artworks ?? []).map((a: any): AttachedArtwork => ({
          id: a.id, artwork_no: a.artwork_no, name: a.name,
          file_url: a.file_url, thumbnail_url: a.thumbnail_url, file_type: a.file_type,
        })),
        items: (existingPO.items ?? []).map((it: any, idx: number): POLineItem => ({
          id: uid(),
          item_name: it.item_name || '',
          brand: it.brand || '',
          color: it.color || '',
          size: it.size || '',
          qty_ordered: Number(it.qty_ordered) || 1,
          unit_price: Number(it.unit_price) || 0,
          line_total: Number(it.line_total) || 0,
          artwork_id: it.artwork_id || null,
          artwork_no: it.artwork_no_ref || '',
          artwork_url: it.artwork_thumbnail_url || it.artwork_file_url || it.front_image || null,
          artwork_size_front: it.artwork_size_front || it.artwork_size || '',
          artwork_size_back: it.artwork_size_back || '',
          catalog_style_id: it.catalog_style_id || '',
          catalog_color_id: it.catalog_color_id || '',
          catalog_size_id: it.catalog_size_id || '',
          catalog_sku: it.catalog_sku || '',
          product_image: it.product_image || null,
          style_description: it.style_description || '',
          sort_order: it.sort_order ?? idx,
          // Preserve fields that have no UI column so an edit-save doesn't zero them
          description: it.description || '',
          hsn_code: it.hsn_code || '',
          uom: it.uom || 'pcs',
          discount_pct: Number(it.discount_pct) || 0,
          tax_pct: Number(it.tax_pct) || 0,
          remarks: it.remarks || '',
          required_by_date: it.required_by_date ? String(it.required_by_date).split('T')[0] : '',
        })),
      },
    })
  }, [existingPO])

  // ── Convert-from-order context ──────────────────────────────────────────────

  const { data: sourceOrder } = useQuery({
    queryKey: ['convert-from-order', fromOrderId],
    queryFn: () => api.get(`/orders/${fromOrderId}`).then(r => r.data.data ?? r.data),
    enabled: !!fromOrderId && !isEdit,
  })

  useEffect(() => {
    if (!sourceOrder) return
    const poType: POType = sourceOrder.order_type === 'gangsheet' ? 'gangsheet' : 'apparel'
    if (sourceOrder.supplier_name) setSupplierSearch(sourceOrder.supplier_name)

    const payload: Partial<POFormState> = {
      po_type: poType,
      supplier_id: sourceOrder.supplier_id || '',
      supplier_name: sourceOrder.supplier_name || '',
      expected_date: sourceOrder.due_date ? sourceOrder.due_date.split('T')[0] : '',
      orders: [orderToCovered(sourceOrder)],
    }

    if (poType === 'apparel') {
      payload.items = (sourceOrder.items ?? []).map((it: any, idx: number): POLineItem => ({
        id: uid(),
        item_name: it.item || '',
        brand: it.brand || '',
        color: it.color || '',
        size: it.size || '',
        qty_ordered: Number(it.qty) || 1,
        unit_price: Number(it.unit_price) || 0,
        line_total: lineTotal(Number(it.qty) || 1, Number(it.unit_price) || 0),
        artwork_id: null,
        artwork_no: it.artwork_no || '',
        artwork_url: it.front_image || null,
        artwork_size_front: it.artwork_size || '',
        artwork_size_back: it.artwork_size || '',
        sort_order: idx,
        description: it.style_description || '', hsn_code: '', uom: 'pcs',
        catalog_style_id: it.catalog_style_id || '', catalog_color_id: it.catalog_color_id || '',
        catalog_size_id: it.catalog_size_id || '', catalog_sku: it.catalog_sku || '',
        product_image: it.product_image || null, style_description: it.style_description || '',
        discount_pct: 0, tax_pct: 0, remarks: '', required_by_date: '',
      }))
    }
    dispatch({ type: 'INIT', payload })
  }, [sourceOrder])

  function orderToCovered(o: any): CoveredOrder {
    const gsItems: any[] = (o.items ?? []).filter((it: any) => it.no_artworks != null || it.price_per_sheet != null)
    const noArtworks = gsItems.reduce((s, it) => s + (Number(it.no_artworks) || 0), 0)
    const qty = (o.items ?? []).reduce((s: number, it: any) => s + (Number(it.qty) || 0), 0)
    const sz = parseSheetSize(gsItems[0]?.size)
    return {
      order_id: o.id,
      order_number: o.order_number,
      no_artworks: noArtworks,
      qty,
      width: sz.width,
      length: sz.length,
      status: o.status,
      order_date: o.order_date,
      due_date: o.due_date,
      agent_name: o.agent_name || o.assigned_to_name || o.created_by_name || '',
    }
  }

  // ── Contact selection ───────────────────────────────────────────────────────

  useEffect(() => {
    // Auto-pick the primary contact when the supplier changes (create mode only)
    if (!contacts.length || state.supplier_contact_id || isEdit) return
    const primary = contacts.find(c => c.is_primary) ?? contacts[0]
    selectContact(primary)
  }, [contacts])

  function selectContact(c: SupplierContact) {
    dispatch({
      type: 'INIT',
      payload: {
        supplier_contact_id: c.id,
        contact_name: c.name,
        contact_email: c.email || '',
        contact_phone: (state.communication_method === 'wechat' ? c.wechat_id : c.phone) || c.phone || '',
      },
    })
    setNewContactMode(false)
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  /** Creates or updates the supplier contact so the PO can reference it by id. */
  async function resolveContactId(): Promise<string | null> {
    if (!state.supplier_id) return null
    const body = {
      name: state.contact_name || state.supplier_name || 'Contact',
      email: state.contact_email || null,
      ...(state.communication_method === 'wechat'
        ? { wechat_id: state.contact_phone || null }
        : { phone: state.contact_phone || null }),
    }
    try {
      if (state.supplier_contact_id && !newContactMode) {
        const existing = contacts.find(c => c.id === state.supplier_contact_id)
        const changed = existing && (
          existing.name !== body.name ||
          (existing.email || '') !== (state.contact_email || '') ||
          (existing.phone || '') !== (state.contact_phone || '')
        )
        if (changed) {
          await api.put(`/suppliers/${state.supplier_id}/contacts/${state.supplier_contact_id}`, body)
        }
        return state.supplier_contact_id
      }
      if (state.contact_name) {
        const res = await api.post(`/suppliers/${state.supplier_id}/contacts`, body)
        const newId = res.data.data?.id ?? null
        // Write the new id back into state and leave "new contact" mode so a
        // repeat save (e.g. in edit mode) updates this contact instead of
        // POSTing a fresh duplicate every time.
        if (newId) {
          dispatch({ type: 'SET', field: 'supplier_contact_id', value: newId })
          setNewContactMode(false)
        }
        refetchContacts()
        return newId
      }
    } catch { /* contact sync is best-effort; the PO itself must still save */ }
    return state.supplier_contact_id || null
  }

  async function buildPayload() {
    const supplier_contact_id = await resolveContactId()
    return {
      po_type: state.po_type,
      supplier_id: state.supplier_id || null,
      vendor_name: state.supplier_name || supplierSearch || null,
      supplier_contact_id,
      communication_method: state.communication_method,
      payment_status: state.payment_status,
      buyer_id: state.buyer_id || null,
      order_date: state.order_date || null,
      expected_date: state.expected_date || null,
      notes: state.notes || null,
      terms_conditions: state.terms_conditions || null,
      // Apparel PO may cover only one order — never send more, even if the
      // orders list carried over from a gangsheet-mode edit before the switch.
      order_ids: state.po_type === 'apparel'
        ? state.orders.slice(0, 1).map(o => o.order_id)
        : state.orders.map(o => o.order_id),
      artwork_ids: state.artworks.map(a => a.id),
      fragments: state.po_type === 'gangsheet'
        ? state.fragments.map((f, i) => ({
            fragment_no: f.fragment_no || null,
            order_id: f.order_id || null,
            width_inches: f.width ? parseFloat(f.width) : null,
            length_inches: f.length ? parseFloat(f.length) : null,
            artworks_count: Number(f.artworks_count) || 0,
            qty: Number(f.qty) || 0,
            file_url: f.file_url || null,
            sort_order: i,
          }))
        : [],
      items: state.po_type === 'apparel'
        ? state.items.map((it, i) => ({
            item_name: it.item_name,
            brand: it.brand || null,
            color: it.color || null,
            size: it.size || null,
            qty_ordered: it.qty_ordered,
            unit_price: it.unit_price,
            artwork_id: it.artwork_id,
            artwork_size_front: it.artwork_size_front || null,
            artwork_size_back: it.artwork_size_back || null,
            artwork_no: it.artwork_no || null,
            catalog_style_id: it.catalog_style_id || null,
            catalog_color_id: it.catalog_color_id || null,
            catalog_size_id: it.catalog_size_id || null,
            catalog_sku: it.catalog_sku || null,
            product_image: it.product_image || null,
            style_description: it.style_description || null,
            sort_order: i,
            // Echo preserved fields so an edit-save keeps prior discount/tax/etc.
            description: it.description || null,
            hsn_code: it.hsn_code || null,
            uom: it.uom || 'pcs',
            discount_pct: it.discount_pct || 0,
            tax_pct: it.tax_pct || 0,
            remarks: it.remarks || null,
            required_by_date: it.required_by_date || null,
          }))
        : [],
    }
  }

  const saveMutation = useMutation({
    mutationFn: async ({ thenView }: { thenView: boolean }) => {
      const payload = await buildPayload()
      const res = isEdit
        ? await api.put(`/purchase-orders/${editId}`, payload)
        : await api.post('/purchase-orders', payload)
      return { res, thenView }
    },
    onSuccess: ({ res, thenView }) => {
      const id = editId ?? res.data.data?.id
      toast.success(isEdit ? 'Purchase order updated' : 'Purchase order saved')
      if (thenView && id) navigate(`/purchase-orders/${id}`)
      else if (!isEdit && id) navigate(`/purchase-orders/${id}/edit`, { replace: true })
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to save PO'),
  })

  function validate(): boolean {
    if (!state.supplier_id && !supplierSearch) {
      toast.error('Select a vendor / supplier')
      return false
    }
    if (state.po_type === 'gangsheet' && state.orders.length === 0) {
      toast.error('Add at least one gangsheet order')
      return false
    }
    if (state.po_type === 'apparel') {
      if (state.items.length === 0) { toast.error('Add at least one item'); return false }
      if (state.items.some(it => !it.item_name.trim())) { toast.error('All items require a name'); return false }
    }
    return true
  }

  const handleSaveDraft = () => { if (validate()) saveMutation.mutate({ thenView: false }) }
  const handleSavePO = () => { if (validate()) saveMutation.mutate({ thenView: true }) }

  // ── Delete (edit mode) ──────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/purchase-orders/${editId}`),
    onSuccess: () => { toast.success('Purchase order deleted'); navigate('/purchase-orders') },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to delete'),
  })

  // ── Artwork upload (drag-drop / browse) ─────────────────────────────────────

  async function uploadArtworkFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (!list.length) return
    setUploading(true)
    try {
      for (const file of list) {
        if (file.size > 50 * 1024 * 1024) { toast.error(`${file.name}: exceeds 50 MB`); continue }
        const fd = new FormData()
        fd.append('file', file)
        fd.append('name', file.name.replace(/\.[^.]+$/, ''))
        const res = await api.post('/artworks', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        const a = res.data.data ?? res.data
        dispatch({
          type: 'ADD_ARTWORK',
          artwork: {
            id: a.id, artwork_no: a.artwork_no, name: a.name,
            file_url: a.file_url, thumbnail_url: a.thumbnail_url ?? null, file_type: a.file_type,
          },
        })
      }
      toast.success('Artwork uploaded')
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // ── Derived totals ──────────────────────────────────────────────────────────

  const orderTotals = useMemo(() => ({
    artworks: state.orders.reduce((s, o) => s + o.no_artworks, 0),
    qty: state.orders.reduce((s, o) => s + o.qty, 0),
  }), [state.orders])

  const fragTotals = useMemo(() => ({
    artworks: state.fragments.reduce((s, f) => s + (Number(f.artworks_count) || 0), 0),
    qty: state.fragments.reduce((s, f) => s + (Number(f.qty) || 0), 0),
  }), [state.fragments])

  const itemsTotal = useMemo(
    () => state.items.reduce((s, it) => s + it.line_total, 0),
    [state.items]
  )

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2 })
  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-US') : '—')

  const saving = saveMutation.isPending

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="np-page">

      {/* ── HEADER ── */}
      <div className="np-header">
        <div>
          <div className="np-breadcrumb">
            <Link to="/purchase-orders" className="hover:text-gray-700">Purchase Orders</Link>
            <ChevronRight size={13} />
            <strong>{isEdit ? 'Edit' : 'New'}</strong>
          </div>
          <h2 className="np-page-title">{isEdit ? 'Edit Purchase Order' : 'New Purchase Order'}</h2>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0' }}>
            {state.po_type === 'gangsheet' ? 'Request materials from suppliers' : 'Create a purchase order for custom printed shirts.'}
          </p>
        </div>
        <div className="np-header-actions">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button className="lb-action-btn" onClick={handleSaveDraft} disabled={saving}>
            <FileText size={13} /> Save Draft
          </button>
          {isEdit && (
            <>
              <button className="lb-action-btn" onClick={() => navigate(`/purchase-orders/${editId}`)}>
                <Pencil size={13} /> View
              </button>
              <button
                className="lb-action-btn"
                style={{ color: '#ef4444', borderColor: '#fecaca' }}
                onClick={() => { if (window.confirm('Delete this purchase order?')) deleteMutation.mutate() }}
              >
                <Trash2 size={13} /> Delete
              </button>
            </>
          )}
          <button className="lb-action-btn lb-action-primary" onClick={handleSavePO} disabled={saving}>
            <Save size={13} /> {isEdit ? 'Update PO' : 'Save PO'}
          </button>
        </div>
      </div>

      {/* ── HEADER FIELDS ── */}
      <div className="np-card">
        <div className="np-vendor-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="np-field">
            <label className="np-label">PO Number</label>
            <input className="np-input" disabled
              value={isEdit ? (existingPO?.po_number ?? '…') : 'Auto-generated'}
              style={{ background: '#f9fafb', color: '#6b7280' }} />
          </div>
          <div className="np-field">
            <label className="np-label">Order Date</label>
            <input type="date" className="np-input" value={state.order_date}
              onChange={e => set('order_date', e.target.value)} />
          </div>
          <div className="np-field">
            <label className="np-label">Due Date</label>
            <input type="date" className="np-input" value={state.expected_date}
              onChange={e => set('expected_date', e.target.value)} />
          </div>
          <div className="np-field" style={{ position: 'relative' }}>
            <label className="np-label">Vendor / Supplier <span style={{ color: '#ef4444' }}>*</span></label>
            <input className="np-select" placeholder="Search supplier..."
              value={state.supplier_name || supplierSearch}
              onFocus={() => { setSupplierOpen(true); setSupplierSearch('') }}
              onChange={e => {
                setSupplierSearch(e.target.value)
                setSupplierOpen(true)
                if (!e.target.value) {
                  dispatch({ type: 'INIT', payload: { supplier_id: '', supplier_name: '', supplier_contact_id: '', contact_name: '', contact_email: '', contact_phone: '' } })
                }
              }}
              onBlur={() => setTimeout(() => setSupplierOpen(false), 150)} />
            {supplierOpen && filteredSuppliers.length > 0 && (
              <div className="np-dropdown">
                {filteredSuppliers.slice(0, 8).map(s => (
                  <button key={s.id} className="np-dropdown-item"
                    onMouseDown={() => {
                      dispatch({ type: 'INIT', payload: { supplier_id: s.id, supplier_name: s.name, supplier_contact_id: '', contact_name: '', contact_email: '', contact_phone: '' } })
                      setSupplierSearch('')
                      setSupplierOpen(false)
                    }}>
                    <span className="np-dropdown-name">{s.name}</span>
                    {s.email && <span className="np-dropdown-sub">{s.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="np-field">
            <label className="np-label">Contact Person</label>
            {newContactMode ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <input className="np-input" placeholder="New contact name..."
                  value={state.contact_name}
                  onChange={e => set('contact_name', e.target.value)} autoFocus />
                <button className="np-del-btn" title="Back to list" onClick={() => setNewContactMode(false)}><X size={13} /></button>
              </div>
            ) : (
              <select className="np-select" value={state.supplier_contact_id}
                disabled={!state.supplier_id}
                onChange={e => {
                  if (e.target.value === '__new__') {
                    setNewContactMode(true)
                    dispatch({ type: 'INIT', payload: { supplier_contact_id: '', contact_name: '', contact_email: '', contact_phone: '' } })
                  } else {
                    const c = contacts.find(x => x.id === e.target.value)
                    if (c) selectContact(c)
                  }
                }}>
                <option value="">— select contact —</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new__">+ Add new contact…</option>
              </select>
            )}
          </div>
        </div>

        <div className="np-vendor-grid" style={{ gridTemplateColumns: 'auto 1fr 1fr 1.5fr', marginTop: 12, alignItems: 'end' }}>
          <div className="np-field">
            <label className="np-label">Communication Method</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button"
                className={cn('lb-action-btn', state.communication_method === 'email' && 'lb-action-primary')}
                onClick={() => set('communication_method', 'email')}>
                <Mail size={13} /> Email
              </button>
              <button type="button"
                className={cn('lb-action-btn', state.communication_method === 'wechat' && 'lb-action-primary')}
                onClick={() => set('communication_method', 'wechat')}>
                <MessageCircle size={13} /> WeChat
              </button>
            </div>
          </div>
          <div className="np-field">
            <label className="np-label">Email</label>
            <input className="np-input" type="email" placeholder="contact@vendor.com"
              value={state.contact_email}
              onChange={e => set('contact_email', e.target.value)} />
          </div>
          <div className="np-field">
            <label className="np-label">{state.communication_method === 'wechat' ? 'Phone / WeChat ID' : 'Phone'}</label>
            <input className="np-input" placeholder="+86 138 1234 5678"
              value={state.contact_phone}
              onChange={e => set('contact_phone', e.target.value)} />
          </div>
          <div className="np-field">
            <label className="np-label">Notes</label>
            <input className="np-input" placeholder="Internal notes..."
              value={state.notes}
              onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        {state.po_type === 'apparel' && (
          <div className="np-vendor-grid" style={{ gridTemplateColumns: '1fr 1fr 2fr', marginTop: 12 }}>
            <div className="np-field">
              <label className="np-label">Payment Status</label>
              <select className="np-select" value={state.payment_status}
                onChange={e => set('payment_status', e.target.value)}>
                {['Unpaid', 'Partial', 'Paid'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="np-field">
              <label className="np-label">Sales Agent</label>
              <select className="np-select" value={state.buyer_id}
                onChange={e => set('buyer_id', e.target.value)}>
                <option value="">— select —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div />
          </div>
        )}
      </div>

      {/* ── INFO BANNER ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
        padding: '10px 14px', margin: '12px 0', fontSize: 12.5, color: '#1e40af',
      }}>
        <Info size={15} style={{ flexShrink: 0 }} />
        Purchase Order can be composed of multiple Orders if product is Gangsheet, however for
        Custom Printed Apparel each Purchase Order will be composed of only one Order.
      </div>

      {/* ── ORDER TYPE ── */}
      <div style={{ margin: '0 0 14px' }}>
        <label className="np-label" style={{ display: 'block', marginBottom: 6 }}>
          Order Type <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <div style={{ display: 'inline-flex', gap: 4, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 4 }}>
          {([['gangsheet', 'Gangsheets'], ['apparel', 'Custom Printed Shirts']] as [POType, string][]).map(([val, label]) => (
            <button key={val} type="button"
              className={cn('lb-action-btn', state.po_type === val && 'lb-action-primary')}
              style={{ border: 'none' }}
              onClick={() => set('po_type', val)}>
              <span style={{
                display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
                border: state.po_type === val ? '4px solid currentColor' : '2px solid #d1d5db',
                marginRight: 2,
              }} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ GANGSHEET MODE ═══ */}
      {state.po_type === 'gangsheet' && (
        <>
          {/* Section 1: Gangsheet Orders */}
          <div className="np-card">
            <div className="np-card-header" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="np-section-num">1</span>
                <h3>Gangsheet Orders</h3>
              </div>
              <button className="lb-action-btn" onClick={() => setOrderPickerOpen(true)}>
                <Plus size={13} /> Add Order
              </button>
            </div>
            <div className="np-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="np-table" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th style={{ minWidth: 130 }}>Order No</th>
                    <th style={{ width: 100 }}>No. of Artworks</th>
                    <th style={{ width: 70 }}>Qty</th>
                    <th style={{ width: 110 }}>Gangsheet Width (inch)</th>
                    <th style={{ width: 110 }}>Gangsheet Length (inch)</th>
                    <th style={{ width: 90 }}>Status</th>
                    <th style={{ width: 100 }}>Date</th>
                    <th style={{ width: 100 }}>Due</th>
                    <th style={{ minWidth: 110 }}>Agent</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {state.orders.length === 0 && (
                    <tr><td colSpan={11} style={{ textAlign: 'center', padding: 20, color: '#9ca3af', fontSize: 13 }}>
                      No orders yet — click "Add Order"
                    </td></tr>
                  )}
                  {state.orders.map((o, i) => (
                    <tr key={o.order_id}>
                      <td className="np-td-num">{i + 1}</td>
                      <td>
                        <Link to={`/orders/${o.order_id}`} style={{ color: '#0d9488', fontWeight: 600, fontSize: 12.5 }}>
                          {o.order_number}
                        </Link>
                      </td>
                      <td style={{ textAlign: 'center' }}>{o.no_artworks}</td>
                      <td style={{ textAlign: 'center' }}>{o.qty}</td>
                      <td style={{ textAlign: 'center' }}>{o.width ? `${o.width}"` : '—'}</td>
                      <td style={{ textAlign: 'center' }}>{o.length ? `${o.length}"` : '—'}</td>
                      <td>
                        <span className={cn('np-badge', STATUS_BADGE[o.status] ?? 'np-badge-yellow')}>{o.status}</span>
                      </td>
                      <td style={{ fontSize: 12 }}>{fmtDate(o.order_date)}</td>
                      <td style={{ fontSize: 12 }}>{fmtDate(o.due_date)}</td>
                      <td style={{ fontSize: 12 }}>{o.agent_name || '—'}</td>
                      <td>
                        <button className="np-del-btn" onClick={() => dispatch({ type: 'REMOVE_ORDER', order_id: o.order_id })}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="live-summary-row">
                  <td colSpan={2}><span className="live-summary-title">Orders Summary</span></td>
                  <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{orderTotals.artworks}</strong></div></td>
                  <td><div className="live-summary-stat"><span>Total Qty</span><strong>{orderTotals.qty}</strong></div></td>
                  <td colSpan={7}></td>
                </tr></tfoot>
              </table>
            </div>
          </div>

          {/* Section 2: Master Gangsheets (Fragments) */}
          <div className="np-card">
            <div className="np-card-header" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="np-section-num">2</span>
                <h3>Master Gangsheets (Fragments)</h3>
              </div>
              <button className="lb-action-btn" onClick={() => dispatch({ type: 'ADD_FRAGMENT' })}>
                <Plus size={13} /> Add Fragment
              </button>
            </div>
            <div className="np-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="np-table" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th style={{ minWidth: 150 }}>Gangsheet No</th>
                    <th style={{ minWidth: 140 }}>Order No Covers</th>
                    <th style={{ width: 90 }}>Width (in)</th>
                    <th style={{ width: 90 }}>Length (in)</th>
                    <th style={{ width: 100 }}>Artworks (No)</th>
                    <th style={{ width: 80 }}>Qty</th>
                    <th style={{ minWidth: 140 }}>Link</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {state.fragments.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: 'center', padding: 20, color: '#9ca3af', fontSize: 13 }}>
                      No fragments yet — click "Add Fragment"
                    </td></tr>
                  )}
                  {state.fragments.map((f, i) => (
                    <tr key={f.id}>
                      <td className="np-td-num">{i + 1}</td>
                      <td>
                        <input className="np-table-input" placeholder="GANGSHEET-860A"
                          value={f.fragment_no}
                          onChange={e => dispatch({ type: 'UPDATE_FRAGMENT', id: f.id, patch: { fragment_no: e.target.value } })} />
                      </td>
                      <td>
                        <select className="np-table-input" value={f.order_id}
                          onChange={e => dispatch({ type: 'UPDATE_FRAGMENT', id: f.id, patch: { order_id: e.target.value } })}>
                          <option value="">— order —</option>
                          {state.orders.map(o => <option key={o.order_id} value={o.order_id}>{o.order_number}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="number" className="np-table-input np-num-input" min={0} step={0.1}
                          value={f.width}
                          onChange={e => dispatch({ type: 'UPDATE_FRAGMENT', id: f.id, patch: { width: e.target.value } })} />
                      </td>
                      <td>
                        <input type="number" className="np-table-input np-num-input" min={0} step={0.1}
                          value={f.length}
                          onChange={e => dispatch({ type: 'UPDATE_FRAGMENT', id: f.id, patch: { length: e.target.value } })} />
                      </td>
                      <td>
                        <input type="number" className="np-table-input np-num-input" min={0}
                          value={f.artworks_count}
                          onChange={e => dispatch({ type: 'UPDATE_FRAGMENT', id: f.id, patch: { artworks_count: +e.target.value || 0 } })} />
                      </td>
                      <td>
                        <input type="number" className="np-table-input np-num-input" min={0}
                          value={f.qty}
                          onChange={e => dispatch({ type: 'UPDATE_FRAGMENT', id: f.id, patch: { qty: +e.target.value || 0 } })} />
                      </td>
                      <td>
                        {f.file_url ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <a href={f.file_url} target="_blank" rel="noreferrer"
                              style={{ color: '#0d9488', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              View Gangsheet <ExternalLink size={11} />
                            </a>
                            <button className="np-del-btn" title="Remove link"
                              onClick={() => dispatch({ type: 'UPDATE_FRAGMENT', id: f.id, patch: { file_url: '' } })}>
                              <X size={11} />
                            </button>
                          </span>
                        ) : (
                          <input className="np-table-input" placeholder="Paste file URL..."
                            value={f.file_url}
                            onChange={e => dispatch({ type: 'UPDATE_FRAGMENT', id: f.id, patch: { file_url: e.target.value } })} />
                        )}
                      </td>
                      <td>
                        <button className="np-del-btn" onClick={() => dispatch({ type: 'REMOVE_FRAGMENT', id: f.id })}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="live-summary-row">
                  <td colSpan={5}><span className="live-summary-title">Fragments Summary</span></td>
                  <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{fragTotals.artworks}</strong></div></td>
                  <td><div className="live-summary-stat"><span>Total Qty</span><strong>{fragTotals.qty}</strong></div></td>
                  <td colSpan={2}></td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══ APPAREL MODE ═══ */}
      {state.po_type === 'apparel' && (
        <div className="np-card">
          <div className="np-card-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="np-section-num">1</span>
              <h3>Custom Printed Shirt Order Items</h3>
            </div>
            <button className="lb-action-btn" onClick={() => dispatch({ type: 'ADD_ITEM' })}>
              <Plus size={13} /> Add Item
            </button>
          </div>
          <div className="np-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="np-table" style={{ minWidth: 1050 }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th style={{ minWidth: 160 }}>Item</th>
                  <th style={{ width: 110 }}>Brand</th>
                  <th style={{ width: 100 }}>Color</th>
                  <th style={{ width: 80 }}>Size</th>
                  <th style={{ width: 80 }}>Qty (Shirts)</th>
                  <th style={{ width: 120 }}>Artwork No</th>
                  <th style={{ width: 64 }}>Preview</th>
                  <th style={{ width: 90 }}>FR Size</th>
                  <th style={{ width: 90 }}>BK Size</th>
                  <th style={{ width: 96 }}>Unit Price (USD)</th>
                  <th style={{ width: 96 }}>Total (USD)</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {state.items.length === 0 && (
                  <tr><td colSpan={13} style={{ textAlign: 'center', padding: 20, color: '#9ca3af', fontSize: 13 }}>
                    No items yet — click "Add Item"
                  </td></tr>
                )}
                {state.items.map((it, i) => (
                  <tr key={it.id}>
                    <td className="np-td-num">{i + 1}</td>
                    <td>
                      <input className="np-table-input" placeholder="100% Cotton S/s T-shirt..."
                        value={it.item_name}
                        onChange={e => dispatch({ type: 'UPDATE_ITEM', id: it.id, patch: { item_name: e.target.value } })} />
                    </td>
                    <td>
                      <input className="np-table-input" placeholder="Gildan 5000"
                        value={it.brand}
                        onChange={e => dispatch({ type: 'UPDATE_ITEM', id: it.id, patch: { brand: e.target.value } })} />
                    </td>
                    <td>
                      <input className="np-table-input" placeholder="Black"
                        value={it.color}
                        onChange={e => dispatch({ type: 'UPDATE_ITEM', id: it.id, patch: { color: e.target.value } })} />
                    </td>
                    <td>
                      <input className="np-table-input" placeholder="L"
                        value={it.size}
                        onChange={e => dispatch({ type: 'UPDATE_ITEM', id: it.id, patch: { size: e.target.value } })} />
                    </td>
                    <td>
                      <input type="number" className="np-table-input np-num-input" min={1}
                        value={it.qty_ordered}
                        onChange={e => dispatch({ type: 'UPDATE_ITEM', id: it.id, patch: { qty_ordered: +e.target.value || 1 } })} />
                    </td>
                    <td>
                      <ArtworkCellPicker
                        value={it.artwork_no}
                        attached={state.artworks}
                        onPick={(a) => dispatch({
                          type: 'UPDATE_ITEM', id: it.id,
                          patch: { artwork_id: a?.id ?? null, artwork_no: a?.artwork_no ?? '', artwork_url: a?.thumbnail_url ?? a?.file_url ?? null },
                        })} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {it.artwork_url && it.artwork_url.match(/\.(png|jpe?g|webp|svg|gif)(\?|$)/i) !== null
                        ? <img src={it.artwork_url} alt="" style={{ width: 38, height: 38, objectFit: 'contain', borderRadius: 3, border: '1px solid #e5e7eb' }} />
                        : it.artwork_no
                          ? <span style={{ fontSize: 11, color: '#6b7280' }}>{it.artwork_no}</span>
                          : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>}
                    </td>
                    <td>
                      <input className="np-table-input" placeholder="12 x 16"
                        value={it.artwork_size_front}
                        onChange={e => dispatch({ type: 'UPDATE_ITEM', id: it.id, patch: { artwork_size_front: e.target.value } })} />
                    </td>
                    <td>
                      <input className="np-table-input" placeholder="12 x 16"
                        value={it.artwork_size_back}
                        onChange={e => dispatch({ type: 'UPDATE_ITEM', id: it.id, patch: { artwork_size_back: e.target.value } })} />
                    </td>
                    <td>
                      <input type="number" className="np-table-input np-num-input" min={0} step={0.01}
                        value={it.unit_price}
                        onChange={e => dispatch({ type: 'UPDATE_ITEM', id: it.id, patch: { unit_price: +e.target.value || 0 } })} />
                    </td>
                    <td style={{ textAlign: 'right', paddingRight: 8, fontWeight: 700, fontSize: 13 }}>
                      ${fmt(it.line_total)}
                    </td>
                    <td>
                      <button className="np-del-btn" onClick={() => dispatch({ type: 'REMOVE_ITEM', id: it.id })}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="live-summary-row">
                <td colSpan={5}><span className="live-summary-title">Apparel Summary</span></td>
                <td><div className="live-summary-stat"><span>Total Qty</span><strong>{state.items.reduce((sum, item) => sum + item.qty_ordered, 0)}</strong></div></td>
                <td><div className="live-summary-stat"><span>Total Artworks</span><strong>{new Set(state.items.map(item => item.artwork_no).filter(Boolean)).size}</strong></div></td>
                <td colSpan={4}></td>
                <td><div className="live-summary-stat live-summary-total"><span>Section Total</span><strong>${fmt(itemsTotal)}</strong></div></td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── ARTWORK ATTACHMENTS (both modes) ── */}
      <div className="np-card">
        <div className="np-card-header" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="np-section-num">{state.po_type === 'gangsheet' ? 3 : 2}</span>
            <h3>{state.po_type === 'gangsheet' ? 'Artwork Attachments' : 'Attach All Artworks / Files'}</h3>
          </div>
          <button className="lb-action-btn" onClick={() => setArtworkPickerOpen(true)}>
            <Plus size={13} /> Add Artwork
          </button>
        </div>

        {state.artworks.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0 18px' }}>
            {state.artworks.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 4px', borderBottom: '1px solid #f3f4f6', fontSize: 12.5,
              }}>
                <span style={{ fontWeight: 600, minWidth: 74 }}>{a.artwork_no}</span>
                {(a.thumbnail_url || a.file_url) && (a.thumbnail_url || a.file_url)!.match(/\.(png|jpe?g|webp|svg|gif)(\?|$)/i)
                  ? <img src={a.thumbnail_url || a.file_url!} alt={a.artwork_no}
                      style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 4, border: '1px solid #e5e7eb' }} />
                  : <span style={{
                      width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: '#f9fafb', borderRadius: 4, border: '1px dashed #d1d5db', color: '#9ca3af', fontSize: 10,
                    }}>{(a.file_type || 'file').toUpperCase()}</span>}
                {a.file_url ? (
                  <a href={a.file_url} target="_blank" rel="noreferrer"
                    style={{ color: '#0d9488', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3, flex: 1 }}>
                    View / Download <ExternalLink size={11} />
                  </a>
                ) : <span style={{ flex: 1, color: '#9ca3af' }}>no file</span>}
                <button className="np-del-btn" onClick={() => dispatch({ type: 'REMOVE_ARTWORK', id: a.id })}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Drag & drop upload */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); uploadArtworkFiles(e.dataTransfer.files) }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            marginTop: 14, padding: '22px 16px', textAlign: 'center', cursor: 'pointer',
            border: `2px dashed ${dragOver ? '#0d9488' : '#d1d5db'}`, borderRadius: 8,
            background: dragOver ? '#f0fdfa' : '#fafafa', transition: 'all .15s',
          }}>
          <UploadCloud size={22} style={{ color: '#9ca3af', margin: '0 auto 6px' }} />
          <div style={{ fontSize: 13, color: '#374151' }}>
            {uploading ? 'Uploading…' : <>Drag and drop files here or <span style={{ color: '#0d9488', fontWeight: 700 }}>Browse Files</span></>}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            Supported formats: PDF, JPG, PNG, AI, EPS (Max 50 MB each)
          </div>
          <input ref={fileInputRef} type="file" multiple hidden
            accept=".pdf,.jpg,.jpeg,.png,.ai,.eps,.svg,.webp"
            onChange={e => { if (e.target.files) uploadArtworkFiles(e.target.files); e.target.value = '' }} />
        </div>
      </div>

      {/* ── SPECIAL INSTRUCTIONS (apparel) ── */}
      {state.po_type === 'apparel' && (
        <div className="np-card">
          <div className="np-card-header">
            <span className="np-section-num">3</span>
            <h3>Special Instructions for Fulfillment Partner</h3>
          </div>
          <textarea className="np-textarea" rows={4}
            placeholder="Quality check requirements, packing instructions, ink specs..."
            value={state.terms_conditions}
            onChange={e => set('terms_conditions', e.target.value)} />
        </div>
      )}

      {/* ── FOOTER ACTIONS ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '16px 0 32px' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button className="lb-action-btn" onClick={handleSaveDraft} disabled={saving}>
            <FileText size={13} /> Save Draft
          </button>
        </div>
        <button className="lb-action-btn lb-action-primary" onClick={handleSavePO} disabled={saving}>
          <Save size={13} /> {isEdit ? 'Update PO' : state.po_type === 'gangsheet' ? 'Save PO' : 'Save Order'}
        </button>
      </div>

      {/* ── MODALS ── */}
      {orderPickerOpen && (
        <OrderPickerModal
          existing={state.orders.map(o => o.order_id)}
          onClose={() => setOrderPickerOpen(false)}
          onPick={async (orderId) => {
            try {
              const res = await api.get(`/orders/${orderId}`)
              const order = res.data.data ?? res.data
              dispatch({ type: 'ADD_ORDER', order: orderToCovered(order) })
            } catch { toast.error('Failed to load order') }
          }}
        />
      )}
      {artworkPickerOpen && (
        <ArtworkPickerModal
          onClose={() => setArtworkPickerOpen(false)}
          onPick={(a) => dispatch({ type: 'ADD_ARTWORK', artwork: a })}
        />
      )}
    </div>
  )
}

// ── Order picker modal ─────────────────────────────────────────────────────────

function OrderPickerModal({ existing, onPick, onClose }: {
  existing: string[]
  onPick: (orderId: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const { data } = useQuery({
    queryKey: ['gangsheet-orders-picker'],
    queryFn: () => api.get('/orders', { params: { order_type: 'gangsheet', limit: 100 } })
      .then(r => r.data.data?.rows ?? []),
  })
  const orders: any[] = (data ?? []).filter((o: any) =>
    !existing.includes(o.id) &&
    (o.order_number ?? '').toLowerCase().includes(search.toLowerCase())
  )
  return (
    <ModalShell title="Add Gangsheet Order" onClose={onClose}>
      <input className="np-input" placeholder="Search order number..." autoFocus
        value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 10 }} />
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {orders.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No gangsheet orders found</div>}
        {orders.map((o: any) => (
          <button key={o.id} className="np-dropdown-item" style={{ width: '100%' }}
            onClick={() => { onPick(o.id); onClose() }}>
            <span className="np-dropdown-name">{o.order_number}</span>
            <span className="np-dropdown-sub">
              {o.status} · {o.supplier_name ?? o.contact_name ?? '—'} · {o.order_date ? new Date(o.order_date).toLocaleDateString() : ''}
            </span>
          </button>
        ))}
      </div>
    </ModalShell>
  )
}

// ── Artwork picker modal ───────────────────────────────────────────────────────

function ArtworkPickerModal({ onPick, onClose }: {
  onPick: (a: AttachedArtwork) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const { data } = useQuery({
    queryKey: ['artworks-picker', search],
    queryFn: () => api.get('/artworks', { params: { limit: 30, search } })
      .then(r => r.data.data?.rows ?? r.data.data ?? []),
  })
  const artworks: any[] = data ?? []
  return (
    <ModalShell title="Add Artwork" onClose={onClose}>
      <input className="np-input" placeholder="Search artwork no or name..." autoFocus
        value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 10 }} />
      <div style={{ maxHeight: 340, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {artworks.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 13, gridColumn: '1 / -1' }}>No artworks found</div>}
        {artworks.map((a: any) => (
          <button key={a.id} className="np-dropdown-item"
            style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}
            onClick={() => {
              onPick({ id: a.id, artwork_no: a.artwork_no, name: a.name, file_url: a.file_url, thumbnail_url: a.thumbnail_url ?? null, file_type: a.file_type })
              onClose()
            }}>
            {a.file_url && a.file_url.match(/\.(png|jpe?g|webp|svg|gif)(\?|$)/i)
              ? <img src={a.file_url} alt="" style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 3, border: '1px solid #e5e7eb', flexShrink: 0 }} />
              : <span style={{ width: 34, height: 34, background: '#f3f4f6', borderRadius: 3, flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden' }}>
              <span className="np-dropdown-name">{a.artwork_no}</span>
              <span className="np-dropdown-sub" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
            </span>
          </button>
        ))}
      </div>
    </ModalShell>
  )
}

// ── Inline artwork cell picker (apparel items table) ───────────────────────────

function ArtworkCellPicker({ value, attached, onPick }: {
  value: string
  attached: AttachedArtwork[]
  onPick: (a: AttachedArtwork | null) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="np-table-input"
        style={{ width: '100%', textAlign: 'left', color: value ? '#0d9488' : '#9ca3af', fontWeight: value ? 600 : 400, cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        {value || 'Select…'}
      </button>
      {open && (
        <div className="np-dropdown" style={{ minWidth: 200 }}>
          {attached.length === 0 && (
            <div style={{ padding: 10, fontSize: 12, color: '#9ca3af' }}>
              Attach artworks below first
            </div>
          )}
          {attached.map(a => (
            <button key={a.id} className="np-dropdown-item"
              onMouseDown={() => { onPick(a); setOpen(false) }}>
              <span className="np-dropdown-name">{a.artwork_no}</span>
              <span className="np-dropdown-sub">{a.name}</span>
            </button>
          ))}
          {value && (
            <button className="np-dropdown-item" style={{ color: '#ef4444' }}
              onMouseDown={() => { onPick(null); setOpen(false) }}>
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Modal shell ────────────────────────────────────────────────────────────────

function ModalShell({ title, children, onClose }: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 60,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh',
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, width: 'min(520px, 92vw)',
        padding: 18, boxShadow: '0 20px 50px rgba(0,0,0,.25)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
          <button className="np-del-btn" onClick={onClose}><X size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

import { useState, useRef } from 'react'
import { Divider as MuiDivider, Menu, MenuItem } from '@mui/material'
import {
  ChevronLeft, ChevronRight, MoreHorizontal, Plus, Search, Upload, X,
} from 'lucide-react'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { cn } from '../utils/cn'
import { api } from '../services/api'

const PRODUCT_TYPES = ['Apparel', 'DTF', 'Gangsheet', 'Embroidery', 'Other'] as const
type ProductType = typeof PRODUCT_TYPES[number]

const TYPE_COLORS: Record<ProductType, { bg: string; color: string }> = {
  'DTF':       { bg: '#ccfbf1', color: '#0f766e' },
  'Gangsheet': { bg: '#ede9fe', color: '#6d28d9' },
  'Apparel':   { bg: '#dbeafe', color: '#1d4ed8' },
  'Embroidery':{ bg: '#d1fae5', color: '#065f46' },
  'Other':     { bg: '#f1f5f9', color: '#475569' },
}

interface Product {
  id: string; name: string; sku: string; product_type: ProductType
  base_price: number; stock_qty: number; description: string | null
  brand: string | null; model_number: string | null
  color: string | null; size: string | null
  is_active: boolean; created_at: string
}

interface ImportRow {
  sku: string; name: string; product_type: ProductType
  description: string | null
  brand: string; model_number: string; color: string; size: string
  _file?: string
}

const PAGE_SIZE = 25

// ── CSV parser ────────────────────────────────────────────────────────────────
// Extracts style name from model name like "Gildan - Heavy Cotton T-Shirt - 5000 Black S"
// → "Heavy Cotton T-Shirt"
function extractStyleName(modelName: string, brand: string, modelNo: string, color: string, size: string): string {
  let s = modelName.trim()
  // remove brand prefix
  if (brand && s.toLowerCase().startsWith(brand.toLowerCase())) {
    s = s.slice(brand.length).replace(/^[\s\-–]+/, '')
  }
  // remove trailing "modelNo Color Size" suffix  (e.g. "5000 Black S" or "5000 Irish Green 3XL")
  const suffix = [modelNo, color, size].filter(Boolean).join(' ')
  if (suffix) {
    const idx = s.lastIndexOf(suffix)
    if (idx !== -1) s = s.slice(0, idx).replace(/[\s\-–]+$/, '')
  }
  return s.trim() || modelName.trim()
}

function parseCatalogCsv(text: string, defaultType: ProductType): ImportRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const delim = lines[0].includes('\t') ? '\t' : ','

  const splitLine = (line: string) => {
    const result: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQ = !inQ; continue }
      if (ch === delim && !inQ) { result.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    result.push(cur.trim())
    return result
  }

  const headers = splitLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_'))

  const col = (names: string[]) => {
    for (const n of names) {
      const idx = headers.findIndex(h => h.includes(n))
      if (idx !== -1) return idx
    }
    return -1
  }
  const iSku   = col(['sku'])
  const iName  = col(['model_name', 'name'])
  const iBrand = col(['brand'])
  const iModel = col(['model_number', 'model_no', 'model'])
  const iColor = col(['color', 'colour'])
  const iSize  = col(['size'])
  const iFile  = col(['file_format', 'file', 'format'])

  const rows: ImportRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i])
    const sku      = iSku   >= 0 ? (cols[iSku]   ?? '') : ''
    const rawName  = iName  >= 0 ? (cols[iName]  ?? '') : ''
    const brand    = iBrand >= 0 ? (cols[iBrand] ?? '') : ''
    const modelNo  = iModel >= 0 ? (cols[iModel] ?? '') : ''
    const color    = iColor >= 0 ? (cols[iColor] ?? '') : ''
    const size     = iSize  >= 0 ? (cols[iSize]  ?? '') : ''
    const file     = iFile  >= 0 ? (cols[iFile]  ?? '') : ''

    if (!sku && !rawName) continue

    // Extract clean style name from model name
    const styleName = rawName
      ? extractStyleName(rawName, brand, modelNo, color, size)
      : sku

    rows.push({
      sku:          sku || rawName.slice(0, 50),
      name:         styleName,
      product_type: defaultType,
      description:  null,
      brand, model_number: modelNo, color, size,
      _file: file,
    })
  }
  return rows
}

export function ProductsPage() {
  const queryClient = useQueryClient()
  const [search,      setSearch]      = useState('')
  const [filterType,  setFilterType]  = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [page,        setPage]        = useState(1)
  const [showForm,    setShowForm]    = useState(false)
  const [menuAnchor,  setMenuAnchor]  = useState<{ el: HTMLElement; id: string } | null>(null)

  // new product form
  const [pName,    setPName]    = useState('')
  const [pType,    setPType]    = useState<ProductType>('DTF')
  const [pSku,     setPSku]     = useState('')
  const [pPrice,   setPPrice]   = useState('')
  const [pQty,     setPQty]     = useState('0')
  const [pDesc,    setPDesc]    = useState('')
  const [pBrand,   setPBrand]   = useState('')
  const [pModel,   setPModel]   = useState('')
  const [pColor,   setPColor]   = useState('')
  const [pSize,    setPSize]    = useState('')

  // csv import
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showImport,  setShowImport]  = useState(false)
  const [importRows,  setImportRows]  = useState<ImportRow[]>([])
  const [importType,  setImportType]  = useState<ProductType>('Apparel')
  const [importError, setImportError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['products', { page, search, filterType, filterBrand }],
    queryFn: () => api.get('/products', { params: { page, limit: PAGE_SIZE, search, product_type: filterType || undefined } }).then(r => r.data.data),
    placeholderData: keepPreviousData,
  })

  const allProducts: Product[] = data?.rows ?? []
  const products = filterBrand
    ? allProducts.filter(p => (p.brand ?? '').toLowerCase().includes(filterBrand.toLowerCase()))
    : allProducts
  const total: number = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const createMutation = useMutation({
    mutationFn: (payload: object) => api.post('/products', payload),
    onSuccess: () => {
      toast.success('Product added')
      setShowForm(false)
      setPName(''); setPSku(''); setPPrice(''); setPQty('0'); setPDesc('')
      setPBrand(''); setPModel(''); setPColor(''); setPSize('')
      setPage(1)
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to add product'),
  })

  const bulkImportMutation = useMutation({
    mutationFn: (rows: ImportRow[]) => api.post('/products/bulk-import', { products: rows }),
    onSuccess: (res) => {
      const { inserted, skipped } = res.data.data ?? {}
      toast.success(`Imported ${inserted} products${skipped ? ` (${skipped} duplicates skipped)` : ''}`)
      setShowImport(false)
      setImportRows([])
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Import failed'),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`/products/${id}`, { is_active: !is_active }),
    onSuccess: () => {
      toast.success('Status updated')
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setMenuAnchor(null)
    },
    onError: () => toast.error('Failed to update'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      toast.success('Product deleted')
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setMenuAnchor(null)
    },
    onError: () => toast.error('Failed to delete'),
  })

  const handleSearch = (v: string) => { setSearch(v); setPage(1) }
  const handleFilterType  = (v: string) => { setFilterType(v);  setPage(1) }
  const handleFilterBrand = (v: string) => { setFilterBrand(v); setPage(1) }

  // smart pagination: show at most 7 page buttons
  const pagesToShow = (total: number, cur: number): (number | '...')[] => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const pages: (number | '...')[] = [1]
    if (cur > 3) pages.push('...')
    for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) pages.push(i)
    if (cur < total - 2) pages.push('...')
    pages.push(total)
    return pages
  }

  const handleAddProduct = () => {
    if (!pName.trim()) { toast.error('Product name is required'); return }
    const price = parseFloat(pPrice)
    if (isNaN(price) || price < 0) { toast.error('Valid base price is required'); return }
    createMutation.mutate({
      name: pName.trim(), product_type: pType,
      sku: pSku.trim() || undefined,
      base_price: price, stock_qty: parseInt(pQty) || 0,
      description: pDesc.trim() || undefined,
      brand: pBrand.trim() || undefined,
      model_number: pModel.trim() || undefined,
      color: pColor.trim() || undefined,
      size: pSize.trim() || undefined,
    })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string
        const rows = parseCatalogCsv(text, importType)
        if (rows.length === 0) {
          setImportError('No valid rows found. Make sure your CSV has SKU and Model Name columns.')
          return
        }
        setImportRows(rows)
        setShowImport(true)
      } catch {
        setImportError('Could not parse file. Please save the Excel sheet as CSV (comma-separated).')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleImportConfirm = () => {
    if (!importRows.length) return
    const rows = importRows.map(r => ({ ...r, product_type: importType }))
    bulkImportMutation.mutate(rows)
  }

  const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, background: '#f9fafb', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '6px 10px', color: '#374151', fontSize: 12 }

  return (
    <div className="prod-page">
      <div className="cust-page-header">
        <div>
          <h2 className="cust-page-title">Products</h2>
          <p className="cust-page-sub">Manage your print catalog, types, and decoration methods.</p>
        </div>
        <div className="cust-controls">
          <div className="cust-search">
            <Search size={14} />
            <input placeholder="Search name or SKU..." value={search} onChange={(e) => handleSearch(e.target.value)} />
          </div>
          <select className="al-input" style={{ minWidth: 110, fontSize: 13, padding: '6px 10px' }} value={filterType} onChange={e => handleFilterType(e.target.value)}>
            <option value="">All Types</option>
            {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            className="al-input"
            style={{ minWidth: 100, fontSize: 13, padding: '6px 10px' }}
            placeholder="Brand..."
            value={filterBrand}
            onChange={e => handleFilterBrand(e.target.value)}
          />
          <input ref={fileInputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFileChange} />
          <button className="lb-action-btn" onClick={() => fileInputRef.current?.click()} title="Import products from CSV (save Excel as CSV first)">
            <Upload size={14} /> Import CSV
          </button>
          <button className="lb-action-btn lb-action-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> New Product
          </button>
        </div>
      </div>

      {importError && (
        <div style={{ margin: '0 0 12px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#dc2626' }}>
          {importError}
        </div>
      )}

      <div className="al-panel cust-table-wrap">
        <table className="cust-table prod-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>SKU</th>
              <th>Brand</th>
              <th>Color</th>
              <th>Size</th>
              <th>Type</th>
              <th>Base Price</th>
              <th>Stock</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={10} className="cust-empty-row">Loading...</td></tr>}
            {!isLoading && products.length === 0 && <tr><td colSpan={10} className="cust-empty-row">No products match your search.</td></tr>}
            {!isLoading && products.map((p) => {
              const tc = TYPE_COLORS[p.product_type] ?? TYPE_COLORS.Other
              const isActive = p.is_active
              return (
                <tr key={p.id} className="cust-row">
                  <td>
                    <strong className="prod-name">{p.name}</strong>
                    {p.model_number && <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>#{p.model_number}</span>}
                  </td>
                  <td><code className="prod-sku">{p.sku}</code></td>
                  <td style={{ color: '#374151', fontSize: 13 }}>{p.brand ?? '—'}</td>
                  <td>
                    {p.color
                      ? <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12 }}>
                          <span style={{ width:10, height:10, borderRadius:'50%', background: colorDot(p.color), border:'1px solid #e5e7eb', flexShrink:0 }} />
                          {p.color}
                        </span>
                      : <span style={{ color:'#d1d5db' }}>—</span>
                    }
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {p.size
                      ? <span style={{ background:'#f1f5f9', padding:'2px 7px', borderRadius:4, fontWeight:600, fontSize:11 }}>{p.size}</span>
                      : <span style={{ color:'#d1d5db' }}>—</span>
                    }
                  </td>
                  <td>
                    <span className="prod-type-badge" style={{ background: tc.bg, color: tc.color }}>{p.product_type}</span>
                  </td>
                  <td className="cust-num">${Number(p.base_price).toFixed(2)}</td>
                  <td className="cust-num">{p.stock_qty}</td>
                  <td>
                    <span className="cust-status-badge" style={isActive ? { background:'#dcfce7', color:'#15803d' } : { background:'#f1f5f9', color:'#64748b' }}>
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="lb-icon-btn" onClick={(e) => setMenuAnchor({ el: e.currentTarget, id: p.id })}>
                      <MoreHorizontal size={15} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="cust-pagination">
          <span className="cust-pag-info">
            {Math.min((page-1)*PAGE_SIZE+1, total)}–{Math.min(page*PAGE_SIZE, total)} of {total} products
          </span>
          <div className="cust-pag-controls">
            <button className="lb-action-btn cust-pag-btn" disabled={page===1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14}/></button>
            {pagesToShow(totalPages, page).map((n, i) =>
              n === '...'
                ? <span key={`e${i}`} style={{ padding: '0 4px', color: '#9ca3af', fontSize: 13, alignSelf: 'center' }}>…</span>
                : <button key={n} className={cn('lb-action-btn cust-pag-btn', n===page && 'lb-action-primary')} onClick={() => setPage(n as number)}>{n}</button>
            )}
            <button className="lb-action-btn cust-pag-btn" disabled={page===totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={14}/></button>
          </div>
        </div>
      )}

      <Menu anchorEl={menuAnchor?.el} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => {
          const p = products.find(p => p.id === menuAnchor?.id)
          if (p) toggleMutation.mutate({ id: p.id, is_active: p.is_active })
        }}>Toggle Active</MenuItem>
        <MuiDivider />
        <MenuItem onClick={() => deleteMutation.mutate(menuAnchor?.id ?? '')} sx={{ color: '#DC2626' }}>Delete</MenuItem>
      </Menu>

      {/* ── New Product Slideover ─────────────────────────────────────────────── */}
      {showForm && (
        <div className="prod-overlay" onClick={() => setShowForm(false)}>
          <div className="prod-slideover" onClick={(e) => e.stopPropagation()}>
            <div className="prod-so-header">
              <h3>New Product</h3>
              <button className="lb-icon-btn" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <div className="prod-so-body">
              <div className="al-field">
                <label>Product Name <span className="al-req">*</span></label>
                <input className="al-input" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="e.g. Heavy Cotton T-Shirt" />
              </div>
              <div className="al-field-row">
                <div className="al-field">
                  <label>Product Type <span className="al-req">*</span></label>
                  <select className="al-input" value={pType} onChange={(e) => setPType(e.target.value as ProductType)}>
                    {PRODUCT_TYPES.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="al-field">
                  <label>SKU <span className="al-optional">(auto if blank)</span></label>
                  <input className="al-input" value={pSku} onChange={(e) => setPSku(e.target.value)} placeholder="e.g. 5000-BLK-S" />
                </div>
              </div>
              <div className="al-field-row">
                <div className="al-field">
                  <label>Brand</label>
                  <input className="al-input" value={pBrand} onChange={(e) => setPBrand(e.target.value)} placeholder="e.g. Gildan" />
                </div>
                <div className="al-field">
                  <label>Model No</label>
                  <input className="al-input" value={pModel} onChange={(e) => setPModel(e.target.value)} placeholder="e.g. 5000" />
                </div>
              </div>
              <div className="al-field-row">
                <div className="al-field">
                  <label>Color</label>
                  <input className="al-input" value={pColor} onChange={(e) => setPColor(e.target.value)} placeholder="e.g. Black" />
                </div>
                <div className="al-field">
                  <label>Size</label>
                  <input className="al-input" value={pSize} onChange={(e) => setPSize(e.target.value)} placeholder="e.g. XL" />
                </div>
              </div>
              <div className="al-field-row">
                <div className="al-field">
                  <label>Base Price ($) <span className="al-req">*</span></label>
                  <input type="number" className="al-input" min={0} step={0.01} value={pPrice} onChange={(e) => setPPrice(e.target.value)} placeholder="0.00" />
                </div>
                <div className="al-field">
                  <label>Stock Qty</label>
                  <input type="number" className="al-input" min={0} value={pQty} onChange={(e) => setPQty(e.target.value)} />
                </div>
              </div>
              <div className="al-field">
                <label>Description <span className="al-optional">(optional)</span></label>
                <textarea className="al-textarea" rows={2} value={pDesc} onChange={(e) => setPDesc(e.target.value)} placeholder="Additional notes..." />
              </div>
            </div>
            <div className="prod-so-footer">
              <button className="lb-action-btn" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="lb-action-btn lb-action-primary" onClick={handleAddProduct} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Adding...' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CSV Import Modal ──────────────────────────────────────────────────── */}
      {showImport && (
        <div className="prod-overlay" onClick={() => setShowImport(false)}>
          <div className="prod-slideover" style={{ maxWidth: 860, width: '95vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="prod-so-header">
              <div>
                <h3>Import Products from CSV</h3>
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{importRows.length} rows detected</p>
              </div>
              <button className="lb-icon-btn" onClick={() => setShowImport(false)}><X size={18} /></button>
            </div>

            <div className="prod-so-body">
              <div className="al-field" style={{ marginBottom: 14 }}>
                <label>Product Type for all imported rows</label>
                <select className="al-input" style={{ maxWidth: 200 }} value={importType} onChange={(e) => setImportType(e.target.value as ProductType)}>
                  {PRODUCT_TYPES.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, maxHeight: 360, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr>
                      {['#', 'SKU', 'Style Name', 'Brand', 'Model No', 'Color', 'Size', 'File Format'].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 50).map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ ...td, color: '#9ca3af' }}>{i + 1}</td>
                        <td style={td}><code style={{ fontSize: 11, background: '#f9fafb', padding: '1px 5px', borderRadius: 4 }}>{r.sku}</code></td>
                        <td style={{ ...td, fontWeight: 600, color: '#111' }}>{r.name}</td>
                        <td style={td}>{r.brand || '—'}</td>
                        <td style={td}>{r.model_number || '—'}</td>
                        <td style={td}>
                          {r.color
                            ? <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                                <span style={{ width:9, height:9, borderRadius:'50%', background: colorDot(r.color), border:'1px solid #e5e7eb', flexShrink:0 }} />
                                {r.color}
                              </span>
                            : '—'
                          }
                        </td>
                        <td style={td}>
                          {r.size
                            ? <span style={{ background:'#f1f5f9', padding:'1px 6px', borderRadius:4, fontWeight:600, fontSize:11 }}>{r.size}</span>
                            : '—'
                          }
                        </td>
                        <td style={{ ...td, color: '#9ca3af' }}>{r._file || '—'}</td>
                      </tr>
                    ))}
                    {importRows.length > 50 && (
                      <tr>
                        <td colSpan={8} style={{ padding: '8px 10px', textAlign: 'center', color: '#9ca3af', fontSize: 11 }}>
                          ... and {importRows.length - 50} more rows (all will be imported)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
                Duplicate SKUs will be skipped. Base price = $0.00 (update later per product).
              </p>
            </div>

            <div className="prod-so-footer">
              <button className="lb-action-btn" onClick={() => setShowImport(false)}>Cancel</button>
              <button className="lb-action-btn lb-action-primary" onClick={handleImportConfirm} disabled={bulkImportMutation.isPending}>
                {bulkImportMutation.isPending ? 'Importing...' : `Import ${importRows.length} Products`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// simple color dot helper – maps common color names to hex
function colorDot(color: string): string {
  const map: Record<string, string> = {
    black: '#111', white: '#f9fafb', navy: '#1e3a5f', 'dark navy': '#0f1f3d',
    red: '#dc2626', blue: '#2563eb', green: '#16a34a', grey: '#9ca3af', gray: '#9ca3af',
    'sports grey': '#b0b8c1', 'dark heather gray': '#6b7280', 'dark heather grey': '#6b7280',
    yellow: '#fbbf24', orange: '#f97316', purple: '#7c3aed', pink: '#ec4899',
    'light pink': '#fbcfe8', brown: '#92400e', maroon: '#7f1d1d',
    'forest': '#166534', 'forest green': '#166534', 'irish green': '#15803d',
    'royal': '#1d4ed8', 'royal blue': '#1d4ed8', 'carolina blue': '#38bdf8',
    'light blue': '#bae6fd', 'heather': '#d1d5db', 'ash': '#e5e7eb',
    gold: '#d97706', silver: '#94a3b8', 'charcoal': '#4b5563',
  }
  return map[color.toLowerCase()] ?? '#94a3b8'
}

import { useState, useRef } from 'react'
import { Divider as MuiDivider, Menu, MenuItem } from '@mui/material'
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Search,
  Upload,
  X,
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

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  true:  { bg: '#dcfce7', color: '#15803d' },
  false: { bg: '#f1f5f9', color: '#64748b' },
}

interface Product {
  id: string; name: string; sku: string; product_type: ProductType
  base_price: number; stock_qty: number; description: string | null
  is_active: boolean; created_at: string
}

interface ImportRow {
  sku: string; name: string; product_type: ProductType; description: string
  _brand?: string; _model?: string; _color?: string; _size?: string; _file?: string
}

const PAGE_SIZE = 10

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCatalogCsv(text: string, defaultType: ProductType): ImportRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  // detect delimiter (comma or tab)
  const delim = lines[0].includes('\t') ? '\t' : ','

  const splitLine = (line: string) => {
    // handle quoted fields
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

  // column index detection
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
    const sku  = iSku  >= 0 ? cols[iSku]  ?? '' : ''
    const name = iName >= 0 ? cols[iName] ?? '' : ''
    if (!sku && !name) continue

    // build description from brand + model + color + size + file format
    const parts: string[] = []
    if (iBrand >= 0 && cols[iBrand]) parts.push(cols[iBrand])
    if (iModel >= 0 && cols[iModel]) parts.push(`Model: ${cols[iModel]}`)
    if (iColor >= 0 && cols[iColor]) parts.push(`Color: ${cols[iColor]}`)
    if (iSize  >= 0 && cols[iSize])  parts.push(`Size: ${cols[iSize]}`)
    if (iFile  >= 0 && cols[iFile])  parts.push(`Format: ${cols[iFile]}`)

    rows.push({
      sku:          sku || name.slice(0, 50),
      name:         name || sku,
      product_type: defaultType,
      description:  parts.join(' | '),
      _brand: iBrand >= 0 ? cols[iBrand] ?? '' : '',
      _model: iModel >= 0 ? cols[iModel] ?? '' : '',
      _color: iColor >= 0 ? cols[iColor] ?? '' : '',
      _size:  iSize  >= 0 ? cols[iSize]  ?? '' : '',
      _file:  iFile  >= 0 ? cols[iFile]  ?? '' : '',
    })
  }
  return rows
}

export function ProductsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; id: string } | null>(null)

  // new product form
  const [pName,  setPName]  = useState('')
  const [pType,  setPType]  = useState<ProductType>('DTF')
  const [pSku,   setPSku]   = useState('')
  const [pPrice, setPPrice] = useState('')
  const [pQty,   setPQty]   = useState('0')
  const [pDesc,  setPDesc]  = useState('')

  // csv import
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showImport,  setShowImport]  = useState(false)
  const [importRows,  setImportRows]  = useState<ImportRow[]>([])
  const [importType,  setImportType]  = useState<ProductType>('Apparel')
  const [importError, setImportError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['products', { page, search }],
    queryFn: () => api.get('/products', { params: { page, limit: PAGE_SIZE, search } }).then(r => r.data.data),
    placeholderData: keepPreviousData,
  })

  const products: Product[] = data?.rows ?? []
  const total: number = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const createMutation = useMutation({
    mutationFn: (payload: object) => api.post('/products', payload),
    onSuccess: () => {
      toast.success('Product added')
      setShowForm(false)
      setPName(''); setPSku(''); setPPrice(''); setPQty('0'); setPDesc('')
      setPage(1)
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to add product'),
  })

  const bulkImportMutation = useMutation({
    mutationFn: (products: ImportRow[]) => api.post('/products/bulk-import', { products }),
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

  const handleAddProduct = () => {
    if (!pName.trim()) { toast.error('Product name is required'); return }
    const price = parseFloat(pPrice)
    if (isNaN(price) || price < 0) { toast.error('Valid base price is required'); return }
    createMutation.mutate({
      name: pName.trim(), product_type: pType,
      sku: pSku.trim() || undefined,
      base_price: price, stock_qty: parseInt(pQty) || 0,
      description: pDesc.trim() || undefined,
    })
  }

  // ── CSV file handler ─────────────────────────────────────────────────────────
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
    // apply selected type to all rows
    const rows = importRows.map(r => ({ ...r, product_type: importType }))
    bulkImportMutation.mutate(rows)
  }

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
            <input
              placeholder="Search products..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          {/* Import CSV button */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            className="lb-action-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Import products from CSV (save Excel as CSV first)"
          >
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
              <th>Type</th>
              <th>Base Price</th>
              <th>Stock Qty</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="cust-empty-row">Loading...</td></tr>}
            {!isLoading && products.length === 0 && <tr><td colSpan={7} className="cust-empty-row">No products match your search.</td></tr>}
            {!isLoading && products.map((p) => {
              const tc = TYPE_COLORS[p.product_type] ?? TYPE_COLORS.Other
              const sc = STATUS_STYLES[String(p.is_active)]
              return (
                <tr key={p.id} className="cust-row">
                  <td>
                    <div>
                      <strong className="prod-name">{p.name}</strong>
                      {p.description && <p className="prod-desc">{p.description}</p>}
                    </div>
                  </td>
                  <td><code className="prod-sku">{p.sku}</code></td>
                  <td>
                    <span className="prod-type-badge" style={{ background: tc.bg, color: tc.color }}>{p.product_type}</span>
                  </td>
                  <td className="cust-num">${Number(p.base_price).toFixed(2)}</td>
                  <td className="cust-num">{p.stock_qty}</td>
                  <td>
                    <span className="cust-status-badge" style={{ background: sc.bg, color: sc.color }}>
                      {p.is_active ? 'Active' : 'Inactive'}
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
            Showing {Math.min((page-1)*PAGE_SIZE+1, total)}-{Math.min(page*PAGE_SIZE, total)} of {total} products
          </span>
          <div className="cust-pag-controls">
            <button className="lb-action-btn cust-pag-btn" disabled={page===1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14}/></button>
            {Array.from({length: totalPages}, (_, i) => i+1).map(n => (
              <button key={n} className={cn('lb-action-btn cust-pag-btn', n===page && 'lb-action-primary')} onClick={() => setPage(n)}>{n}</button>
            ))}
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
                <input className="al-input" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="e.g. Premium DTF Transfer" />
              </div>
              <div className="al-field-row">
                <div className="al-field">
                  <label>Product Type <span className="al-req">*</span></label>
                  <select className="al-input" value={pType} onChange={(e) => setPType(e.target.value as ProductType)}>
                    {PRODUCT_TYPES.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="al-field">
                  <label>SKU <span className="al-optional">(auto-generated if blank)</span></label>
                  <input className="al-input" value={pSku} onChange={(e) => setPSku(e.target.value)} placeholder="e.g. DTF-001" />
                </div>
              </div>
              <div className="al-field-row">
                <div className="al-field">
                  <label>Base Price ($) <span className="al-req">*</span></label>
                  <input type="number" className="al-input" min={0} step={0.01} value={pPrice} onChange={(e) => setPPrice(e.target.value)} placeholder="e.g. 1.50" />
                </div>
                <div className="al-field">
                  <label>Stock Qty</label>
                  <input type="number" className="al-input" min={0} value={pQty} onChange={(e) => setPQty(e.target.value)} />
                </div>
              </div>
              <div className="al-field">
                <label>Description <span className="al-optional">(optional)</span></label>
                <textarea className="al-textarea" rows={3} value={pDesc} onChange={(e) => setPDesc(e.target.value)} placeholder="Short product description..." />
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
          <div className="prod-slideover" style={{ maxWidth: 700, width: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="prod-so-header">
              <div>
                <h3>Import Products from CSV</h3>
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{importRows.length} rows detected</p>
              </div>
              <button className="lb-icon-btn" onClick={() => setShowImport(false)}><X size={18} /></button>
            </div>

            <div className="prod-so-body">
              <div className="al-field" style={{ marginBottom: 16 }}>
                <label>Product Type for all imported rows</label>
                <select className="al-input" value={importType} onChange={(e) => setImportType(e.target.value as ProductType)}>
                  {PRODUCT_TYPES.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>

              {/* Preview table */}
              <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, maxHeight: 340, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr style={{ background: '#f9fafb' }}>
                      {[['#','36px'],['SKU','100px'],['Brand','80px'],['Model No','72px'],['Color','90px'],['Size','52px'],['Model Name','220px'],['File Format','80px']].map(([h, w]) => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600, whiteSpace: 'nowrap', minWidth: w, background: '#f9fafb' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 50).map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '6px 10px', color: '#9ca3af' }}>{i + 1}</td>
                        <td style={{ padding: '6px 10px' }}><code style={{ fontSize: 11 }}>{r.sku}</code></td>
                        <td style={{ padding: '6px 10px', color: '#374151' }}>{r._brand}</td>
                        <td style={{ padding: '6px 10px', color: '#374151' }}>{r._model}</td>
                        <td style={{ padding: '6px 10px', color: '#374151' }}>{r._color}</td>
                        <td style={{ padding: '6px 10px', color: '#374151' }}>{r._size}</td>
                        <td style={{ padding: '6px 10px', fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                        <td style={{ padding: '6px 10px', color: '#6b7280' }}>{r._file}</td>
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
                Duplicate SKUs will be skipped automatically. Base price will be $0.00 — update later.
              </p>
            </div>

            <div className="prod-so-footer">
              <button className="lb-action-btn" onClick={() => setShowImport(false)}>Cancel</button>
              <button
                className="lb-action-btn lb-action-primary"
                onClick={handleImportConfirm}
                disabled={bulkImportMutation.isPending}
              >
                {bulkImportMutation.isPending ? 'Importing...' : `Import ${importRows.length} Products`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

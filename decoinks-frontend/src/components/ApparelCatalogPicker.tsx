import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Package } from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'

export interface CatalogColor { style_color_id: string; display_name: string; color_name: string; hex_color: string | null }
export interface CatalogSize { style_size_id: string; size_code: string; size_name: string }
export interface CatalogVariant { sku_id: string; sku_code: string; style_color_id: string; style_size_id: string }
export interface ApparelCatalogStyle {
  id: string; name: string; sku: string; brand: string; image_url: string | null
  description: string | null; total_colors: number; total_sizes: number; total_skus: number
  colors?: CatalogColor[]; sizes?: CatalogSize[]; variants?: CatalogVariant[]
  images?: Array<{ image_url: string; is_primary: boolean }>
}

export const APPAREL_CATEGORIES = ['T-Shirt', 'Hoodie', 'Sweatshirt', 'Polo Shirt', 'Tank Top', 'Long Sleeve', 'Jacket', 'Cap / Hat', 'Kids Apparel', 'Other']

export function ApparelCatalogPicker({ onSelect, disabled = false }: { onSelect: (style: ApparelCatalogStyle) => void; disabled?: boolean }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [loadingId, setLoadingId] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const { data: styles = [], isFetching } = useQuery<ApparelCatalogStyle[]>({
    queryKey: ['shared-apparel-product-styles', search],
    queryFn: () => api.get('/products', { params: { page: 1, limit: 50, search: search || undefined, product_type: 'Apparel' } }).then(r => r.data.data?.rows ?? []),
    enabled: !disabled,
  })

  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const choose = async (style: ApparelCatalogStyle) => {
    setLoadingId(style.id)
    try {
      const detail = (await api.get(`/products/${style.id}`)).data.data as ApparelCatalogStyle
      onSelect(detail)
      setSearch('')
      setOpen(false)
    } catch {
      toast.error('Could not load style colors and sizes')
    } finally {
      setLoadingId('')
    }
  }

  return <div ref={ref} className="nq-style-search">
    <div className="nq-style-search-input"><Package size={15} /><input disabled={disabled} value={search} placeholder="Search style by name, brand, style code or SKU..." onFocus={() => setOpen(true)} onChange={event => { setSearch(event.target.value); setOpen(true) }} />{isFetching && <span className="nq-style-searching">Searching…</span>}</div>
    {open && !disabled && <div className="nq-style-results">
      <div className="nq-style-results-label">Available Product Styles ({styles.length})</div>
      {styles.map(style => <button type="button" key={style.id} onMouseDown={() => choose(style)} disabled={loadingId === style.id}>
        {style.image_url ? <img src={style.image_url} alt="" /> : <span className="nq-style-no-image"><Package size={17} /></span>}
        <span className="nq-style-result-main"><strong>{style.name}</strong><small>{style.brand} · Style {style.sku}</small></span>
        <span className="nq-style-result-counts">{style.total_colors} colors · {style.total_sizes} sizes</span>
      </button>)}
      {!isFetching && styles.length === 0 && <div className="nq-style-empty">No matching style found.</div>}
    </div>}
  </div>
}

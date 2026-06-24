import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X, ZoomIn } from 'lucide-react'
import api from '../services/api'

const POSITIONS = ['All', 'Front', 'Back', 'Sleeve', 'Label', 'Other']

export default function ArtworksPage() {
  const [preview, setPreview]     = useState<{ url: string; name: string } | null>(null)
  const [search, setSearch]       = useState('')
  const [position, setPosition]   = useState('All')

  const { data, isLoading } = useQuery({
    queryKey: ['artworks'],
    queryFn: () => api.get('/artworks').then((r) => r.data),
  })

  const artworks = data?.artworks ?? []

  const filtered = useMemo(() => {
    return artworks.filter((aw: { name: string; artwork_number: string; position: string }) => {
      const matchSearch =
        !search ||
        aw.artwork_number.toLowerCase().includes(search.toLowerCase()) ||
        aw.name.toLowerCase().includes(search.toLowerCase())
      const matchPos = position === 'All' || aw.position?.toLowerCase() === position.toLowerCase()
      return matchSearch && matchPos
    })
  }, [artworks, search, position])

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Artworks</h2>
        <p className="text-sm text-gray-500 mt-1">View all artworks associated with your orders.</p>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by artwork code or name..."
              className="input pl-8"
            />
          </div>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="input w-40"
          >
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{p === 'All' ? 'All Positions' : p}</option>
            ))}
          </select>
          {(search || position !== 'All') && (
            <button
              onClick={() => { setSearch(''); setPosition('All') }}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
            >
              <X size={14} /> Clear
            </button>
          )}
          <span className="text-sm text-gray-400 ml-auto">{filtered.length} artwork{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          {artworks.length === 0 ? 'No artworks found' : 'No artworks match the current filters'}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {filtered.map((aw: { id: string; artwork_number: string; name: string; position: string; width: number; height: number; thumbnail_url: string | null; file_url: string }) => (
            <div
              key={aw.id}
              className="card p-0 overflow-hidden group cursor-pointer"
              onClick={() => setPreview({ url: aw.file_url, name: aw.name })}
            >
              <div className="bg-gray-900 h-32 relative flex items-center justify-center">
                {aw.thumbnail_url ? (
                  <img src={aw.thumbnail_url} alt={aw.name} className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-white/30 text-xs">No preview</span>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <ZoomIn size={20} className="text-white" />
                </div>
              </div>
              <div className="p-3">
                <p className="text-xs font-semibold text-accent">{aw.artwork_number}</p>
                <p className="text-xs text-gray-700 truncate mt-0.5">{aw.name}</p>
                <p className="text-xs text-gray-400 mt-1">{aw.position} • {aw.width}×{aw.height} in</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8"
          onClick={() => setPreview(null)}
        >
          <div className="relative max-w-3xl max-h-full" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreview(null)} className="absolute -top-10 right-0 text-white hover:text-gray-300">
              <X size={24} />
            </button>
            <img src={preview.url} alt={preview.name} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
            <p className="text-white text-center text-sm mt-3">{preview.name}</p>
          </div>
        </div>
      )}
    </div>
  )
}

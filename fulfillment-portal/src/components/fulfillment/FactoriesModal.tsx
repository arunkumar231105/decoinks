import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, Factory as FactoryIcon, Pencil, Plus, X } from 'lucide-react'
import api from '../../services/api'
import { apiError, type Factory } from './stages'

type Draft = { name: string; city: string; country: string }
const EMPTY: Draft = { name: '', city: '', country: '' }

/** The supplier's own list of factories: add, rename, switch off. */
export default function FactoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState<Draft>(EMPTY)

  const list = useQuery({
    queryKey: ['factories'],
    queryFn: () => api.get('/factories').then(r => r.data.factories as Factory[]),
    enabled: open,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['factories'] })
    qc.invalidateQueries({ queryKey: ['order-grid'] })
  }

  const create = useMutation({
    mutationFn: (d: Draft) => api.post('/factories', d),
    onSuccess: () => { refresh(); setDraft(EMPTY); toast.success('Factory added') },
    onError: err => toast.error(apiError(err, 'Could not add the factory')),
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Factory> }) => api.patch(`/factories/${id}`, body),
    onSuccess: () => { refresh(); setEditing(null); toast.success('Factory saved') },
    onError: err => toast.error(apiError(err, 'Could not save the factory')),
  })

  if (!open) return null
  const rows = list.data ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="factories-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h3 id="factories-title" className="text-base font-semibold text-ink">Factories</h3>
            <p className="mt-0.5 text-[13px] text-muted">The factories you push orders to. Pick one on each purchase order.</p>
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-slate-100" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <form className="grid grid-cols-1 gap-2 border-b border-line px-5 py-4 sm:grid-cols-[1.4fr_1fr_1fr_auto]"
          onSubmit={e => { e.preventDefault(); if (draft.name.trim()) create.mutate(draft) }}>
          <input className="fp-input" placeholder="Factory name" maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          <input className="fp-input" placeholder="City" maxLength={80} value={draft.city} onChange={e => setDraft({ ...draft, city: e.target.value })} />
          <input className="fp-input" placeholder="Country" maxLength={80} value={draft.country} onChange={e => setDraft({ ...draft, country: e.target.value })} />
          <button type="submit" className="fp-btn fp-btn-primary h-10 whitespace-nowrap" disabled={!draft.name.trim() || create.isPending}>
            <Plus size={14} /> Add
          </button>
        </form>

        <div className="min-h-[140px] overflow-y-auto px-5 py-3">
          {list.isLoading ? <p className="py-8 text-center text-sm text-muted">Loading…</p>
            : rows.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400"><FactoryIcon size={20} /></span>
                <p className="mt-3 text-sm font-semibold text-ink">No factories yet</p>
                <p className="mt-1 text-[13px] text-muted">Add the first one above.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map(f => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    {editing === f.id ? (
                      <>
                        <input className="fp-input min-w-[140px] flex-[1.4]" maxLength={120} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} />
                        <input className="fp-input min-w-[100px] flex-1" maxLength={80} placeholder="City" value={edit.city} onChange={e => setEdit({ ...edit, city: e.target.value })} />
                        <input className="fp-input min-w-[100px] flex-1" maxLength={80} placeholder="Country" value={edit.country} onChange={e => setEdit({ ...edit, country: e.target.value })} />
                        <button className="fp-btn fp-btn-primary h-9" disabled={!edit.name.trim() || update.isPending}
                          onClick={() => update.mutate({ id: f.id, body: { name: edit.name, city: edit.city || null, country: edit.country || null } })}>
                          <Check size={14} /> Save
                        </button>
                        <button className="fp-btn h-9" onClick={() => setEditing(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-semibold ${f.is_active ? 'text-ink' : 'text-muted line-through'}`}>{f.name}</p>
                          <p className="truncate text-xs text-muted">
                            {[f.city, f.country].filter(Boolean).join(', ') || 'No location'} · {f.po_count ?? 0} PO{(f.po_count ?? 0) === 1 ? '' : 's'}
                          </p>
                        </div>
                        <button className="fp-btn h-9" onClick={() => { setEditing(f.id); setEdit({ name: f.name, city: f.city ?? '', country: f.country ?? '' }) }}>
                          <Pencil size={13} /> Edit
                        </button>
                        <button className="fp-btn h-9" disabled={update.isPending}
                          onClick={() => update.mutate({ id: f.id, body: { is_active: !f.is_active } })}>
                          {f.is_active ? 'Switch off' : 'Switch on'}
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </div>
  )
}

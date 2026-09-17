import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Info, Plus, X } from 'lucide-react'
import api from '../../services/api'
import { SUPPLIER_STAGES, apiError, type Factory, type FactoriesResponse, type GridRow } from './stages'

/**
 * Move one purchase order along: its stage, the factory making it, the day it
 * was pushed there, and a note (shown as the tracking status on an Exception).
 *
 * Once a PO has shipped, its stage comes from the courier, so only the factory,
 * the push date and the note stay editable.
 */
export default function StageEditor({ row, onClose }: { row: GridRow | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [stage, setStage] = useState('')
  const [factoryId, setFactoryId] = useState('')
  const [pushDate, setPushDate] = useState('')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [newFactory, setNewFactory] = useState('')

  useEffect(() => {
    if (!row) return
    setStage(row.stage_editable ? (row.supplier_stage ?? row.stage) : '')
    setFactoryId(row.factory?.id ?? '')
    setPushDate(row.push_date ?? '')
    setNote(row.stage_note ?? '')
    setAdding(false)
    setNewFactory('')
  }, [row])

  const factories = useQuery({
    queryKey: ['factories'],
    queryFn: () => api.get('/factories').then(r => r.data as FactoriesResponse),
    enabled: Boolean(row),
  })
  // A PO can only go to a factory of the supplier it was issued to.
  const active = (factories.data?.factories ?? [])
    .filter(f => !f.supplier_id || !row?.supplier || f.supplier_id === row.supplier.id)
    .filter(f => f.is_active || f.id === row?.factory?.id)

  const addFactory = useMutation({
    mutationFn: (name: string) => api.post('/factories', { name, supplier_id: row?.supplier?.id }).then(r => r.data.factory as Factory),
    onSuccess: f => {
      qc.invalidateQueries({ queryKey: ['factories'] })
      setFactoryId(f.id)
      setAdding(false)
      setNewFactory('')
      toast.success(`Factory “${f.name}” added`)
    },
    onError: err => toast.error(apiError(err, 'Could not add the factory')),
  })

  const save = useMutation({
    mutationFn: () => {
      if (!row) return Promise.resolve(null)
      // Only what changed: an untouched, empty push date must not stop the
      // server filling it in when the order moves to Factory Audit.
      const body: Record<string, unknown> = {}
      if (row.stage_editable && stage && stage !== (row.supplier_stage ?? row.stage)) body.stage = stage
      if ((factoryId || null) !== (row.factory?.id ?? null)) body.factory_id = factoryId || null
      if ((pushDate || null) !== (row.push_date ?? null)) body.push_date = pushDate || null
      if ((note.trim() || null) !== (row.stage_note ?? null)) body.note = note.trim() || null
      if (Object.keys(body).length === 0) return Promise.resolve(row)
      return api.patch(`/purchase-orders/${row.id}/stage`, body).then(r => r.data.row as GridRow)
    },
    onSuccess: updated => {
      qc.invalidateQueries({ queryKey: ['order-grid'] })
      qc.invalidateQueries({ queryKey: ['order-row'] })
      qc.invalidateQueries({ queryKey: ['factories'] })
      toast.success(updated ? `${updated.po_number} updated — ${updated.stage}` : 'Updated')
      onClose()
    },
    onError: err => toast.error(apiError(err, 'Could not update this purchase order')),
  })

  if (!row) return null
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="stage-editor-title"
        className="w-full max-w-md rounded-2xl bg-white shadow-pop"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h3 id="stage-editor-title" className="text-base font-semibold text-ink">Update {row.po_number}</h3>
            <p className="mt-0.5 text-[13px] text-muted">{[row.supplier?.name, row.customer_name, row.order_number].filter(Boolean).join(' · ')}</p>
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-slate-100" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form className="space-y-4 px-5 py-4" onSubmit={e => { e.preventDefault(); save.mutate() }}>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Stage</span>
            {row.stage_editable ? (
              <select className="fp-input w-full" value={stage} onChange={e => setStage(e.target.value)}>
                {SUPPLIER_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <div className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-muted">
                <Info size={15} className="mt-0.5 shrink-0" />
                <span><b className="text-ink">{row.stage}</b> — set by the courier tracking now that this order has shipped.</span>
              </div>
            )}
          </label>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Factory</span>
            {adding ? (
              <div className="flex gap-2">
                <input
                  autoFocus className="fp-input min-w-0 flex-1" placeholder="e.g. Shenzhen Print Co." maxLength={120}
                  value={newFactory} onChange={e => setNewFactory(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (newFactory.trim()) addFactory.mutate(newFactory.trim()) } }}
                />
                <button type="button" className="fp-btn fp-btn-primary h-10" disabled={!newFactory.trim() || addFactory.isPending}
                  onClick={() => addFactory.mutate(newFactory.trim())}>Add</button>
                <button type="button" className="fp-btn h-10" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select className="fp-input min-w-0 flex-1" value={factoryId} onChange={e => setFactoryId(e.target.value)}>
                  <option value="">— No factory —</option>
                  {active.map(f => <option key={f.id} value={f.id}>{f.name}{f.is_active ? '' : ' (switched off)'}</option>)}
                </select>
                <button type="button" className="fp-btn h-10 whitespace-nowrap" onClick={() => setAdding(true)}>
                  <Plus size={14} /> New
                </button>
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Push date</span>
            <input type="date" className="fp-input w-full" value={pushDate} max={today} onChange={e => setPushDate(e.target.value)} />
            <span className="mt-1 block text-xs text-muted">The day it went to the factory. Filled in for you when you move it to Factory Audit or In Production.</span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Note {stage === 'Exception' && <span className="text-rose-600">(shown as the tracking status)</span>}</span>
            <textarea className="fp-input h-auto min-h-[72px] w-full py-2" maxLength={500} placeholder={stage === 'Exception' ? 'e.g. Delay at factory' : 'Optional'}
              value={note} onChange={e => setNote(e.target.value)} />
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="fp-btn h-10" onClick={onClose}>Cancel</button>
            <button type="submit" className="fp-btn fp-btn-primary h-10" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

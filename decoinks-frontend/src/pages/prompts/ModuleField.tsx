import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { api } from '../../services/api'
import toast from '../../utils/toast'
import { apiMessage, type PromptModule } from './types'

const CREATE = '__create__'

/**
 * The module select, with a way to create one.
 *
 * Without this the dropdown is empty on a fresh install and nothing can ever
 * fill it — the studio's areas are the shop's own, not ours to seed.
 */
export function ModuleField({
  value, onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const modules = useQuery({
    queryKey: ['prompt-modules'],
    queryFn: () => api.get('/prompts/modules').then(r => r.data.data as PromptModule[]),
  })

  const create = useMutation({
    mutationFn: () => api.post('/prompts/modules', {
      name: name.trim(),
      // The key is derived so the admin is not asked for two names for one thing.
      key: name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''),
    }).then(r => r.data.data as PromptModule),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['prompt-modules'] })
      onChange(m.id)
      setAdding(false)
      setName('')
      toast.success(`Module "${m.name}" added`)
    },
    onError: (err) => toast.error(apiMessage(err, 'Could not add the module')),
  })

  if (adding) {
    return (
      <div className="pm-field">
        <label>New Module</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="pm-input" value={name} autoFocus placeholder="Reconstruction"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) create.mutate() }} />
          <button className="pm-btn primary icon" disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}><Check size={16} /></button>
          <button className="pm-btn icon" onClick={() => { setAdding(false); setName('') }}>
            <X size={16} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pm-field">
      <label>Module</label>
      <select
        className="pm-input"
        value={value}
        onChange={e => {
          if (e.target.value === CREATE) { setAdding(true); return }
          onChange(e.target.value)
        }}
      >
        <option value="">No module</option>
        {(modules.data ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        <option value={CREATE}>+ Create new module…</option>
      </select>
    </div>
  )
}

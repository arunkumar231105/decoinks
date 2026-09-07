import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Sparkles, X } from 'lucide-react'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'
import toast from '../utils/toast'
import { ModuleField } from './prompts/ModuleField'
import {
  PROMPT_STATUSES, apiMessage, fmtDate,
  type Prompt, type PromptModule,
} from './prompts/types'
import '../styles/prompts.css'

const EDIT_ROLES = ['Admin', 'Manager']

export function PromptsListPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role)
  const canEdit = EDIT_ROLES.includes(String(role))

  const [search, setSearch] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [status, setStatus] = useState('All')
  const [creating, setCreating] = useState(false)

  const modules = useQuery({
    queryKey: ['prompt-modules'],
    queryFn: () => api.get('/prompts/modules').then(r => r.data.data as PromptModule[]),
  })

  const list = useQuery({
    queryKey: ['prompts', { search, moduleId, status }],
    queryFn: () => api.get('/prompts', {
      params: {
        search: search || undefined,
        module_id: moduleId || undefined,
        status: status === 'All' ? undefined : status,
      },
    }).then(r => r.data.data as Prompt[]),
  })

  const rows = list.data ?? []

  return (
    <div className="pm-page">
      <header className="pm-actionbar">
        <label className="pm-search">
          <Search size={19} />
          <input
            value={search}
            placeholder="Search by prompt name or key…"
            onChange={e => setSearch(e.target.value)}
          />
        </label>

        <label className="pm-filter">
          <span>Module</span>
          <select value={moduleId} onChange={e => setModuleId(e.target.value)}>
            <option value="">All modules</option>
            {(modules.data ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>

        <label className="pm-filter">
          <span>Status</span>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option>All</option>
            {PROMPT_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>

        {canEdit && (
          <button className="pm-btn primary" onClick={() => setCreating(true)}>
            <Plus size={18} /> New Prompt
          </button>
        )}
      </header>

      <section className="pm-card">
        <div className="pm-table-scroll">
          <table className="pm-table">
            <thead>
              <tr>
                <th>Prompt</th>
                <th>Module</th>
                <th>Used In</th>
                <th>Live Version</th>
                <th>Draft</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr><td className="pm-empty" colSpan={7}>Loading prompts…</td></tr>
              )}

              {!list.isLoading && rows.length === 0 && (
                <tr>
                  <td className="pm-empty" colSpan={7}>
                    <Sparkles size={22} style={{ opacity: .6 }} />
                    <p style={{ margin: '10px 0 0' }}>
                      {search || moduleId || status !== 'All'
                        ? 'No prompt matches these filters.'
                        : 'No prompts yet. Create the first one to start managing what the AI is told.'}
                    </p>
                  </td>
                </tr>
              )}

              {rows.map(p => (
                <tr key={p.id} onClick={() => nav(`/prompts/${p.id}`)}>
                  <td>
                    <div className="pm-name">
                      <b>{p.name}</b>
                      <span className="pm-key">{p.prompt_key}</span>
                    </div>
                  </td>
                  <td>{p.module_name ?? '—'}</td>
                  <td>{p.used_in ?? '—'}</td>
                  <td>
                    {p.production_version
                      ? <span className="pm-pill production">v{p.production_version}</span>
                      : <span className="pm-pill archived">Not published</span>}
                  </td>
                  <td>
                    {p.draft_version
                      ? <span className="pm-pill draft">v{p.draft_version}</span>
                      : '—'}
                  </td>
                  <td>
                    <span className={`pm-pill ${p.status === 'Active' ? 'active'
                      : p.status === 'Disabled' ? 'disabled' : 'archived'}`}>{p.status}</span>
                  </td>
                  <td>{fmtDate(p.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {creating && (
        <NewPromptModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            qc.invalidateQueries({ queryKey: ['prompts'] })
            setCreating(false)
            nav(`/prompts/${id}`)
          }}
        />
      )}
    </div>
  )
}

function NewPromptModal({
  onClose, onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [form, setForm] = useState({
    name: '', prompt_key: '', module_id: '', description: '', used_in: '',
  })

  const create = useMutation({
    mutationFn: () => api.post('/prompts', {
      name: form.name.trim(),
      prompt_key: form.prompt_key.trim().toUpperCase(),
      module_id: form.module_id || null,
      description: form.description.trim() || null,
      used_in: form.used_in.trim() || null,
    }).then(r => r.data.data as Prompt),
    onSuccess: (p) => { toast.success('Prompt created with an empty draft'); onCreated(p.id) },
    onError: (err) => toast.error(apiMessage(err, 'Could not create the prompt')),
  })

  const set = (k: keyof typeof form) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }))
  const ready = form.name.trim() && /^[A-Za-z0-9._-]+$/.test(form.prompt_key.trim())

  return (
    <div className="pm-modal-backdrop" onClick={onClose}>
      <div className="pm-modal" onClick={e => e.stopPropagation()}>
        <header>
          <h3>New Prompt</h3>
          <button className="pm-btn ghost small" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="pm-modal-body">
          <div className="pm-field">
            <label>Prompt Name</label>
            <input value={form.name} onChange={set('name')} placeholder="Artwork Reconstruction" />
          </div>

          <div className="pm-field">
            <label>Prompt Key</label>
            <input
              value={form.prompt_key}
              onChange={set('prompt_key')}
              placeholder="AIS.RECREATE.GENERATE"
              style={{ fontFamily: 'ui-monospace, monospace' }}
            />
            <small>
              How the application asks for this prompt. Letters, numbers, dots, dashes and
              underscores only — it is a contract with the code and cannot be changed later.
            </small>
          </div>

          <ModuleField value={form.module_id} onChange={v => setForm(f => ({ ...f, module_id: v }))} />

          <div className="pm-field">
            <label>Used In</label>
            <input value={form.used_in} onChange={set('used_in')}
              placeholder="AI Studio → Reconstruction" />
            <small>Where this runs in the application, so the effect of a change is visible before it is made.</small>
          </div>

          <div className="pm-field">
            <label>Description</label>
            <textarea value={form.description} onChange={set('description')}
              style={{ minHeight: 80, fontFamily: 'inherit', fontSize: '14.5px' }} />
          </div>
        </div>

        <footer>
          <button className="pm-btn" onClick={onClose}>Cancel</button>
          <button className="pm-btn primary" disabled={!ready || create.isPending}
            onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create Prompt'}
          </button>
        </footer>
      </div>
    </div>
  )
}

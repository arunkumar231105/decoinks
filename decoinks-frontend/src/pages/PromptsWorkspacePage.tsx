import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Camera, CheckCircle2, GitBranch, MoreVertical, Pencil, Play, Plus, Save, Search, Trash2, X,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'
import toast from '../utils/toast'
import { ModuleField } from './prompts/ModuleField'
import { PromptTab } from './prompts/PromptTab'
import { VariablesTab } from './prompts/VariablesTab'
import { ModelTab } from './prompts/ModelTab'
import { VersionsTab } from './prompts/VersionsTab'
import {
  PROMPT_STATUSES, apiMessage, fmtDate, tileColour,
  type Prompt, type PromptModule, type PromptVersion,
} from './prompts/types'
import '../styles/prompts.css'

const EDIT_ROLES = ['Admin', 'Manager']
type Tab = 'prompt' | 'variables' | 'model' | 'versions'
const TABS: { key: Tab; label: string }[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'variables', label: 'Variables' },
  { key: 'model', label: 'Model' },
  { key: 'versions', label: 'Versions' },
]

export function PromptsWorkspacePage() {
  const { id: routeId } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role)
  const canEdit = EDIT_ROLES.includes(String(role))

  const [search, setSearch] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [status, setStatus] = useState('All')
  const [sort, setSort] = useState<'name' | 'recent'>('name')
  const [tab, setTab] = useState<Tab>('prompt')
  const [versionId, setVersionId] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingDetails, setEditingDetails] = useState(false)
  const [testing, setTesting] = useState(false)

  // The Save Draft button sits in the tab bar; whichever tab is open lends it
  // its saver, so one button saves the thing the admin is actually looking at.
  const [saver, setSaver] = useState<{ fn: (() => void) | null; busy: boolean }>({ fn: null, busy: false })
  const registerSave = (fn: (() => void) | null, busy: boolean) => setSaver({ fn, busy })

  const modules = useQuery({
    queryKey: ['prompt-modules'],
    queryFn: () => api.get('/prompts/modules').then(r => r.data.data as PromptModule[]),
  })

  const list = useQuery({
    queryKey: ['prompts', { search, moduleId, status, sort }],
    queryFn: () => api.get('/prompts', {
      params: {
        search: search || undefined,
        module_id: moduleId || undefined,
        status: status === 'All' ? undefined : status,
        sort,
      },
    }).then(r => r.data.data as Prompt[]),
  })
  const rows = list.data ?? []

  // Open the first prompt when none is named, so the pane is never empty for
  // no reason.
  const selectedId = routeId || rows[0]?.id || ''
  useEffect(() => {
    if (!routeId && rows[0]?.id) nav(`/prompts/${rows[0].id}`, { replace: true })
  }, [routeId, rows])

  const prompt = useQuery({
    queryKey: ['prompt', selectedId],
    queryFn: () => api.get(`/prompts/${selectedId}`).then(r => r.data.data as Prompt),
    enabled: Boolean(selectedId),
  })

  const versions = prompt.data?.versions ?? []
  useEffect(() => {
    if (!versions.length) { setVersionId(''); return }
    if (versionId && versions.some(v => v.id === versionId)) return
    const draft = versions.find(v => v.status === 'draft')
    const live = versions.find(v => v.status === 'production')
    setVersionId((draft ?? live ?? versions[0]).id)
  }, [versions, versionId])
  useEffect(() => { setVersionId('') }, [selectedId])

  const version = useQuery({
    queryKey: ['prompt-version', versionId],
    queryFn: () => api.get(`/prompts/versions/${versionId}`).then(r => r.data.data as PromptVersion),
    enabled: Boolean(versionId),
  })

  const refresh = (nextVersionId?: string) => {
    qc.invalidateQueries({ queryKey: ['prompts'] })
    qc.invalidateQueries({ queryKey: ['prompt', selectedId] })
    qc.invalidateQueries({ queryKey: ['prompt-version', versionId] })
    if (nextVersionId) { setVersionId(nextVersionId); qc.invalidateQueries({ queryKey: ['prompt-version', nextVersionId] }) }
  }

  const p = prompt.data
  const current = version.data

  return (
    <div className="pm-workspace">
      <div className="pm-left">
        <div className="pm-left-head">
          <h2>Prompt Management</h2>
          <p>Manage and version control all AI prompts used in Artwork Studio.</p>
        </div>

        <div className="pm-searchrow">
          <label className="pm-search">
            <Search size={17} />
            <input value={search} placeholder="Search prompts…" onChange={e => setSearch(e.target.value)} />
          </label>
          {canEdit && (
            <button className="pm-btn primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New Prompt
            </button>
          )}
        </div>

        <div className="pm-filters">
          <select className="pm-select" value={moduleId} onChange={e => setModuleId(e.target.value)}>
            <option value="">All Modules</option>
            {(modules.data ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select className="pm-select" value={status} onChange={e => setStatus(e.target.value)}>
            <option>All Status</option>
            {PROMPT_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select className="pm-select" value={sort} onChange={e => setSort(e.target.value as 'name' | 'recent')}>
            <option value="name">Name (A–Z)</option>
            <option value="recent">Recently updated</option>
          </select>
        </div>

        <div className="pm-list">
          {list.isLoading && <div className="pm-empty">Loading prompts…</div>}
          {!list.isLoading && rows.length === 0 && (
            <div className="pm-empty">
              {search || moduleId || status !== 'All'
                ? 'No prompt matches these filters.'
                : 'No prompts yet. Create the first one to start managing what the AI is told.'}
            </div>
          )}
          {rows.map(r => (
            <button key={r.id}
              className={`pm-card ${r.id === selectedId ? 'selected' : ''}`}
              onClick={() => { nav(`/prompts/${r.id}`); setTab('prompt') }}>
              <span className="pm-icon" style={{ background: tileColour(r.module_key ?? r.prompt_key) }}>
                <Camera size={21} />
              </span>
              <span className="pm-card-body">
                <b>{r.name}</b>
                <span className="pm-key">{r.prompt_key}</span>
                <span className="pm-card-meta">
                  {r.module_name && <span className="pm-chip module">{r.module_name}</span>}
                </span>
              </span>
              <span className="pm-card-right">
                <span className={`pm-chip ${r.production_version ? 'version' : 'muted'}`}>
                  {r.production_version ? `v${r.production_version}` : 'Not published'}
                </span>
                <span className={`pm-chip ${r.status === 'Active' ? 'active' : r.status === 'Disabled' ? 'disabled' : 'archived'}`}>
                  {r.status}
                </span>
                {r.draft_version && <span className="pm-chip draft">v{r.draft_version}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="pm-right">
        {!p && <div className="pm-spinner">{prompt.isLoading ? 'Loading prompt…' : 'Select a prompt to begin.'}</div>}

        {p && (
          <>
            <header className="pm-detail-head">
              <span className="pm-icon" style={{ background: tileColour(p.module_key ?? p.prompt_key) }}>
                <Camera size={24} />
              </span>

              <div style={{ minWidth: 0 }}>
                <div className="pm-detail-title">
                  <h2>{p.name}</h2>
                  <span className={`pm-chip ${p.status === 'Active' ? 'active' : p.status === 'Disabled' ? 'disabled' : 'archived'}`}>
                    {p.status}
                  </span>
                </div>
                <div className="pm-key" style={{ marginTop: 3 }}>{p.prompt_key}</div>
                <div className="pm-detail-sub">
                  <span>{p.module_name ?? 'No module'}</span>
                  <span className="pm-sep">|</span>
                  <span>Used in: {p.used_in ?? '—'}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 22 }}>
                <div className="pm-version-stat">
                  <span>Production Version</span>
                  <span className={`pm-chip ${p.production_version ? 'version' : 'muted'}`}>
                    {p.production_version ? `v${p.production_version}` : 'Not published'}
                  </span>
                </div>
                <div className="pm-version-stat">
                  <span>Draft Version</span>
                  <span className={`pm-chip ${p.draft_version ? 'draft' : 'muted'}`}>
                    {p.draft_version ? `v${p.draft_version}` : 'None'}
                  </span>
                </div>
              </div>

              <PromptMenu
                prompt={p}
                canEdit={canEdit}
                onEdit={() => setEditingDetails(true)}
                onChanged={() => refresh()}
              />
            </header>

            <nav className="pm-tabbar">
              <div className="pm-tabs">
                {TABS.map(t => (
                  <button key={t.key} className={`pm-tab ${tab === t.key ? 'active' : ''}`}
                    onClick={() => setTab(t.key)}>
                    {t.label}
                    {t.key === 'variables' && current?.variables?.length ? ` (${current.variables.length})` : ''}
                    {t.key === 'versions' ? ` (${versions.length})` : ''}
                  </button>
                ))}
              </div>
              <div className="pm-tabbar-actions">
                <button className="pm-btn" disabled={!current} onClick={() => setTesting(true)}>
                  <Play size={15} /> Test
                </button>
                <button className="pm-btn primary" disabled={!saver.fn || saver.busy}
                  title={saver.fn ? undefined : 'Only an open draft can be saved'}
                  onClick={() => saver.fn?.()}>
                  <Save size={15} /> {saver.busy ? 'Saving…' : 'Save Draft'}
                </button>
              </div>
            </nav>

            <div className="pm-body">
              {versions.length > 1 && tab !== 'versions' && (
                <div className="pm-field" style={{ maxWidth: 300 }}>
                  <label>Viewing version</label>
                  <select className="pm-input" value={versionId} onChange={e => setVersionId(e.target.value)}>
                    {versions.map(v => (
                      <option key={v.id} value={v.id}>
                        v{v.version_number} — {v.status === 'production' ? 'Production' : v.status === 'draft' ? 'Draft' : 'Archived'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {version.isLoading && <div className="pm-spinner">Loading version…</div>}

              {current && tab === 'prompt' && (
                <PromptTab version={current} canEdit={canEdit} registerSave={registerSave} onSaved={() => refresh()} />
              )}
              {current && tab === 'variables' && (
                <VariablesTab version={current} canEdit={canEdit} onChanged={() => refresh()} />
              )}
              {current && tab === 'model' && (
                <ModelTab version={current} canEdit={canEdit} registerSave={registerSave} onSaved={() => refresh()} />
              )}
              {tab === 'versions' && (
                <VersionsTab prompt={p} versions={versions} canEdit={canEdit} selectedId={versionId}
                  onOpen={(vid) => { setVersionId(vid); setTab('prompt') }}
                  onChanged={(vid) => refresh(vid)} />
              )}
            </div>
          </>
        )}
      </div>

      {creating && (
        <PromptFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => { qc.invalidateQueries({ queryKey: ['prompts'] }); setCreating(false); nav(`/prompts/${id}`) }}
        />
      )}
      {editingDetails && p && (
        <PromptFormModal prompt={p} onClose={() => setEditingDetails(false)}
          onSaved={() => { setEditingDetails(false); refresh() }} />
      )}
      {testing && current && (
        <TestModal version={current} onClose={() => setTesting(false)} />
      )}
    </div>
  )
}

/* ── The ⋮ menu on the detail header ──────────────────────────────────────── */

function PromptMenu({
  prompt, canEdit, onEdit, onChanged,
}: {
  prompt: Prompt
  canEdit: boolean
  onEdit: () => void
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const setStatus = useMutation({
    mutationFn: (status: string) => api.put(`/prompts/${prompt.id}`, { status }),
    onSuccess: () => { toast.success('Prompt updated'); setOpen(false); onChanged() },
    onError: (err) => toast.error(apiMessage(err, 'Could not update the prompt')),
  })

  return (
    <div className="pm-menu-wrap" ref={wrap}>
      <button className="pm-btn icon" onClick={() => setOpen(v => !v)} aria-label="More"><MoreVertical size={17} /></button>
      {open && (
        <div className="pm-menu">
          <button disabled={!canEdit} onClick={() => { setOpen(false); onEdit() }}>
            <Pencil size={15} /> Edit prompt details
          </button>
          <button onClick={() => {
            navigator.clipboard?.writeText(prompt.prompt_key)
            toast.success('Prompt key copied'); setOpen(false)
          }}>
            <GitBranch size={15} /> Copy prompt key
          </button>
          {prompt.status === 'Active' ? (
            <button disabled={!canEdit || setStatus.isPending} onClick={() => setStatus.mutate('Disabled')}>
              <X size={15} /> Disable prompt
            </button>
          ) : (
            <button disabled={!canEdit || setStatus.isPending} onClick={() => setStatus.mutate('Active')}>
              <CheckCircle2 size={15} /> Activate prompt
            </button>
          )}
          <button className="danger" disabled={!canEdit || setStatus.isPending}
            onClick={() => {
              if (window.confirm(`Archive ${prompt.name}? It stays on file and can be activated again.`)) {
                setStatus.mutate('Archived')
              }
            }}>
            <Trash2 size={15} /> Archive prompt
          </button>
        </div>
      )}
    </div>
  )
}

/* ── New / edit prompt ────────────────────────────────────────────────────── */

function PromptFormModal({
  prompt, onClose, onSaved,
}: {
  prompt?: Prompt
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const editing = Boolean(prompt)
  const [form, setForm] = useState({
    name: prompt?.name ?? '',
    prompt_key: prompt?.prompt_key ?? '',
    module_id: prompt?.module_id ?? '',
    description: prompt?.description ?? '',
    used_in: prompt?.used_in ?? '',
    status: prompt?.status ?? 'Active',
  })

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        module_id: form.module_id || null,
        description: form.description.trim() || null,
        used_in: form.used_in.trim() || null,
        status: form.status,
      }
      return editing
        ? api.put(`/prompts/${prompt!.id}`, body).then(r => r.data.data as Prompt)
        : api.post('/prompts', { ...body, prompt_key: form.prompt_key.trim().toUpperCase() })
            .then(r => r.data.data as Prompt)
    },
    onSuccess: (p) => { toast.success(editing ? 'Prompt updated' : 'Prompt created with an empty draft'); onSaved(p.id) },
    onError: (err) => toast.error(apiMessage(err, 'Could not save the prompt')),
  })

  const set = (k: keyof typeof form) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }))
  const ready = form.name.trim() && (editing || /^[A-Za-z0-9._-]+$/.test(form.prompt_key.trim()))

  return (
    <div className="pm-modal-backdrop" onClick={onClose}>
      <div className="pm-modal" onClick={e => e.stopPropagation()}>
        <header>
          <h3>{editing ? 'Edit Prompt' : 'New Prompt'}</h3>
          <button className="pm-btn icon small ghost" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="pm-modal-body">
          <div className="pm-field">
            <label>Prompt Name</label>
            <input className="pm-input" value={form.name} onChange={set('name')} placeholder="Artwork Reconstruction" />
          </div>

          <div className="pm-field">
            <label>Prompt Key</label>
            <input className="pm-input" value={form.prompt_key} disabled={editing} onChange={set('prompt_key')}
              placeholder="AIS.RECREATE.GENERATE" style={{ fontFamily: 'ui-monospace, monospace' }} />
            <small>
              {editing
                ? 'The key is how the application asks for this prompt, so it never changes.'
                : 'How the application asks for this prompt. Letters, numbers, dots, dashes and underscores only — it is a contract with the code and cannot be changed later.'}
            </small>
          </div>

          <div className="pm-grid2">
            <ModuleField value={form.module_id ?? ''} onChange={v => setForm(f => ({ ...f, module_id: v }))} />
            <div className="pm-field">
              <label>Status</label>
              <select className="pm-input" value={form.status} onChange={set('status')}>
                {PROMPT_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="pm-field">
            <label>Used In</label>
            <input className="pm-input" value={form.used_in} onChange={set('used_in')}
              placeholder="Reconstruction → Generate Artwork" />
            <small>Where this runs in the application, so the effect of a change is visible before it is made.</small>
          </div>

          <div className="pm-field">
            <label>Description</label>
            <textarea className="pm-input" value={form.description} onChange={set('description')} />
          </div>
        </div>

        <footer>
          <button className="pm-btn" onClick={onClose}>Cancel</button>
          <button className="pm-btn primary" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Prompt'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/* ── Test ─────────────────────────────────────────────────────────────────── */

function TestModal({ version, onClose }: { version: PromptVersion; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<any>(null)
  const vars = useMemo(() => version.variables ?? [], [version])

  const run = useMutation({
    mutationFn: () => api.post(`/prompts/versions/${version.id}/test`, { values }).then(r => r.data.data),
    onSuccess: (data) => {
      setResult(data)
      if (data.status === 'ok') toast.success('Test run recorded')
      else toast.error('Test incomplete — required values are missing')
    },
    onError: (err) => toast.error(apiMessage(err, 'Could not run the test')),
  })

  return (
    <div className="pm-modal-backdrop" onClick={onClose}>
      <div className="pm-modal wide" onClick={e => e.stopPropagation()}>
        <header>
          <h3>Test v{version.version_number}</h3>
          <button className="pm-btn icon small ghost" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="pm-modal-body">
          {vars.length === 0
            ? <div className="pm-notice info"><Play size={15} />
                <span>This version declares no variables, so the prompt resolves exactly as written.</span>
              </div>
            : (
              <div className="pm-grid2">
                {vars.map(v => (
                  <div className="pm-field" key={v.id}>
                    <label>{v.variable_name}{v.required && <span className="pm-chip version" style={{ marginLeft: 7 }}>Required</span>}</label>
                    <input className="pm-input" value={values[v.variable_name] ?? ''}
                      placeholder={v.default_value ?? `${v.type} · from ${v.source}`}
                      onChange={e => setValues({ ...values, [v.variable_name]: e.target.value })} />
                  </div>
                ))}
              </div>
            )}

          {result && (
            <>
              {result.missing_required?.length > 0 && (
                <div className="pm-notice">
                  <Play size={15} />
                  <span>Missing required values: <b>{result.missing_required.join(', ')}</b>.</span>
                </div>
              )}
              {result.output_data?.note && (
                <div className="pm-notice info"><Play size={15} /><span>{result.output_data.note}</span></div>
              )}
              <pre className="pm-preview">{result.resolved_prompt || '(this version has no instructions yet)'}</pre>
            </>
          )}
        </div>

        <footer>
          <button className="pm-btn" onClick={onClose}>Close</button>
          <button className="pm-btn primary" disabled={run.isPending} onClick={() => run.mutate()}>
            <Play size={15} /> {run.isPending ? 'Running…' : 'Run Test'}
          </button>
        </footer>
      </div>
    </div>
  )
}

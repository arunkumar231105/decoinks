import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Check, GitBranch, Lock, Pencil, Play, Plus, RotateCcw, Save, Trash2, X,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuthStore } from '../store/authStore'
import toast from '../utils/toast'
import { ModuleField } from './prompts/ModuleField'
import {
  PROMPT_STATUSES, PROVIDERS, VARIABLE_SOURCES, VARIABLE_TYPES,
  apiMessage, fmtDateTime,
  type Prompt, type PromptTest, type PromptVariable, type PromptVersion,
} from './prompts/types'
import '../styles/prompts.css'

const EDIT_ROLES = ['Admin', 'Manager']
type Tab = 'prompt' | 'variables' | 'versions'

export function PromptDetailPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role)
  const canEdit = EDIT_ROLES.includes(String(role))

  const [tab, setTab] = useState<Tab>('prompt')
  const [selectedVersionId, setSelectedVersionId] = useState<string>('')
  const [editingDetails, setEditingDetails] = useState(false)

  const prompt = useQuery({
    queryKey: ['prompt', id],
    queryFn: () => api.get(`/prompts/${id}`).then(r => r.data.data as Prompt),
    enabled: Boolean(id),
  })

  const versions = prompt.data?.versions ?? []

  // Open on whatever the admin is most likely to want: the draft they are
  // working on, otherwise the version that is actually live.
  useEffect(() => {
    if (!versions.length) return
    if (selectedVersionId && versions.some(v => v.id === selectedVersionId)) return
    const draft = versions.find(v => v.status === 'draft')
    const live = versions.find(v => v.status === 'production')
    setSelectedVersionId((draft ?? live ?? versions[0]).id)
  }, [versions, selectedVersionId])

  const version = useQuery({
    queryKey: ['prompt-version', selectedVersionId],
    queryFn: () => api.get(`/prompts/versions/${selectedVersionId}`).then(r => r.data.data as PromptVersion),
    enabled: Boolean(selectedVersionId),
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['prompt', id] })
    qc.invalidateQueries({ queryKey: ['prompt-version', selectedVersionId] })
    qc.invalidateQueries({ queryKey: ['prompts'] })
  }

  const newVersion = useMutation({
    mutationFn: (from_version_id: string | null) =>
      api.post(`/prompts/${id}/versions`, { from_version_id }).then(r => r.data.data as PromptVersion),
    onSuccess: (v) => {
      toast.success(`Draft v${v.version_number} created from the current version`)
      setSelectedVersionId(v.id)
      setTab('prompt')
      refresh()
    },
    onError: (err) => toast.error(apiMessage(err, 'Could not create a new version')),
  })

  const publish = useMutation({
    mutationFn: (versionId: string) => api.post(`/prompts/versions/${versionId}/publish`),
    onSuccess: () => { toast.success('Version published — it is now live'); refresh() },
    onError: (err) => toast.error(apiMessage(err, 'Could not publish this version')),
  })

  if (prompt.isLoading) return <div className="pm-page"><div className="pm-spinner">Loading prompt…</div></div>
  if (prompt.isError || !prompt.data) {
    return (
      <div className="pm-page">
        <div className="pm-card pm-empty">
          <p>This prompt could not be loaded.</p>
          <button className="pm-btn" onClick={() => nav('/prompts')}>Back to prompts</button>
        </div>
      </div>
    )
  }

  const p = prompt.data
  const current = version.data
  const isDraft = current?.status === 'draft'
  const draftExists = versions.some(v => v.status === 'draft')

  return (
    <div className="pm-page">
      <header className="pm-detail-head">
        <div style={{ minWidth: 0 }}>
          <button className="pm-btn ghost small" style={{ paddingLeft: 0, marginBottom: 4 }}
            onClick={() => nav('/prompts')}>
            <ArrowLeft size={16} /> All Prompts
          </button>
          <h2>{p.name}</h2>
          <div className="pm-detail-meta">
            <span className="pm-key">{p.prompt_key}</span>
            <span>Module: <b>{p.module_name ?? '—'}</b></span>
            <span>Used in: <b>{p.used_in ?? '—'}</b></span>
            <span>Live: <b>{p.production_version ? `v${p.production_version}` : 'Not published'}</b></span>
            <span className={`pm-pill ${p.status === 'Active' ? 'active'
              : p.status === 'Disabled' ? 'disabled' : 'archived'}`}>{p.status}</span>
          </div>
        </div>

        {canEdit && (
          <div className="pm-head-actions">
            <button className="pm-btn" onClick={() => setEditingDetails(true)}>
              <Pencil size={16} /> Edit Details
            </button>
            <button className="pm-btn" disabled={draftExists || newVersion.isPending}
              title={draftExists ? 'A draft is already open — publish or delete it first' : undefined}
              onClick={() => newVersion.mutate(p.production_version_id ?? null)}>
              <GitBranch size={16} /> New Version
            </button>
            {isDraft && (
              <button className="pm-btn primary" disabled={publish.isPending}
                onClick={() => publish.mutate(current!.id)}>
                <Check size={16} /> Publish v{current!.version_number}
              </button>
            )}
          </div>
        )}
      </header>

      <nav className="pm-tabs">
        <button className={`pm-tab ${tab === 'prompt' ? 'active' : ''}`} onClick={() => setTab('prompt')}>
          Prompt
        </button>
        <button className={`pm-tab ${tab === 'variables' ? 'active' : ''}`} onClick={() => setTab('variables')}>
          Variables{current?.variables?.length ? ` (${current.variables.length})` : ''}
        </button>
        <button className={`pm-tab ${tab === 'versions' ? 'active' : ''}`} onClick={() => setTab('versions')}>
          Versions ({versions.length})
        </button>
      </nav>

      {versions.length > 1 && tab !== 'versions' && (
        <label className="pm-filter" style={{ maxWidth: 320 }}>
          <span>Viewing version</span>
          <select value={selectedVersionId} onChange={e => setSelectedVersionId(e.target.value)}>
            {versions.map(v => (
              <option key={v.id} value={v.id}>
                v{v.version_number} — {v.status === 'production' ? 'Live' : v.status === 'draft' ? 'Draft' : 'Archived'}
              </option>
            ))}
          </select>
        </label>
      )}

      {version.isLoading && <div className="pm-card pm-spinner">Loading version…</div>}

      {current && tab === 'prompt' && (
        <PromptTab version={current} canEdit={canEdit} onSaved={refresh} />
      )}
      {current && tab === 'variables' && (
        <VariablesTab version={current} canEdit={canEdit} onChanged={refresh} />
      )}
      {tab === 'versions' && (
        <VersionsTab
          prompt={p}
          versions={versions}
          canEdit={canEdit}
          onOpen={(vid) => { setSelectedVersionId(vid); setTab('prompt') }}
          onChanged={refresh}
        />
      )}

      {editingDetails && (
        <EditDetailsModal prompt={p} onClose={() => setEditingDetails(false)}
          onSaved={() => { setEditingDetails(false); refresh() }} />
      )}
    </div>
  )
}

/* ── Tab 1: the instructions and the model that runs them ─────────────────── */

function PromptTab({
  version, canEdit, onSaved,
}: {
  version: PromptVersion
  canEdit: boolean
  onSaved: () => void
}) {
  const locked = version.status !== 'draft' || !canEdit

  const [form, setForm] = useState({
    system_instruction: version.system_instruction ?? '',
    task_instruction: version.task_instruction ?? '',
    dynamic_context: version.dynamic_context ?? '',
    restrictions: version.restrictions ?? '',
    change_summary: version.change_summary ?? '',
    provider: version.provider ?? 'OpenAI',
    model_name: version.model_name ?? 'GPT-5.5',
    temperature: version.temperature == null ? '' : String(version.temperature),
    max_tokens: version.max_tokens == null ? '' : String(version.max_tokens),
  })

  // Switching version in the picker must reload the editor, not keep the old text.
  useEffect(() => {
    setForm({
      system_instruction: version.system_instruction ?? '',
      task_instruction: version.task_instruction ?? '',
      dynamic_context: version.dynamic_context ?? '',
      restrictions: version.restrictions ?? '',
      change_summary: version.change_summary ?? '',
      provider: version.provider ?? 'OpenAI',
      model_name: version.model_name ?? 'GPT-5.5',
      temperature: version.temperature == null ? '' : String(version.temperature),
      max_tokens: version.max_tokens == null ? '' : String(version.max_tokens),
    })
  }, [version.id])

  const set = (k: keyof typeof form) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }))

  const save = useMutation({
    mutationFn: () => api.put(`/prompts/versions/${version.id}`, {
      system_instruction: form.system_instruction || null,
      task_instruction: form.task_instruction || null,
      dynamic_context: form.dynamic_context || null,
      restrictions: form.restrictions || null,
      change_summary: form.change_summary || null,
      model: {
        provider: form.provider,
        model_name: form.model_name,
        temperature: form.temperature === '' ? null : Number(form.temperature),
        max_tokens: form.max_tokens === '' ? null : Number(form.max_tokens),
      },
    }),
    onSuccess: () => { toast.success(`Draft v${version.version_number} saved`); onSaved() },
    onError: (err) => toast.error(apiMessage(err, 'Could not save this version')),
  })

  const models = PROVIDERS[form.provider] ?? []

  return (
    <>
      <section className="pm-card">
        <div className="pm-section">
          {locked && (
            <div className="pm-notice">
              <Lock size={17} />
              <span>
                {version.status === 'production'
                  ? `v${version.version_number} is live and is the record of what ran. Create a new version to make changes.`
                  : version.status === 'archived'
                    ? `v${version.version_number} is archived history and cannot be edited.`
                    : 'Your role can read prompts but not change them.'}
              </span>
            </div>
          )}

          <h3>Instructions</h3>
          <p className="pm-hint">
            Write <code>{'{{variable_name}}'}</code> wherever a value should be filled in at run time.
            Declare each one on the Variables tab.
          </p>

          <div className="pm-field">
            <label>System Instruction</label>
            <textarea value={form.system_instruction} onChange={set('system_instruction')} disabled={locked}
              placeholder="Who the model is and how it should behave." />
          </div>

          <div className="pm-field">
            <label>Task Instruction</label>
            <textarea value={form.task_instruction} onChange={set('task_instruction')} disabled={locked}
              placeholder="What it must produce, step by step." />
          </div>

          <div className="pm-field">
            <label>Dynamic Context</label>
            <textarea value={form.dynamic_context} onChange={set('dynamic_context')} disabled={locked}
              placeholder="Job, customer or asset detail injected from the system." />
          </div>

          <div className="pm-field">
            <label>Restrictions</label>
            <textarea value={form.restrictions} onChange={set('restrictions')} disabled={locked}
              placeholder="What the model must never do." />
          </div>
        </div>

        <div className="pm-section">
          <h3>Model Configuration</h3>
          <p className="pm-hint">
            Saved with this version, so publishing freezes the model together with the words.
          </p>

          <div className="pm-grid">
            <div className="pm-field">
              <label>Provider</label>
              <select value={form.provider} disabled={locked}
                onChange={e => setForm(f => ({
                  ...f, provider: e.target.value, model_name: PROVIDERS[e.target.value]?.[0] ?? '',
                }))}>
                {Object.keys(PROVIDERS).map(pv => <option key={pv}>{pv}</option>)}
              </select>
            </div>

            <div className="pm-field">
              <label>Model</label>
              <select value={form.model_name} onChange={set('model_name')} disabled={locked}>
                {models.map(m => <option key={m}>{m}</option>)}
                {!models.includes(form.model_name) && form.model_name && (
                  <option>{form.model_name}</option>
                )}
              </select>
            </div>

            <div className="pm-field">
              <label>Temperature</label>
              <input type="number" step="0.1" min="0" max="2" value={form.temperature}
                onChange={set('temperature')} disabled={locked} placeholder="0.3" />
              <small>0 is repeatable, 2 is loose. Leave empty to use the provider default.</small>
            </div>

            <div className="pm-field">
              <label>Max Tokens</label>
              <input type="number" min="1" value={form.max_tokens}
                onChange={set('max_tokens')} disabled={locked} placeholder="4000" />
            </div>
          </div>

          <div className="pm-field">
            <label>Change Summary</label>
            <input value={form.change_summary} onChange={set('change_summary')} disabled={locked}
              placeholder="What changed in this version, and why"
              style={{ fontFamily: 'inherit' }} />
          </div>

          {!locked && (
            <button className="pm-btn primary" disabled={save.isPending} onClick={() => save.mutate()}>
              <Save size={17} /> {save.isPending ? 'Saving…' : 'Save Draft'}
            </button>
          )}
        </div>
      </section>

      <TestPanel version={version} canEdit={canEdit} />
    </>
  )
}

/* ── Resolve and try ──────────────────────────────────────────────────────── */

function TestPanel({ version, canEdit }: { version: PromptVersion; canEdit: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<{ resolved_prompt: string; missing_required: string[] } | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => { setValues({}); setResult(null); setNote(null) }, [version.id])

  const vars = version.variables ?? []

  const preview = useMutation({
    mutationFn: () => api.post(`/prompts/versions/${version.id}/preview`, { values })
      .then(r => r.data.data),
    onSuccess: (data) => { setResult(data); setNote(null) },
    onError: (err) => toast.error(apiMessage(err, 'Could not resolve the prompt')),
  })

  const run = useMutation({
    mutationFn: () => api.post(`/prompts/versions/${version.id}/test`, { values })
      .then(r => r.data.data as PromptTest & { resolved_prompt: string; missing_required: string[] }),
    onSuccess: (data) => {
      setResult(data)
      setNote(String(data.output_data?.note ?? ''))
      if (data.status === 'ok') toast.success('Test run recorded')
      else toast.error('Test incomplete — required values are missing')
    },
    onError: (err) => toast.error(apiMessage(err, 'Could not run the test')),
  })

  return (
    <section className="pm-card">
      <div className="pm-section">
        <h3>Resolve &amp; Test</h3>
        <p className="pm-hint">
          Fill in sample values to see exactly what the model would receive.
        </p>

        {vars.length === 0 && (
          <div className="pm-notice info">
            <Play size={16} />
            <span>This version declares no variables, so the prompt resolves exactly as written.</span>
          </div>
        )}

        {vars.length > 0 && (
          <div className="pm-grid">
            {vars.map(v => (
              <div className="pm-field" key={v.id}>
                <label>
                  {v.variable_name}
                  {v.required && <span className="pm-pill required" style={{ marginLeft: 8 }}>Required</span>}
                </label>
                <input
                  value={values[v.variable_name] ?? ''}
                  placeholder={v.default_value ?? `${v.type} · from ${v.source}`}
                  onChange={e => setValues({ ...values, [v.variable_name]: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="pm-btn" disabled={preview.isPending} onClick={() => preview.mutate()}>
            <Play size={16} /> {preview.isPending ? 'Resolving…' : 'Resolve Preview'}
          </button>
          {canEdit && (
            <button className="pm-btn" disabled={run.isPending} onClick={() => run.mutate()}>
              <Play size={16} /> {run.isPending ? 'Running…' : 'Run Test'}
            </button>
          )}
        </div>

        {result && (
          <div style={{ marginTop: 16 }}>
            {result.missing_required?.length > 0 && (
              <div className="pm-notice">
                <Lock size={16} />
                <span>
                  Still missing: <b>{result.missing_required.join(', ')}</b>. They are left as
                  placeholders below so you can see which value did not arrive.
                </span>
              </div>
            )}
            {note && <div className="pm-notice info"><Play size={16} /><span>{note}</span></div>}
            <pre className="pm-preview">{result.resolved_prompt || '(this version has no instructions yet)'}</pre>
          </div>
        )}
      </div>
    </section>
  )
}

/* ── Tab 2: variables ─────────────────────────────────────────────────────── */

const BLANK_VARIABLE = {
  variable_name: '', type: 'Text', required: false,
  default_value: '', source: 'Job / CRM', description: '',
}

function VariablesTab({
  version, canEdit, onChanged,
}: {
  version: PromptVersion
  canEdit: boolean
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const locked = version.status !== 'draft' || !canEdit
  const [editing, setEditing] = useState<PromptVariable | 'new' | null>(null)

  const list = useQuery({
    queryKey: ['prompt-variables', version.id],
    queryFn: () => api.get(`/prompts/versions/${version.id}/variables`)
      .then(r => r.data.data as PromptVariable[]),
  })

  const after = () => {
    qc.invalidateQueries({ queryKey: ['prompt-variables', version.id] })
    onChanged()
    setEditing(null)
  }

  const remove = useMutation({
    mutationFn: (variableId: string) => api.delete(`/prompts/variables/${variableId}`),
    onSuccess: () => { toast.success('Variable removed'); after() },
    onError: (err) => toast.error(apiMessage(err, 'Could not remove the variable')),
  })

  const rows = list.data ?? []

  return (
    <section className="pm-card">
      <div className="pm-section">
        {locked && (
          <div className="pm-notice">
            <Lock size={17} />
            <span>
              {version.status === 'draft'
                ? 'Your role can read variables but not change them.'
                : `Variables belong to v${version.version_number}, which is ${version.status === 'production' ? 'live' : 'archived'}. Create a new version to change them.`}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div>
            <h3>Variables</h3>
            <p className="pm-hint" style={{ margin: 0 }}>
              What may change from job to job. Each one is filled into <code>{'{{name}}'}</code> at run time.
            </p>
          </div>
          {!locked && (
            <button className="pm-btn primary" onClick={() => setEditing('new')}>
              <Plus size={17} /> Add Variable
            </button>
          )}
        </div>

        <div className="pm-table-scroll">
          <table className="pm-table">
            <thead>
              <tr>
                <th>Variable</th><th>Type</th><th>Source</th>
                <th>Required</th><th>Default</th><th>Description</th>
                {!locked && <th style={{ width: 120 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {list.isLoading && <tr><td className="pm-empty" colSpan={7}>Loading…</td></tr>}
              {!list.isLoading && rows.length === 0 && (
                <tr><td className="pm-empty" colSpan={7}>
                  No variables yet. This version's instructions are used exactly as written.
                </td></tr>
              )}
              {rows.map(v => (
                <tr key={v.id} style={{ cursor: locked ? 'default' : 'pointer' }}
                  onClick={() => !locked && setEditing(v)}>
                  <td><span className="pm-key">{`{{${v.variable_name}}}`}</span></td>
                  <td>{v.type}</td>
                  <td>{v.source}</td>
                  <td>
                    <span className={`pm-pill ${v.required ? 'required' : 'optional'}`}>
                      {v.required ? 'Required' : 'Optional'}
                    </span>
                  </td>
                  <td>{v.default_value || '—'}</td>
                  <td style={{ maxWidth: 280 }}>{v.description || '—'}</td>
                  {!locked && (
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="pm-btn small" onClick={() => setEditing(v)}>
                          <Pencil size={14} />
                        </button>
                        <button className="pm-btn small danger" disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm(`Remove {{${v.variable_name}}} from this draft?`)) remove.mutate(v.id)
                          }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <VariableModal
          versionId={version.id}
          variable={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={after}
        />
      )}
    </section>
  )
}

function VariableModal({
  versionId, variable, onClose, onSaved,
}: {
  versionId: string
  variable: PromptVariable | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    ...BLANK_VARIABLE,
    ...(variable ? {
      variable_name: variable.variable_name,
      type: variable.type,
      required: variable.required,
      default_value: variable.default_value ?? '',
      source: variable.source,
      description: variable.description ?? '',
    } : {}),
  })

  const body = () => ({
    variable_name: form.variable_name.trim(),
    type: form.type,
    required: form.required,
    default_value: form.default_value || null,
    source: form.source,
    description: form.description || null,
  })

  const save = useMutation({
    mutationFn: () => variable
      ? api.put(`/prompts/variables/${variable.id}`, body())
      : api.post(`/prompts/versions/${versionId}/variables`, body()),
    onSuccess: () => { toast.success(variable ? 'Variable updated' : 'Variable added'); onSaved() },
    onError: (err) => toast.error(apiMessage(err, 'Could not save the variable')),
  })

  const set = (k: keyof typeof form) => (e: any) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const ready = /^[A-Za-z0-9_]+$/.test(form.variable_name.trim())

  return (
    <div className="pm-modal-backdrop" onClick={onClose}>
      <div className="pm-modal" onClick={e => e.stopPropagation()}>
        <header>
          <h3>{variable ? 'Edit Variable' : 'Add Variable'}</h3>
          <button className="pm-btn ghost small" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="pm-modal-body">
          <div className="pm-field">
            <label>Variable Name</label>
            <input value={form.variable_name} onChange={set('variable_name')}
              placeholder="artwork_reference" style={{ fontFamily: 'ui-monospace, monospace' }} />
            <small>Letters, numbers and underscores. Written in the instructions as <code>{`{{${form.variable_name || 'name'}}}`}</code>.</small>
          </div>

          <div className="pm-grid">
            <div className="pm-field">
              <label>Type</label>
              <select value={form.type} onChange={set('type')}>
                {VARIABLE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>

            <div className="pm-field">
              <label>Source</label>
              <select value={form.source} onChange={set('source')}>
                {VARIABLE_SOURCES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="pm-field">
            <label>Default Value</label>
            <input value={form.default_value} onChange={set('default_value')}
              placeholder="Used when nothing is supplied" style={{ fontFamily: 'inherit' }} />
          </div>

          <div className="pm-field">
            <label>Description</label>
            <input value={form.description} onChange={set('description')}
              placeholder="What this value is, for whoever reads it next" style={{ fontFamily: 'inherit' }} />
          </div>

          <label className="pm-check">
            <input type="checkbox" checked={form.required} onChange={set('required')} />
            <span>Required — a run without it is incomplete</span>
          </label>
        </div>

        <footer>
          <button className="pm-btn" onClick={onClose}>Cancel</button>
          <button className="pm-btn primary" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : variable ? 'Save Variable' : 'Add Variable'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/* ── Tab 3: versions ──────────────────────────────────────────────────────── */

function VersionsTab({
  prompt, versions, canEdit, onOpen, onChanged,
}: {
  prompt: Prompt
  versions: PromptVersion[]
  canEdit: boolean
  onOpen: (id: string) => void
  onChanged: () => void
}) {
  const rollback = useMutation({
    mutationFn: (versionId: string) => api.post(`/prompts/versions/${versionId}/rollback`),
    onSuccess: () => { toast.success('Rolled back — this version is live again'); onChanged() },
    onError: (err) => toast.error(apiMessage(err, 'Could not roll back to this version')),
  })

  const publish = useMutation({
    mutationFn: (versionId: string) => api.post(`/prompts/versions/${versionId}/publish`),
    onSuccess: () => { toast.success('Version published — it is now live'); onChanged() },
    onError: (err) => toast.error(apiMessage(err, 'Could not publish this version')),
  })

  const remove = useMutation({
    mutationFn: (versionId: string) => api.delete(`/prompts/versions/${versionId}`),
    onSuccess: () => { toast.success('Draft deleted'); onChanged() },
    onError: (err) => toast.error(apiMessage(err, 'Could not delete this draft')),
  })

  return (
    <section className="pm-card">
      <div className="pm-section">
        <h3>Version History</h3>
        <p className="pm-hint">
          Every published version is kept. Rolling back makes an older one live again — nothing is destroyed.
        </p>

        <div className="pm-versions">
          {versions.map(v => (
            <article key={v.id} className={`pm-version ${v.status === 'production' ? 'live' : ''}`}>
              <div className="pm-version-main">
                <b>
                  v{v.version_number}{' '}
                  <span className={`pm-pill ${v.status}`}>
                    {v.status === 'production' ? 'Live' : v.status === 'draft' ? 'Draft' : 'Archived'}
                  </span>
                </b>
                <small>{v.change_summary || 'No change summary'}</small>
                <small>
                  {v.variable_count ?? 0} variable{(v.variable_count ?? 0) === 1 ? '' : 's'}
                  {' · '}{v.provider ?? '—'} {v.model_name ?? ''}
                  {' · '}created {fmtDateTime(v.created_at)}
                  {v.created_by_name ? ` by ${v.created_by_name}` : ''}
                  {v.published_at ? ` · published ${fmtDateTime(v.published_at)}` : ''}
                </small>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button className="pm-btn small" onClick={() => onOpen(v.id)}>Open</button>

                {canEdit && v.status === 'draft' && (
                  <>
                    <button className="pm-btn small primary" disabled={publish.isPending}
                      onClick={() => publish.mutate(v.id)}>
                      <Check size={14} /> Publish
                    </button>
                    {!v.published_at && (
                      <button className="pm-btn small danger" disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete draft v${v.version_number}? This cannot be undone.`)) remove.mutate(v.id)
                        }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </>
                )}

                {canEdit && v.status === 'archived' && (
                  <button className="pm-btn small" disabled={rollback.isPending}
                    onClick={() => {
                      if (window.confirm(`Make v${v.version_number} live again?`)) rollback.mutate(v.id)
                    }}>
                    <RotateCcw size={14} /> Roll Back
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Prompt details ───────────────────────────────────────────────────────── */

function EditDetailsModal({
  prompt, onClose, onSaved,
}: {
  prompt: Prompt
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: prompt.name,
    module_id: prompt.module_id ?? '',
    description: prompt.description ?? '',
    used_in: prompt.used_in ?? '',
    status: prompt.status,
  })

  const save = useMutation({
    mutationFn: () => api.put(`/prompts/${prompt.id}`, {
      name: form.name.trim(),
      module_id: form.module_id || null,
      description: form.description.trim() || null,
      used_in: form.used_in.trim() || null,
      status: form.status,
    }),
    onSuccess: () => { toast.success('Prompt updated'); onSaved() },
    onError: (err) => toast.error(apiMessage(err, 'Could not update the prompt')),
  })

  const set = (k: keyof typeof form) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="pm-modal-backdrop" onClick={onClose}>
      <div className="pm-modal" onClick={e => e.stopPropagation()}>
        <header>
          <h3>Edit Prompt</h3>
          <button className="pm-btn ghost small" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="pm-modal-body">
          <div className="pm-field">
            <label>Prompt Name</label>
            <input value={form.name} onChange={set('name')} style={{ fontFamily: 'inherit' }} />
          </div>

          <div className="pm-field">
            <label>Prompt Key</label>
            <input value={prompt.prompt_key} disabled style={{ fontFamily: 'ui-monospace, monospace' }} />
            <small>The key is how the application asks for this prompt, so it never changes.</small>
          </div>

          <div className="pm-grid">
            <ModuleField value={form.module_id} onChange={v => setForm(f => ({ ...f, module_id: v }))} />

            <div className="pm-field">
              <label>Status</label>
              <select value={form.status} onChange={set('status')}>
                {PROMPT_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="pm-field">
            <label>Used In</label>
            <input value={form.used_in} onChange={set('used_in')} style={{ fontFamily: 'inherit' }} />
          </div>

          <div className="pm-field">
            <label>Description</label>
            <textarea value={form.description} onChange={set('description')}
              style={{ minHeight: 90, fontFamily: 'inherit', fontSize: '14.5px' }} />
          </div>
        </div>

        <footer>
          <button className="pm-btn" onClick={onClose}>Cancel</button>
          <button className="pm-btn primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}

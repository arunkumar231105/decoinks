import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../services/api'
import toast from '../../utils/toast'
import {
  VARIABLE_SOURCES, VARIABLE_TYPES, apiMessage,
  type PromptVariable, type PromptVersion,
} from './types'

const BLANK = {
  variable_name: '', type: 'Text', required: false,
  default_value: '', source: 'Job / CRM', description: '',
  min_length: '', max_length: '', allowed_values: '',
  use_min: false, use_max: false, use_allowed: false,
}

type Draft = typeof BLANK

const draftFrom = (v: PromptVariable): Draft => {
  const rules = (v.validation_rules ?? {}) as Record<string, unknown>
  return {
    variable_name: v.variable_name,
    type: v.type,
    required: v.required,
    default_value: v.default_value ?? '',
    source: v.source,
    description: v.description ?? '',
    min_length: rules.min_length != null ? String(rules.min_length) : '',
    max_length: rules.max_length != null ? String(rules.max_length) : '',
    allowed_values: Array.isArray(rules.allowed_values) ? (rules.allowed_values as string[]).join(', ') : '',
    use_min: rules.min_length != null,
    use_max: rules.max_length != null,
    use_allowed: Array.isArray(rules.allowed_values),
  }
}

export function VariablesTab({
  version, canEdit, onChanged,
}: {
  version: PromptVersion
  canEdit: boolean
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const locked = version.status !== 'draft' || !canEdit
  const [selected, setSelected] = useState<PromptVariable | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [adding, setAdding] = useState(false)

  const list = useQuery({
    queryKey: ['prompt-variables', version.id],
    queryFn: () => api.get(`/prompts/versions/${version.id}/variables`)
      .then(r => r.data.data as PromptVariable[]),
  })
  const rows = list.data ?? []

  useEffect(() => { setSelected(null); setAdding(false); setDraft(BLANK) }, [version.id])

  const after = () => {
    qc.invalidateQueries({ queryKey: ['prompt-variables', version.id] })
    onChanged()
    setSelected(null); setAdding(false); setDraft(BLANK)
  }

  const body = () => {
    const rules: Record<string, unknown> = {}
    if (draft.use_min && draft.min_length !== '') rules.min_length = Number(draft.min_length)
    if (draft.use_max && draft.max_length !== '') rules.max_length = Number(draft.max_length)
    if (draft.use_allowed && draft.allowed_values.trim()) {
      rules.allowed_values = draft.allowed_values.split(',').map(s => s.trim()).filter(Boolean)
    }
    return {
      variable_name: draft.variable_name.trim(),
      type: draft.type,
      required: draft.required,
      default_value: draft.default_value || null,
      source: draft.source,
      description: draft.description || null,
      validation_rules: rules,
    }
  }

  const save = useMutation({
    mutationFn: () => selected
      ? api.put(`/prompts/variables/${selected.id}`, body())
      : api.post(`/prompts/versions/${version.id}/variables`, body()),
    onSuccess: () => { toast.success(selected ? 'Variable updated' : 'Variable added'); after() },
    onError: (err) => toast.error(apiMessage(err, 'Could not save the variable')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/prompts/variables/${id}`),
    onSuccess: () => { toast.success('Variable removed'); after() },
    onError: (err) => toast.error(apiMessage(err, 'Could not remove the variable')),
  })

  const open = (v: PromptVariable) => { setSelected(v); setAdding(false); setDraft(draftFrom(v)) }
  const openNew = () => { setSelected(null); setAdding(true); setDraft(BLANK) }
  const editing = adding || selected !== null
  const nameOk = /^[A-Za-z0-9_]+$/.test(draft.variable_name.trim())

  return (
    <>
      {locked && (
        <div className="pm-notice">
          <Lock size={15} />
          <span>
            {version.status === 'draft'
              ? 'Your role can read variables but not change them.'
              : `Variables belong to v${version.version_number}, which is ${version.status === 'production' ? 'live' : 'archived'}. Create a new version to change them.`}
          </span>
        </div>
      )}

      <section className="pm-block">
        <div className="pm-block-head">
          <div>
            <h3>Variables</h3>
            <p>Define the dynamic inputs used in this prompt. These values will be provided at runtime from the job, user input, or system.</p>
          </div>
          {!locked && (
            <div className="pm-block-actions">
              <button className="pm-btn primary small" onClick={openNew}><Plus size={15} /> Add Variable</button>
            </div>
          )}
        </div>

        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th>
                <th>Variable Name</th><th>Type</th><th>Required</th>
                <th>Default Value</th><th>Source</th><th>Description</th>
                {!locked && <th style={{ width: 92 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {list.isLoading && <tr><td className="pm-empty" colSpan={8}>Loading…</td></tr>}
              {!list.isLoading && rows.length === 0 && (
                <tr><td className="pm-empty" colSpan={8}>
                  No variables yet. This version's instructions are used exactly as written.
                </td></tr>
              )}
              {rows.map((v, i) => (
                <tr key={v.id}
                    className={`${locked ? '' : 'clickable'} ${selected?.id === v.id ? 'selected' : ''}`}
                    onClick={() => !locked && open(v)}>
                  <td className="pm-num">{i + 1}</td>
                  <td><span className="pm-key">{v.variable_name}</span></td>
                  <td>{v.type}</td>
                  <td><span className={`pm-chip ${v.required ? 'version' : 'muted'}`}>{v.required ? 'Yes' : 'No'}</span></td>
                  <td>{v.default_value ? <span className="pm-chip muted">{v.default_value}</span> : <span className="pm-num">—</span>}</td>
                  <td>{v.source}</td>
                  <td style={{ maxWidth: 240, color: '#475569' }}>{v.description || '—'}</td>
                  {!locked && (
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button className="pm-btn icon small" title="Edit" onClick={() => open(v)}><Pencil size={13} /></button>
                        <button className="pm-btn icon small danger" title="Delete" disabled={remove.isPending}
                          onClick={() => { if (window.confirm(`Remove {{${v.variable_name}}} from this draft?`)) remove.mutate(v.id) }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && !locked && (
        <section className="pm-block">
          <div className="pm-block-head">
            <div>
              <h3>Variable Details</h3>
              <p>Edit the selected variable's configuration.</p>
            </div>
          </div>

          <div className="pm-grid3">
            <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
              <div className="pm-field">
                <label>Variable Name</label>
                <input className="pm-input" value={draft.variable_name}
                  style={{ fontFamily: 'ui-monospace, monospace' }}
                  onChange={e => setDraft({ ...draft, variable_name: e.target.value })} />
              </div>
              <div className="pm-field">
                <label>Type</label>
                <select className="pm-input" value={draft.type}
                  onChange={e => setDraft({ ...draft, type: e.target.value })}>
                  {VARIABLE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <label className="pm-check">
                <input type="checkbox" checked={draft.required}
                  onChange={e => setDraft({ ...draft, required: e.target.checked })} />
                <span>Required<br /><small style={{ color: '#94a3b8' }}>Required variable</small></span>
              </label>
            </div>

            <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
              <div className="pm-field">
                <label>Default Value</label>
                <input className="pm-input" value={draft.default_value}
                  placeholder="Enter default value (optional)"
                  onChange={e => setDraft({ ...draft, default_value: e.target.value })} />
              </div>
              <div className="pm-field">
                <label>Source</label>
                <select className="pm-input" value={draft.source}
                  onChange={e => setDraft({ ...draft, source: e.target.value })}>
                  {VARIABLE_SOURCES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="pm-field">
                <label>Description</label>
                <textarea className="pm-input" value={draft.description}
                  onChange={e => setDraft({ ...draft, description: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <label style={{ color: '#334155', fontSize: 12.5, fontWeight: 620 }}>
                Validation Rules <span style={{ color: '#94a3b8', fontWeight: 500 }}>(Optional)</span>
              </label>

              <div className="pm-grid2" style={{ gap: 10, alignItems: 'center' }}>
                <label className="pm-check">
                  <input type="checkbox" checked={draft.use_min}
                    onChange={e => setDraft({ ...draft, use_min: e.target.checked })} />
                  <span>Minimum length</span>
                </label>
                <input className="pm-input" type="number" min={0} placeholder="0" disabled={!draft.use_min}
                  value={draft.min_length} onChange={e => setDraft({ ...draft, min_length: e.target.value })} />
              </div>

              <div className="pm-grid2" style={{ gap: 10, alignItems: 'center' }}>
                <label className="pm-check">
                  <input type="checkbox" checked={draft.use_max}
                    onChange={e => setDraft({ ...draft, use_max: e.target.checked })} />
                  <span>Maximum length</span>
                </label>
                <input className="pm-input" type="number" min={0} placeholder="1000" disabled={!draft.use_max}
                  value={draft.max_length} onChange={e => setDraft({ ...draft, max_length: e.target.value })} />
              </div>

              <label className="pm-check">
                <input type="checkbox" checked={draft.use_allowed}
                  onChange={e => setDraft({ ...draft, use_allowed: e.target.checked })} />
                <span>Allowed values (comma separated)</span>
              </label>
              <input className="pm-input" placeholder="e.g. value1, value2, value3" disabled={!draft.use_allowed}
                value={draft.allowed_values} onChange={e => setDraft({ ...draft, allowed_values: e.target.value })} />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button className="pm-btn" onClick={() => { setSelected(null); setAdding(false); setDraft(BLANK) }}>
                  Cancel
                </button>
                <button className="pm-btn primary" disabled={!nameOk || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? 'Saving…' : selected ? 'Update Variable' : 'Add Variable'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}

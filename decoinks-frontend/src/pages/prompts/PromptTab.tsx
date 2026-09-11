import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Info, Lock, Maximize2, X } from 'lucide-react'
import { api } from '../../services/api'
import toast from '../../utils/toast'
import { apiMessage, type PromptVersion } from './types'

/** A structural starting point, not words for the model to say. The shop's own
 *  instructions are the shop's to write; this only lays out the shape. */
const TEMPLATES: Record<string, string> = {
  system_instruction:
    'You are a [role] working on [what].\n' +
    'Your task is to [outcome].\n' +
    'Maintain [quality bar] and ensure the output is [conditions].',
  task_instruction:
    'Do [the work] based on {{variable}}.\n' +
    'Keep [what must not change] the same. Only apply [what may change].\n' +
    'Return [the exact form of the output].',
  dynamic_context:
    'Client instruction: {{client_instruction}}\n' +
    'Setting: {{setting}}',
  restrictions:
    '- Do not [thing to avoid].\n' +
    '- Do not [thing to avoid].\n' +
    '- Do not [thing to avoid].',
}

const FIELDS = [
  { key: 'system_instruction', label: 'System Instructions', hint: "Define the AI's role, behavior and overall rules.", template: true },
  { key: 'task_instruction',   label: 'Task Instructions',   hint: 'Define the specific task for this prompt.', template: true },
  { key: 'dynamic_context',    label: 'Dynamic Context',     hint: 'Additional context or guidelines that may vary per job.', optional: true },
  { key: 'restrictions',       label: 'Restrictions',        hint: 'Define what the AI must not do.' },
] as const

type FieldKey = typeof FIELDS[number]['key']

export function PromptTab({
  version, canEdit, registerSave, onSaved,
}: {
  version: PromptVersion
  canEdit: boolean
  registerSave: (fn: (() => void) | null, busy: boolean) => void
  onSaved: () => void
}) {
  const locked = version.status !== 'draft' || !canEdit

  const [form, setForm] = useState({
    system_instruction: version.system_instruction ?? '',
    task_instruction: version.task_instruction ?? '',
    dynamic_context: version.dynamic_context ?? '',
    restrictions: version.restrictions ?? '',
  })
  const [expanded, setExpanded] = useState<FieldKey | null>(null)
  const [preview, setPreview] = useState<{ resolved_prompt: string; missing_required: string[] } | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    setForm({
      system_instruction: version.system_instruction ?? '',
      task_instruction: version.task_instruction ?? '',
      dynamic_context: version.dynamic_context ?? '',
      restrictions: version.restrictions ?? '',
    })
    setPreview(null)
  }, [version.id])

  const save = useMutation({
    mutationFn: () => api.put(`/prompts/versions/${version.id}`, {
      system_instruction: form.system_instruction || null,
      task_instruction: form.task_instruction || null,
      dynamic_context: form.dynamic_context || null,
      restrictions: form.restrictions || null,
    }),
    onSuccess: () => { toast.success(`Draft v${version.version_number} saved`); onSaved() },
    onError: (err) => toast.error(apiMessage(err, 'Could not save this version')),
  })

  // The Save Draft button lives in the tab bar, so the tab hands its saver up.
  useEffect(() => {
    registerSave(locked ? null : () => save.mutate(), save.isPending)
    return () => registerSave(null, false)
  }, [locked, form, save.isPending])

  const render = useMutation({
    mutationFn: () => api.post(`/prompts/versions/${version.id}/preview`, { values: {} })
      .then(r => r.data.data),
    onSuccess: (data) => { setPreview(data); setShowPreview(true) },
    onError: (err) => toast.error(apiMessage(err, 'Could not resolve the prompt')),
  })

  const set = (k: FieldKey, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <>
      {locked && (
        <div className="pm-notice">
          <Lock size={15} />
          <span>
            {version.status === 'production'
              ? `v${version.version_number} is live and is the record of what ran. Create a new version to make changes.`
              : version.status === 'archived'
                ? `v${version.version_number} is archived history and cannot be edited.`
                : 'Your role can read prompts but not change them.'}
          </span>
        </div>
      )}

      {FIELDS.map(f => (
        <section className="pm-block" key={f.key}>
          <div className="pm-block-head">
            <div>
              <h3>
                {f.label}
                {'optional' in f && f.optional && <small>(Optional)</small>}
                <span className="pm-hint-icon" title={f.hint}><Info size={14} /></span>
              </h3>
              <p>{f.hint}</p>
            </div>
            <div className="pm-block-actions">
              {'template' in f && f.template && !locked && (
                <button className="pm-btn small" onClick={() => set(f.key, TEMPLATES[f.key])}>
                  Use Template
                </button>
              )}
              <button className="pm-btn icon small" title="Expand" onClick={() => setExpanded(f.key)}>
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
          <textarea
            className="pm-area"
            value={form[f.key]}
            disabled={locked}
            onChange={e => set(f.key, e.target.value)}
            placeholder={f.hint}
          />
        </section>
      ))}

      <section className="pm-block">
        <div className="pm-block-head">
          <div>
            <h3>
              Preview (Resolved Prompt)
              <span className="pm-hint-icon" title="The exact text the model receives"><Info size={14} /></span>
            </h3>
            <p>Preview the final prompt with sample values.</p>
          </div>
          <div className="pm-block-actions">
            <button className="pm-btn small" disabled={render.isPending} onClick={() => render.mutate()}>
              {render.isPending ? 'Rendering…' : 'Render with Sample Data'}
            </button>
          </div>
        </div>

        <button className="pm-disclosure" onClick={() => setShowPreview(v => !v)}>
          {showPreview ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Show Preview
        </button>

        {showPreview && (
          preview
            ? (
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                {preview.missing_required.length > 0 && (
                  <div className="pm-notice">
                    <Info size={15} />
                    <span>
                      No value for <b>{preview.missing_required.join(', ')}</b>. They are left as their own
                      placeholders below, so you can see which one did not arrive rather than reading a gap.
                    </span>
                  </div>
                )}
                <pre className="pm-preview">{preview.resolved_prompt || '(this version has no instructions yet)'}</pre>
              </div>
            )
            : <p style={{ margin: '10px 0 0', color: '#94a3b8', fontSize: 13 }}>
                Render it to see the resolved prompt.
              </p>
        )}
      </section>

      {expanded && (
        <div className="pm-modal-backdrop" onClick={() => setExpanded(null)}>
          <div className="pm-modal wide" onClick={e => e.stopPropagation()}>
            <header>
              <h3>{FIELDS.find(f => f.key === expanded)!.label}</h3>
              <button className="pm-btn icon small ghost" onClick={() => setExpanded(null)}><X size={17} /></button>
            </header>
            <div className="pm-modal-body">
              <textarea
                className="pm-area"
                style={{ minHeight: '58vh' }}
                autoFocus
                value={form[expanded]}
                disabled={locked}
                onChange={e => set(expanded, e.target.value)}
              />
            </div>
            <footer>
              <button className="pm-btn primary" onClick={() => setExpanded(null)}>Done</button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}

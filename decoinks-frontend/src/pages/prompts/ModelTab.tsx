import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronRight, Info, Lock, RotateCcw } from 'lucide-react'
import { api } from '../../services/api'
import toast from '../../utils/toast'
import { apiMessage, type PromptVersion } from './types'
import {
  PROVIDERS, QUALITY_LEVELS, SAFETY_MODES, SEED_MODES,
  modelNamed, providerNamed, takes,
} from './models'

/**
 * The model this version runs on.
 *
 * A tab inside the prompt, not a page of its own: the settings are part of the
 * version and are frozen with it when it is published, so an artwork made months
 * ago still names the exact model and parameters behind it.
 */
export function ModelTab({
  version, canEdit, registerSave, onSaved,
}: {
  version: PromptVersion
  canEdit: boolean
  registerSave: (fn: (() => void) | null, busy: boolean) => void
  onSaved: () => void
}) {
  const locked = version.status !== 'draft' || !canEdit

  const readSettings = () => (version.model_settings ?? {}) as Record<string, any>

  const [provider, setProvider] = useState(version.provider ?? PROVIDERS[0].name)
  const [modelName, setModelName] = useState(version.model_name ?? PROVIDERS[0].models[0].id)
  const [temperature, setTemperature] = useState(version.temperature == null ? 0.2 : Number(version.temperature))
  const [maxTokens, setMaxTokens] = useState(version.max_tokens == null ? '' : String(version.max_tokens))
  const [s, setS] = useState<Record<string, any>>(readSettings())
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    setProvider(version.provider ?? PROVIDERS[0].name)
    setModelName(version.model_name ?? PROVIDERS[0].models[0].id)
    setTemperature(version.temperature == null ? 0.2 : Number(version.temperature))
    setMaxTokens(version.max_tokens == null ? '' : String(version.max_tokens))
    setS(readSettings())
  }, [version.id])

  const spec = modelNamed(provider, modelName)
  const get = (k: string, fallback: any) => (s[k] === undefined ? (spec.defaults[k] ?? fallback) : s[k])
  const put = (k: string, v: any) => setS(prev => ({ ...prev, [k]: v }))

  const save = useMutation({
    mutationFn: () => api.put(`/prompts/versions/${version.id}`, {
      model: {
        provider, model_name: modelName,
        temperature: Number(temperature),
        max_tokens: maxTokens === '' ? null : Number(maxTokens),
        settings: s,
      },
    }),
    onSuccess: () => { toast.success('Model settings saved'); onSaved() },
    onError: (err) => toast.error(apiMessage(err, 'Could not save the model settings')),
  })

  useEffect(() => {
    registerSave(locked ? null : () => save.mutate(), save.isPending)
    return () => registerSave(null, false)
  }, [locked, provider, modelName, temperature, maxTokens, s, save.isPending])

  const resetDefaults = () => {
    setS({ ...spec.defaults })
    setTemperature(0.2)
    setMaxTokens('')
  }

  const slider = (label: string, key: string, min: number, max: number, step: number, hint?: string) => (
    <div className="pm-field">
      <label>
        {label}
        {hint && <span className="pm-hint-icon" title={hint} style={{ marginLeft: 6 }}><Info size={13} /></span>}
      </label>
      <div className="pm-slider-row">
        <div>
          <input className="pm-slider" type="range" min={min} max={max} step={step} disabled={locked}
            value={Number(get(key, min))} onChange={e => put(key, Number(e.target.value))} />
          <div className="pm-slider-scale"><span>{min}</span><span>{max}</span></div>
        </div>
        <input className="pm-slider-value" type="number" min={min} max={max} step={step} disabled={locked}
          value={Number(get(key, min))} onChange={e => put(key, Number(e.target.value))} />
      </div>
    </div>
  )

  return (
    <div className="pm-two-col">
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {locked && (
          <div className="pm-notice">
            <Lock size={15} />
            <span>
              {version.status === 'draft'
                ? 'Your role can read the model settings but not change them.'
                : `The model is part of v${version.version_number}, which is ${version.status === 'production' ? 'live' : 'archived'}. Create a new version to change it.`}
            </span>
          </div>
        )}

        <section className="pm-block">
          <div className="pm-block-head">
            <div>
              <h3>Model Configuration</h3>
              <p>Configure the AI model and generation settings for this prompt.</p>
            </div>
          </div>

          <div className="pm-block" style={{ marginBottom: 14 }}>
            <div className="pm-block-head"><div><h3 style={{ fontSize: 13.5 }}>Model Provider &amp; Model</h3></div></div>
            <div className="pm-grid2">
              <div className="pm-field">
                <label>Model Provider</label>
                <select className="pm-input" value={provider} disabled={locked}
                  onChange={e => {
                    const p = providerNamed(e.target.value)
                    setProvider(p.name); setModelName(p.models[0].id); setS({ ...p.models[0].defaults })
                  }}>
                  {PROVIDERS.map(p => <option key={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div className="pm-field">
                <label>Model</label>
                <select className="pm-input" value={modelName} disabled={locked}
                  onChange={e => { setModelName(e.target.value); setS({ ...modelNamed(provider, e.target.value).defaults }) }}>
                  {providerNamed(provider).models.map(m => <option key={m.id}>{m.id}</option>)}
                </select>
              </div>
            </div>
          </div>

          {spec.supportsLora && (
            <div className="pm-block" style={{ marginBottom: 14 }}>
              <div className="pm-block-head">
                <div><h3 style={{ fontSize: 13.5 }}>LoRA <small>(Optional)</small>
                  <span className="pm-hint-icon" title="A fine-tune layered on the base model"><Info size={13} /></span></h3></div>
              </div>
              <div className="pm-grid2">
                <div className="pm-field">
                  <label>Use LoRA</label>
                  <button type="button" disabled={locked}
                    className={`pm-toggle ${get('use_lora', false) ? 'on' : ''}`}
                    aria-pressed={Boolean(get('use_lora', false))}
                    onClick={() => put('use_lora', !get('use_lora', false))} />
                </div>
                <div style={{ display: 'grid', gap: 14 }}>
                  <div className="pm-field">
                    <label>LoRA Model</label>
                    <select className="pm-input" disabled={locked || !get('use_lora', false)}
                      value={String(get('lora_model', spec.loraModels?.[0] ?? ''))}
                      onChange={e => put('lora_model', e.target.value)}>
                      {(spec.loraModels ?? []).map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  {get('use_lora', false) && slider('LoRA Weight', 'lora_weight', 0, 1, 0.05)}
                </div>
              </div>
            </div>
          )}

          {takes(spec, 'image_size') && (
            <div className="pm-block" style={{ marginBottom: 14 }}>
              <div className="pm-block-head"><div><h3 style={{ fontSize: 13.5 }}>Image Settings
                <span className="pm-hint-icon" title="Shape and count of the output"><Info size={13} /></span></h3></div></div>
              <div className="pm-grid3">
                <div className="pm-field">
                  <label>Image Size</label>
                  <select className="pm-input" disabled={locked} value={String(get('image_size', ''))}
                    onChange={e => put('image_size', e.target.value)}>
                    {(spec.imageSizes ?? []).map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="pm-field">
                  <label>Number of Outputs</label>
                  <select className="pm-input" disabled={locked} value={String(get('num_outputs', 1))}
                    onChange={e => put('num_outputs', Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="pm-field">
                  <label>Quality</label>
                  <select className="pm-input" disabled={locked} value={String(get('quality', 'High'))}
                    onChange={e => put('quality', e.target.value)}>
                    {QUALITY_LEVELS.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="pm-block">
            <div className="pm-block-head"><div><h3 style={{ fontSize: 13.5 }}>Generation Parameters
              <span className="pm-hint-icon" title="How the model is driven"><Info size={13} /></span></h3></div></div>
            <div className="pm-grid2">
              {takes(spec, 'guidance_scale') && slider('Guidance Scale', 'guidance_scale', 1, 20, 0.5, 'How strictly the model follows the prompt')}
              {takes(spec, 'inference_steps') && slider('Inference Steps', 'inference_steps', 10, 50, 1, 'More steps, more detail, more time')}
              {takes(spec, 'reference_strength') && slider('Reference Strength', 'reference_strength', 0, 1, 0.05, 'How closely the output follows the reference image')}

              {takes(spec, 'seed_mode') && (
                <div className="pm-field">
                  <label>Seed Mode <span className="pm-hint-icon" title="Fixed repeats the same result"><Info size={13} /></span></label>
                  <select className="pm-input" disabled={locked} value={String(get('seed_mode', 'Random'))}
                    onChange={e => put('seed_mode', e.target.value)}>
                    {SEED_MODES.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              )}

              <div className="pm-field">
                <label>Temperature <span className="pm-hint-icon" title="0 is repeatable, higher is looser"><Info size={13} /></span></label>
                <div className="pm-slider-row">
                  <div>
                    <input className="pm-slider" type="range" min={0} max={1} step={0.05} disabled={locked}
                      value={temperature} onChange={e => setTemperature(Number(e.target.value))} />
                    <div className="pm-slider-scale"><span>0</span><span>1</span></div>
                  </div>
                  <input className="pm-slider-value" type="number" min={0} max={2} step={0.05} disabled={locked}
                    value={temperature} onChange={e => setTemperature(Number(e.target.value))} />
                </div>
              </div>

              {takes(spec, 'safety_mode') && (
                <div className="pm-field">
                  <label>Safety Mode <span className="pm-hint-icon" title="How strictly content is filtered"><Info size={13} /></span></label>
                  <select className="pm-input" disabled={locked} value={String(get('safety_mode', 'Standard'))}
                    onChange={e => put('safety_mode', e.target.value)}>
                    {SAFETY_MODES.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="pm-block" style={{ marginTop: 14 }}>
            <button className="pm-disclosure" onClick={() => setShowAdvanced(v => !v)}>
              {showAdvanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Advanced Settings <span style={{ color: '#94a3b8', fontWeight: 500 }}>(Optional)</span>
            </button>
            <p style={{ margin: '2px 0 0 23px', color: '#64748b', fontSize: 12.5 }}>
              Timeout, fallback model, negative prompt, max tokens.
            </p>
            {showAdvanced && (
              <div className="pm-grid2" style={{ marginTop: 14 }}>
                <div className="pm-field">
                  <label>Max Tokens</label>
                  <input className="pm-input" type="number" min={1} disabled={locked} placeholder="Provider default"
                    value={maxTokens} onChange={e => setMaxTokens(e.target.value)} />
                </div>
                <div className="pm-field">
                  <label>Timeout (seconds)</label>
                  <input className="pm-input" type="number" min={1} disabled={locked} placeholder="Provider default"
                    value={String(get('timeout_seconds', '') ?? '')}
                    onChange={e => put('timeout_seconds', e.target.value === '' ? null : Number(e.target.value))} />
                </div>
                <div className="pm-field">
                  <label>Fallback Model</label>
                  <select className="pm-input" disabled={locked} value={String(get('fallback_model', '') ?? '')}
                    onChange={e => put('fallback_model', e.target.value || null)}>
                    <option value="">None</option>
                    {PROVIDERS.flatMap(p => p.models.map(m => (
                      <option key={`${p.name}/${m.id}`} value={`${p.name}/${m.id}`}>{p.name} · {m.id}</option>
                    )))}
                  </select>
                </div>
                <div className="pm-field">
                  <label>Negative Prompt</label>
                  <textarea className="pm-input" disabled={locked}
                    placeholder="What the model should keep out of the output"
                    value={String(get('negative_prompt', '') ?? '')}
                    onChange={e => put('negative_prompt', e.target.value || null)} />
                </div>
              </div>
            )}
          </div>

          {!locked && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="pm-btn" onClick={resetDefaults}><RotateCcw size={15} /> Reset to Default</button>
              <button className="pm-btn primary" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save Model Settings'}
              </button>
            </div>
          )}
        </section>
      </div>

      <aside className="pm-rail">
        <section className="pm-block">
          <div className="pm-block-head"><div><h3>Model Information</h3></div></div>
          <div className="pm-info-row"><span>Provider</span><b>{provider}</b></div>
          <div className="pm-info-row"><span>Model</span><b>{spec.id}</b></div>
          <div className="pm-info-row"><span>Type</span><b>{spec.type}</b></div>
          {spec.maxResolution && <div className="pm-info-row"><span>Max Resolution</span><b>{spec.maxResolution}</b></div>}
          <div className="pm-info-row"><span>Supports LoRA</span><b>{spec.supportsLora ? 'Yes' : 'No'}</b></div>
          <div className="pm-info-row" style={{ alignItems: 'flex-start' }}>
            <span style={{ flex: '0 0 62px' }}>Best For</span><b style={{ fontWeight: 500 }}>{spec.bestFor}</b>
          </div>
        </section>

        <section className="pm-block reco">
          <div className="pm-block-head"><div><h3>Recommended Settings</h3></div></div>
          <ul className="pm-reco">
            {spec.recommended.map(r => (
              <li key={r}><CheckCircle2 size={15} /><span>{r}</span></li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  )
}

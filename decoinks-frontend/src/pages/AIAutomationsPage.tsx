import { useState } from 'react'
import {
  Bot,
  CheckCircle2,
  Clock3,
  FileText,
  MessageSquareText,
  Play,
  Plus,
  Sparkles,
  Wand2,
  Zap,
} from 'lucide-react'
import toast from '../utils/toast'
import { cn } from '../utils/cn'

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn('sg-toggle', checked && 'sg-toggle-on')}
      onClick={() => onChange(!checked)}
    >
      <span className="sg-toggle-thumb" />
    </button>
  )
}

const automations = [
  {
    name: 'Chat to Quotation Draft',
    trigger: 'New Chatwoot conversation tagged quote-request',
    action: 'Extract product type, size, qty, urgency and draft quote',
    owner: 'Sales',
    runs: '128 runs',
    enabled: true,
  },
  {
    name: 'Artwork Requirement Extraction',
    trigger: 'Quote or order created from chat',
    action: 'Identify front/back locations, artwork count and missing files',
    owner: 'Design',
    runs: '84 runs',
    enabled: true,
  },
  {
    name: 'Shipping Review Follow-up',
    trigger: 'Shipment delivered',
    action: 'Send review request and flag negative/no response outcomes',
    owner: 'Operations',
    runs: '211 runs',
    enabled: true,
  },
  {
    name: 'PO Supplier Summary',
    trigger: 'Purchase order is saved',
    action: 'Create vendor-ready summary with files, quantities and due dates',
    owner: 'Fulfillment',
    runs: '37 runs',
    enabled: false,
  },
]

const extractionFields = [
  'Product type',
  'Quantity',
  'Print method',
  'Garment size/color',
  'Artwork locations',
  'Urgency',
  'Customer budget',
  'Missing assets',
]

export function AIAutomationsPage() {
  const [rules, setRules] = useState(automations)
  const [autoApply, setAutoApply] = useState(false)
  const [humanReview, setHumanReview] = useState(true)
  const [confidenceThreshold, setConfidenceThreshold] = useState(82)
  const [tone, setTone] = useState('Professional and concise')

  const toggleRule = (index: number) => {
    setRules((value) =>
      value.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, enabled: !rule.enabled } : rule,
      ),
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <span className="settings-eyebrow">
            <Sparkles size={14} /> AI Control Center
          </span>
          <h2>AI Automations</h2>
          <p>
            Configure AI-assisted extraction, drafting, follow-ups and team handoffs before
            connecting backend services.
          </p>
        </div>
        <button className="lb-action-btn lb-action-primary" onClick={() => toast.success('New automation draft created')}>
          <Plus size={14} /> New Automation
        </button>
      </div>

      <div className="settings-metrics">
        <div className="settings-metric">
          <span className="settings-metric-icon settings-metric-purple"><Bot size={18} /></span>
          <div><strong>12</strong><span>Active AI rules</span></div>
        </div>
        <div className="settings-metric">
          <span className="settings-metric-icon settings-metric-green"><CheckCircle2 size={18} /></span>
          <div><strong>91%</strong><span>Extraction accuracy</span></div>
        </div>
        <div className="settings-metric">
          <span className="settings-metric-icon settings-metric-blue"><Clock3 size={18} /></span>
          <div><strong>4.8h</strong><span>Saved this week</span></div>
        </div>
        <div className="settings-metric">
          <span className="settings-metric-icon settings-metric-amber"><Zap size={18} /></span>
          <div><strong>460</strong><span>Monthly runs</span></div>
        </div>
      </div>

      <div className="settings-grid settings-grid-wide">
        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h3>Automation Rules</h3>
              <p>Business-safe rules that map common printshop events to AI actions.</p>
            </div>
            <button className="lb-action-btn" onClick={() => toast.success('AI automation test run completed')}><Play size={14} /> Test Run</button>
          </div>
          <div className="settings-rule-list">
            {rules.map((rule, index) => (
              <div key={rule.name} className="settings-rule">
                <div className="settings-rule-main">
                  <div className="settings-rule-title">
                    <Wand2 size={16} />
                    <strong>{rule.name}</strong>
                    <span className={cn('settings-chip', rule.enabled ? 'settings-chip-green' : 'settings-chip-slate')}>
                      {rule.enabled ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <p><b>Trigger:</b> {rule.trigger}</p>
                  <p><b>Action:</b> {rule.action}</p>
                  <div className="settings-rule-meta">
                    <span>{rule.owner}</span>
                    <span>{rule.runs}</span>
                  </div>
                </div>
                <Toggle checked={rule.enabled} onChange={() => toggleRule(index)} />
              </div>
            ))}
          </div>
        </section>

        <aside className="settings-stack">
          <section className="settings-card">
            <div className="settings-card-head">
              <div>
                <h3>AI Guardrails</h3>
                <p>Keep automation useful without letting it bypass human judgement.</p>
              </div>
            </div>
            <div className="settings-form">
              <label>
                Confidence threshold
                <input
                  type="range"
                  min="50"
                  max="98"
                  value={confidenceThreshold}
                  onChange={(event) => setConfidenceThreshold(Number(event.target.value))}
                />
                <span className="settings-range-value">{confidenceThreshold}% minimum confidence</span>
              </label>
              <label>
                Customer message tone
                <select value={tone} onChange={(event) => setTone(event.target.value)}>
                  <option>Professional and concise</option>
                  <option>Friendly and detailed</option>
                  <option>Direct and urgent</option>
                </select>
              </label>
              <div className="settings-toggle-row">
                <div><strong>Require human review</strong><span>Drafts need approval before sending.</span></div>
                <Toggle checked={humanReview} onChange={setHumanReview} />
              </div>
              <div className="settings-toggle-row">
                <div><strong>Auto-apply high confidence data</strong><span>Fill fields when confidence is above threshold.</span></div>
                <Toggle checked={autoApply} onChange={setAutoApply} />
              </div>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <div>
                <h3>Extraction Fields</h3>
                <p>Fields AI should identify from chat, email and uploaded files.</p>
              </div>
            </div>
            <div className="settings-field-cloud">
              {extractionFields.map((field) => (
                <span key={field}>{field}</span>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="settings-card">
        <div className="settings-card-head">
          <div>
            <h3>Recent AI Activity</h3>
            <p>Audit trail for drafts, extracted fields and workflow decisions.</p>
          </div>
        </div>
        <div className="settings-timeline">
          {[
            ['Quote draft created', 'QT-2026-0008 generated from Chatwoot conversation', '2 min ago', MessageSquareText],
            ['Artwork fields extracted', 'Detected front/back placement and 8 assets for ORD-2026-0018', '18 min ago', FileText],
            ['Review follow-up queued', 'Shipment ORD-2026-0014 marked delivered and review message prepared', '1 hr ago', CheckCircle2],
          ].map(([title, body, time, Icon]) => (
            <div key={title as string} className="settings-timeline-item">
              <span><Icon size={15} /></span>
              <div><strong>{title as string}</strong><p>{body as string}</p></div>
              <small>{time as string}</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

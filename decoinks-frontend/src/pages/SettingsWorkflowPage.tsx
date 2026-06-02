import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, GitBranch, Plus, ShieldCheck, Workflow } from 'lucide-react'
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

const stages = [
  ['Lead Intake', 'Capture inquiry, source and customer intent', true],
  ['Quotation', 'Price apparel, gangsheet or transfer requests', true],
  ['Artwork Review', 'Proof, revision and approval lifecycle', true],
  ['Order Production', 'Convert approved quote to production order', true],
  ['Purchase Order', 'Create supplier/fulfillment partner request', true],
  ['Shipment & Review', 'Track delivery, customer review and claims', true],
] as const

const approvalRules = [
  ['Quote discount above 15%', 'Require manager approval before sending quote'],
  ['Rush production under 24h', 'Require fulfillment confirmation'],
  ['Artwork changes requested twice', 'Escalate to lead designer'],
  ['Shipment delayed', 'Notify sales owner and create follow-up task'],
]

export function SettingsWorkflowPage() {
  const [autoConvert, setAutoConvert] = useState(false)
  const [requireArtworkApproval, setRequireArtworkApproval] = useState(true)
  const [autoPo, setAutoPo] = useState(true)
  const [reviewRequest, setReviewRequest] = useState(true)
  const [sla, setSla] = useState('24 hours')
  const [rushCutoff, setRushCutoff] = useState('2:00 PM')

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <span className="settings-eyebrow"><Workflow size={14} /> Operations</span>
          <h2>Workflow Settings</h2>
          <p>Define how work moves from lead to quote, artwork, production, fulfillment and delivery.</p>
        </div>
        <button className="lb-action-btn lb-action-primary" onClick={() => toast.success('New workflow rule draft added')}>
          <Plus size={14} /> Add Rule
        </button>
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h3>Pipeline Stages</h3>
              <p>Core business workflow reflected across boards and document screens.</p>
            </div>
          </div>
          <div className="settings-stage-list">
            {stages.map(([title, body, enabled], index) => (
              <div key={title} className="settings-stage">
                <span className="settings-stage-index">{index + 1}</span>
                <div><strong>{title}</strong><p>{body}</p></div>
                <span className={cn('settings-chip', enabled ? 'settings-chip-green' : 'settings-chip-slate')}>
                  {enabled ? 'Enabled' : 'Off'}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h3>Automation Gates</h3>
              <p>Practical controls to prevent incorrect customer-facing actions.</p>
            </div>
          </div>
          <div className="settings-form">
            <div className="settings-toggle-row">
              <div><strong>Auto-convert accepted quotes</strong><span>Create an order after customer acceptance.</span></div>
              <Toggle checked={autoConvert} onChange={setAutoConvert} />
            </div>
            <div className="settings-toggle-row">
              <div><strong>Require artwork approval</strong><span>Block production until all artwork is approved.</span></div>
              <Toggle checked={requireArtworkApproval} onChange={setRequireArtworkApproval} />
            </div>
            <div className="settings-toggle-row">
              <div><strong>Generate PO for outsourced work</strong><span>Create purchase order when vendor fulfillment is selected.</span></div>
              <Toggle checked={autoPo} onChange={setAutoPo} />
            </div>
            <div className="settings-toggle-row">
              <div><strong>Send review request after delivery</strong><span>Prepare review request after shipment is delivered.</span></div>
              <Toggle checked={reviewRequest} onChange={setReviewRequest} />
            </div>
          </div>
        </section>
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h3>SLA & Scheduling</h3>
              <p>Defaults used by design board, fulfillment board and shipment planning.</p>
            </div>
          </div>
          <div className="settings-form settings-form-two">
            <label>
              Default artwork SLA
              <select value={sla} onChange={(event) => setSla(event.target.value)}>
                <option>12 hours</option>
                <option>24 hours</option>
                <option>48 hours</option>
                <option>3 business days</option>
              </select>
            </label>
            <label>
              Rush order cutoff
              <select value={rushCutoff} onChange={(event) => setRushCutoff(event.target.value)}>
                <option>11:00 AM</option>
                <option>12:00 PM</option>
                <option>2:00 PM</option>
                <option>4:00 PM</option>
              </select>
            </label>
            <label>
              Default production buffer
              <select defaultValue="1 business day">
                <option>Same day</option>
                <option>1 business day</option>
                <option>2 business days</option>
              </select>
            </label>
            <label>
              Claim response target
              <select defaultValue="24 hours">
                <option>4 hours</option>
                <option>24 hours</option>
                <option>48 hours</option>
              </select>
            </label>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h3>Approval Rules</h3>
              <p>Rules that protect margin, quality and customer trust.</p>
            </div>
          </div>
          <div className="settings-rule-list">
            {approvalRules.map(([title, body], index) => {
              const icons = [ShieldCheck, Clock, GitBranch, AlertTriangle]
              const Icon = icons[index]
              return (
                <div key={title} className="settings-rule settings-rule-compact">
                  <span className="settings-rule-icon"><Icon size={16} /></span>
                  <div>
                    <strong>{title}</strong>
                    <p>{body}</p>
                  </div>
                  <CheckCircle2 className="settings-ok" size={17} />
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

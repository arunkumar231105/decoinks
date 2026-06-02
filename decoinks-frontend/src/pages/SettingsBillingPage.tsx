import { useState } from 'react'
import { CreditCard, DollarSign, FileText, Landmark, Percent, ShieldCheck } from 'lucide-react'
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

export function SettingsBillingPage() {
  const [taxEnabled, setTaxEnabled] = useState(true)
  const [autoInvoice, setAutoInvoice] = useState(false)
  const [paymentLink, setPaymentLink] = useState(true)
  const [terms, setTerms] = useState('Net 15')

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <span className="settings-eyebrow"><CreditCard size={14} /> Finance</span>
          <h2>Billing, Tax & Payments</h2>
          <p>Set invoice defaults, taxes, payment methods and margin controls for sales operations.</p>
        </div>
      </div>

      <div className="settings-metrics">
        <div className="settings-metric">
          <span className="settings-metric-icon settings-metric-green"><DollarSign size={18} /></span>
          <div><strong>$48.2k</strong><span>Open invoices</span></div>
        </div>
        <div className="settings-metric">
          <span className="settings-metric-icon settings-metric-blue"><Landmark size={18} /></span>
          <div><strong>3</strong><span>Payment methods</span></div>
        </div>
        <div className="settings-metric">
          <span className="settings-metric-icon settings-metric-amber"><Percent size={18} /></span>
          <div><strong>7%</strong><span>Default sales tax</span></div>
        </div>
        <div className="settings-metric">
          <span className="settings-metric-icon settings-metric-purple"><ShieldCheck size={18} /></span>
          <div><strong>15%</strong><span>Approval discount limit</span></div>
        </div>
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h3>Invoice Defaults</h3>
              <p>Applied when creating invoices from quote or order flows.</p>
            </div>
          </div>
          <div className="settings-form settings-form-two">
            <label>
              Payment terms
              <select value={terms} onChange={(event) => setTerms(event.target.value)}>
                <option>Due on Receipt</option>
                <option>Net 7</option>
                <option>Net 15</option>
                <option>Net 30</option>
              </select>
            </label>
            <label>
              Default currency
              <select defaultValue="USD - US Dollar">
                <option>USD - US Dollar</option>
                <option>CAD - Canadian Dollar</option>
                <option>GBP - British Pound</option>
              </select>
            </label>
            <label>
              Invoice prefix
              <input defaultValue="INV-2026-" />
            </label>
            <label>
              Quote prefix
              <input defaultValue="QT-2026-" />
            </label>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h3>Tax & Payment Controls</h3>
              <p>Finance rules that protect margin and keep customer billing consistent.</p>
            </div>
          </div>
          <div className="settings-form">
            <div className="settings-toggle-row">
              <div><strong>Apply sales tax by default</strong><span>Use default tax on taxable products and services.</span></div>
              <Toggle checked={taxEnabled} onChange={setTaxEnabled} />
            </div>
            <div className="settings-toggle-row">
              <div><strong>Auto-create invoice from approved order</strong><span>Prepare invoice when production order is approved.</span></div>
              <Toggle checked={autoInvoice} onChange={setAutoInvoice} />
            </div>
            <div className="settings-toggle-row">
              <div><strong>Send payment link with invoice</strong><span>Add hosted payment link to invoice email.</span></div>
              <Toggle checked={paymentLink} onChange={setPaymentLink} />
            </div>
          </div>
        </section>
      </div>

      <section className="settings-card">
        <div className="settings-card-head">
          <div>
            <h3>Payment Methods</h3>
            <p>Methods visible on invoice and quotation payment panels.</p>
          </div>
        </div>
        <div className="settings-payment-grid">
          {[
            ['Cashapp', 'Enabled', '$decoinks'],
            ['Zelle', 'Enabled', 'payments@decoinks.com'],
            ['PayPal', 'Enabled', 'paypal.me/decoinks'],
            ['Bank Transfer', 'Enabled', 'Chase **** 4821'],
          ].map(([method, status, account]) => (
            <div key={method} className="settings-payment-card">
              <FileText size={16} />
              <div><strong>{method}</strong><span>{account}</span></div>
              <span className="settings-chip settings-chip-green">{status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

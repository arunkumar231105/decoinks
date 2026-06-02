import { useState } from 'react'
import { CheckCircle2, Mail, MessageCircle, PackageCheck, PlugZap, Plus, Truck, XCircle } from 'lucide-react'
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

const integrations = [
  { name: 'Chatwoot', type: 'Customer chat', status: 'Connected', icon: MessageCircle, detail: 'Leads and quote requests' },
  { name: 'Gmail / Workspace', type: 'Email', status: 'Connected', icon: Mail, detail: 'Customer communication' },
  { name: 'UPS Shipping', type: 'Carrier', status: 'Not Connected', icon: Truck, detail: 'Labels, rates and tracking' },
  { name: 'PrintFactory USA', type: 'Vendor API', status: 'Connected', icon: PackageCheck, detail: 'Purchase orders and artwork files' },
]

export function SettingsIntegrationsPage() {
  const [syncCustomers, setSyncCustomers] = useState(true)
  const [syncFiles, setSyncFiles] = useState(true)
  const [webhooks, setWebhooks] = useState(false)

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <span className="settings-eyebrow"><PlugZap size={14} /> Connectors</span>
          <h2>Integrations</h2>
          <p>Connect customer channels, vendor partners, shipping carriers and file storage.</p>
        </div>
        <button className="lb-action-btn lb-action-primary" onClick={() => toast.success('Integration setup started')}>
          <Plus size={14} /> Add Integration
        </button>
      </div>

      <div className="settings-integration-grid">
        {integrations.map((integration) => {
          const Icon = integration.icon
          const connected = integration.status === 'Connected'
          return (
            <section key={integration.name} className="settings-card settings-integration-card">
              <div className="settings-integration-top">
                <span className="settings-integration-icon"><Icon size={19} /></span>
                <span className={cn('settings-chip', connected ? 'settings-chip-green' : 'settings-chip-red')}>
                  {connected ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {integration.status}
                </span>
              </div>
              <h3>{integration.name}</h3>
              <p>{integration.type}</p>
              <small>{integration.detail}</small>
              <button className="lb-action-btn" onClick={() => toast.success(`${integration.name} ${connected ? 'settings opened' : 'connection started'}`)}>{connected ? 'Manage' : 'Connect'}</button>
            </section>
          )
        })}
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h3>Sync Defaults</h3>
              <p>Control which data can move between Decoinks and connected systems.</p>
            </div>
          </div>
          <div className="settings-form">
            <div className="settings-toggle-row">
              <div><strong>Sync customers and contacts</strong><span>Keep customer profile data updated across channels.</span></div>
              <Toggle checked={syncCustomers} onChange={setSyncCustomers} />
            </div>
            <div className="settings-toggle-row">
              <div><strong>Sync artwork and production files</strong><span>Attach final files to orders and vendor purchase orders.</span></div>
              <Toggle checked={syncFiles} onChange={setSyncFiles} />
            </div>
            <div className="settings-toggle-row">
              <div><strong>Enable outbound webhooks</strong><span>Notify external tools when orders, invoices or shipments change.</span></div>
              <Toggle checked={webhooks} onChange={setWebhooks} />
            </div>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <div>
              <h3>Webhook Events</h3>
              <p>Events backend should expose during integration phase.</p>
            </div>
          </div>
          <div className="settings-field-cloud">
            {[
              'lead.created',
              'quote.sent',
              'quote.accepted',
              'order.created',
              'artwork.approved',
              'po.sent',
              'invoice.paid',
              'shipment.delivered',
            ].map((event) => <span key={event}>{event}</span>)}
          </div>
        </section>
      </div>
    </div>
  )
}

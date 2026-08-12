import { useState, type ReactNode } from 'react'
import {
  Mail, MessageSquare, MessageCircle, Send, X, RotateCcw, Save, PackageCheck,
  Truck, XCircle, PauseCircle, CalendarDays, Loader2,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'

/* ── Model ─────────────────────────────────────────────────────────────── */

type ChannelKey = 'email' | 'sms' | 'whatsapp' | 'wechat'

const CHANNELS: { key: ChannelKey; label: string; icon: typeof Mail; tint: string; addLabel: string; placeholder: string; unit: string }[] = [
  { key: 'email', label: 'Email', icon: Mail, tint: 'text-brand', addLabel: 'Add Email', placeholder: 'name@company.com', unit: 'Email ID(s)' },
  { key: 'sms', label: 'SMS', icon: MessageSquare, tint: 'text-orange-500', addLabel: 'Add Number', placeholder: '+1 555 000 0000', unit: 'Phone Number(s)' },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, tint: 'text-emerald-600', addLabel: 'Add Number', placeholder: '+1 555 000 0000', unit: 'Number(s)' },
  { key: 'wechat', label: 'WeChat', icon: Send, tint: 'text-green-600', addLabel: 'Add WeChat ID', placeholder: 'wechat-id', unit: 'WeChat ID(s)' },
]

const EVENTS = [
  { key: 'order_received', label: 'Order Received', icon: PackageCheck, tone: 'bg-sky-50 text-sky-600' },
  { key: 'order_shipped', label: 'Order Shipped', icon: Truck, tone: 'bg-emerald-50 text-emerald-600' },
  { key: 'order_cancelled', label: 'Order Cancelled', icon: XCircle, tone: 'bg-rose-50 text-rose-600' },
  { key: 'order_on_hold', label: 'Order on Hold', icon: PauseCircle, tone: 'bg-violet-50 text-violet-600' },
  { key: 'daily_summary', label: 'Daily Summary', icon: CalendarDays, tone: 'bg-sky-50 text-sky-600' },
  { key: 'weekly_summary', label: 'Weekly Summary', icon: CalendarDays, tone: 'bg-amber-50 text-amber-600' },
  { key: 'monthly_summary', label: 'Monthly Summary', icon: CalendarDays, tone: 'bg-orange-50 text-orange-600' },
] as const

type Cell = { enabled: boolean; recipients: string[] }
type Settings = Record<string, Record<ChannelKey, Cell>>

const emptyCell = (): Cell => ({ enabled: false, recipients: [] })
const blankSettings = (): Settings =>
  Object.fromEntries(EVENTS.map(e => [
    e.key,
    Object.fromEntries(CHANNELS.map(c => [c.key, emptyCell()])) as Record<ChannelKey, Cell>,
  ])) as Settings

/* ── Recipient chips ───────────────────────────────────────────────────── */

function Recipients({
  cell, channel, onChange,
}: {
  cell: Cell
  channel: (typeof CHANNELS)[number]
  onChange: (next: Cell) => void
}) {
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')

  const add = () => {
    const v = value.trim()
    if (!v || cell.recipients.includes(v)) { setAdding(false); setValue(''); return }
    onChange({ ...cell, recipients: [...cell.recipients, v] })
    setValue('')
    setAdding(false)
  }

  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
          checked={cell.enabled} onChange={e => onChange({ ...cell, enabled: e.target.checked })} />
        <span className="text-[13px] font-medium text-ink">Enable {channel.label}</span>
      </label>

      <div className="rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-muted">
        {cell.recipients.length} {channel.unit}
      </div>

      {cell.recipients.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cell.recipients.map(r => (
            <span key={r} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs text-ink">
              <span className="truncate">{r}</span>
              <button type="button" aria-label={`Remove ${r}`} className="shrink-0 text-slate-400 hover:text-rose-600"
                onClick={() => onChange({ ...cell, recipients: cell.recipients.filter(x => x !== r) })}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {adding ? (
        <input
          autoFocus
          className="fp-input h-9 text-[13px]"
          placeholder={channel.placeholder}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={add}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } if (e.key === 'Escape') { setAdding(false); setValue('') } }}
        />
      ) : (
        <button type="button" className="text-[13px] font-medium text-brand hover:underline" onClick={() => setAdding(true)}>
          + {channel.addLabel}
        </button>
      )}
    </div>
  )
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<Settings>(blankSettings)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<ReactNode>(null)

  const update = (event: string, channel: ChannelKey, next: Cell) =>
    setSettings(s => ({ ...s, [event]: { ...s[event], [channel]: next } }))

  const toggleColumn = (channel: ChannelKey) => {
    const allOn = EVENTS.every(e => settings[e.key][channel].enabled)
    setSettings(s => Object.fromEntries(Object.entries(s).map(([k, row]) => [
      k, { ...row, [channel]: { ...row[channel], enabled: !allOn } },
    ])) as Settings)
  }

  const save = async () => {
    setSaving(true)
    setNotice(null)
    // The settings endpoint is not built yet; keep the screen honest about it
    // instead of pretending the preferences were stored.
    await new Promise(r => setTimeout(r, 400))
    setSaving(false)
    setNotice(
      <span>Notification preferences aren’t saved yet — the settings endpoint still has to be built. Your changes stay on screen only.</span>,
    )
  }

  return (
    <>
      <PageHeader
        title="Notification Settings"
        subtitle="Manage how you want to receive notifications for different events."
        actions={
          <>
            <button className="fp-btn" onClick={() => { setSettings(blankSettings()); setNotice(null) }}>
              <RotateCcw size={16} /> Reset to Defaults
            </button>
            <button className="fp-btn fp-btn-primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Changes
            </button>
          </>
        }
      />

      {notice && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20">
          {notice}
        </div>
      )}

      <div className="fp-card overflow-hidden">
        <div className="fp-table-wrap">
          <table className="w-full min-w-[1080px] border-collapse">
            <thead>
              <tr>
                <th className="fp-th w-[220px]">Notification Event</th>
                {CHANNELS.map(c => {
                  const Icon = c.icon
                  return (
                    <th key={c.key} className="fp-th">
                      <button type="button" onClick={() => toggleColumn(c.key)}
                        title={`Toggle ${c.label} for every event`}
                        className="flex items-center gap-2 text-[13px] font-semibold text-ink hover:text-brand">
                        <Icon size={18} className={c.tint} /> {c.label}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {EVENTS.map(ev => {
                const Icon = ev.icon
                return (
                  <tr key={ev.key} className="align-top">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${ev.tone}`}><Icon size={19} /></span>
                        <span className="text-[14px] font-semibold text-ink">{ev.label}</span>
                      </div>
                    </td>
                    {CHANNELS.map(c => (
                      <td key={c.key} className="border-l border-line px-4 py-4">
                        <Recipients
                          cell={settings[ev.key][c.key]}
                          channel={c}
                          onChange={next => update(ev.key, c.key, next)}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

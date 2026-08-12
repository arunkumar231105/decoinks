import {
  UserRound, Building2, Share2, MessageSquareText, Mail, MessageCircle, Phone,
  Pencil, MapPin, Truck, CalendarDays, ClipboardList, Image as ImageIcon, Repeat, Wallet,
  CircleDollarSign, AlertCircle, RotateCcw,
} from 'lucide-react'
import { Layout } from '../components/Layout'
import { Badge } from '../components/ui'
import { useResource } from '../hooks/useResource'
import { endpoints, money, num, dash } from '../services/api'
import type { Address, Profile } from '../types'

const CHANNELS = [
  { key: 'email', icon: Mail, label: 'Email', hint: 'Order confirmations and important notifications.' },
  { key: 'sms', icon: MessageSquareText, label: 'SMS / Text Message', hint: 'Quick updates and alerts on your mobile.' },
  { key: 'whatsapp', icon: MessageCircle, label: 'WhatsApp', hint: 'Updates and support messages on WhatsApp.' },
  { key: 'phone', icon: Phone, label: 'Phone Call', hint: 'Important updates and support by phone.' },
] as const

const initialsOf = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '—'

const addressLines = (a: Address | null) =>
  !a ? [] : [a.line1, a.line2, [a.city, a.state, a.zip].filter(Boolean).join(', '), a.country].filter(Boolean) as string[]

export default function ProfilePage() {
  const { data: p, loading, error, reload } = useResource<Profile>(endpoints.profile)

  return (
    <Layout title="Profile" subtitle="View and manage your account information." searchPlaceholder="Search by order no, artwork name…">
      {loading && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="cp-card h-64 p-5"><div className="cp-skeleton h-full w-full" /></div>
          <div className="cp-card h-64 p-5"><div className="cp-skeleton h-full w-full" /></div>
        </div>
      )}

      {!loading && error && (
        <div className="cp-card flex flex-col items-center px-6 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-rose-600"><AlertCircle size={22} /></span>
          <p className="mt-3 text-base font-semibold text-ink">Couldn't load your profile</p>
          <p className="mt-1 max-w-sm text-sm text-muted">{error}</p>
          <button className="cp-btn mt-5" onClick={reload}><RotateCcw size={15} /> Try again</button>
        </div>
      )}

      {!loading && !error && p && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          {/* Left column */}
          <div className="space-y-4">
            <section className="cp-card p-5">
              <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
                <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand text-xl font-bold text-white">
                  {initialsOf(p.name)}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <h2 className="truncate text-lg font-bold text-ink">{p.name}</h2>
                    {p.status && <Badge tone="bg-emerald-50 text-emerald-700 ring-emerald-600/20">{p.status}</Badge>}
                  </div>
                  <p className="mt-1 truncate text-[13px] text-muted">{dash(p.email)}</p>
                  <p className="truncate text-[13px] text-muted">{dash(p.phone)}</p>
                  {p.customerSince && (
                    <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted sm:justify-start">
                      <CalendarDays size={13} /> Customer since {p.customerSince}
                    </p>
                  )}
                </div>
              </div>
              <button className="cp-btn mt-4 w-full border-brand/40 text-brand hover:bg-brand/5"><Pencil size={15} /> Edit Profile</button>
            </section>

            <section className="cp-card p-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">Account Overview</h3>
              <div className="divide-y divide-line">
                {[
                  { icon: ClipboardList, label: 'Total Orders', value: num(p.account.totalOrders) },
                  { icon: ImageIcon, label: 'Total Artworks', value: num(p.account.totalArtworks) },
                  { icon: Repeat, label: 'Total Transfers Qty', value: num(p.account.totalTransfersQty) },
                  { icon: Wallet, label: 'Total Spent', value: money(p.account.totalSpent) },
                  { icon: CircleDollarSign, label: 'Outstanding', value: money(p.account.outstanding) },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex items-center gap-2 text-[13px] text-muted"><Icon size={15} className="text-slate-400" /> {label}</span>
                    <span className="text-[13px] font-semibold text-ink">{value}</span>
                  </div>
                ))}
              </div>
            </section>

            {[
              { title: 'Billing Address', icon: MapPin, lines: addressLines(p.billingAddress) },
              { title: 'Shipping Address', icon: Truck, lines: addressLines(p.shippingAddress) },
            ].map(({ title, icon: Icon, lines }) => (
              <section key={title} className="cp-card p-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon size={16} className="text-slate-400" /> {title}</h3>
                  <button className="text-[13px] font-medium text-brand hover:underline">Edit</button>
                </div>
                {lines.length === 0
                  ? <p className="text-[13px] text-muted">No address on file.</p>
                  : <address className="space-y-0.5 text-[13px] not-italic leading-relaxed text-muted">{lines.map(l => <div key={l}>{l}</div>)}</address>}
              </section>
            ))}
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <section className="cp-card p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink"><UserRound size={16} className="text-brand" /> Personal Information</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label><span className="cp-label">Full Name</span><input className="cp-input" defaultValue={p.name} /></label>
                <label><span className="cp-label">Email Address</span><input className="cp-input" type="email" defaultValue={p.email ?? ''} /></label>
                <label><span className="cp-label">Phone Number</span><input className="cp-input" type="tel" defaultValue={p.phone ?? ''} /></label>
                <label><span className="cp-label">Job Title</span><input className="cp-input" defaultValue={p.jobTitle ?? ''} /></label>
                <label><span className="cp-label">Country</span><input className="cp-input" defaultValue={p.country ?? ''} /></label>
                <label><span className="cp-label">Time Zone</span><input className="cp-input" defaultValue={p.timeZone ?? ''} /></label>
              </div>
            </section>

            <section className="cp-card p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink"><Building2 size={16} className="text-brand" /> Company Information</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label><span className="cp-label">Company Name</span><input className="cp-input" defaultValue={p.company.name ?? ''} /></label>
                <label><span className="cp-label">Company Contact Email</span><input className="cp-input" type="email" defaultValue={p.company.contactEmail ?? ''} /></label>
                <label><span className="cp-label">Business Type</span><input className="cp-input" defaultValue={p.company.businessType ?? ''} /></label>
                <label><span className="cp-label">Tax ID / EIN</span><input className="cp-input" defaultValue={p.company.taxId ?? ''} /></label>
                <label><span className="cp-label">Website</span><input className="cp-input" defaultValue={p.company.website ?? ''} /></label>
                <label><span className="cp-label">Notes</span><textarea className="cp-input h-24 py-2.5" defaultValue={p.company.notes ?? ''} /></label>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="cp-card p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink"><Share2 size={16} className="text-brand" /> Social Accounts</h3>
                {p.social.length === 0
                  ? <p className="text-[13px] text-muted">No social accounts linked.</p>
                  : (
                    <div className="space-y-2">
                      {p.social.map(sn => (
                        <div key={sn.network} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 truncate rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-muted">{sn.network}</span>
                          <input className="cp-input h-10 flex-1" defaultValue={sn.handle ?? ''} />
                        </div>
                      ))}
                    </div>
                  )}
              </section>

              <section className="cp-card p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><MessageSquareText size={16} className="text-brand" /> Preferred Communication</h3>
                <p className="mb-3 mt-1 text-xs text-muted">Choose how you prefer us to contact you.</p>
                <div className="space-y-2.5">
                  {CHANNELS.map(({ key, icon: Icon, label, hint }) => (
                    <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 transition hover:border-slate-300 hover:bg-slate-50">
                      <input type="checkbox" className="cp-check mt-0.5" defaultChecked={p.communication[key]} />
                      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-ink">{label}</span>
                        <span className="block text-xs text-muted">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            </div>

            <div className="flex justify-end">
              <button className="cp-btn cp-btn-primary w-full sm:w-auto sm:px-8">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

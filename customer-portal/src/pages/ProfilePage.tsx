import { useState } from 'react'
import {
  UserRound, Building2, Share2, MessageSquareText, Mail, MessageCircle, Phone,
  Pencil, MapPin, Truck, CalendarDays, ClipboardList, Image as ImageIcon, Repeat, Wallet, CircleDollarSign,
} from 'lucide-react'
import { Layout } from '../components/Layout'
import { Badge } from '../components/ui'
import { CUSTOMER, money, num } from '../data/mock'

const CHANNELS = [
  { key: 'email', icon: Mail, label: 'Email', hint: 'Receive updates, order confirmations and important notifications via email.' },
  { key: 'sms', icon: MessageSquareText, label: 'SMS / Text Message', hint: 'Get quick updates and alerts on your mobile number.' },
  { key: 'whatsapp', icon: MessageCircle, label: 'WhatsApp', hint: 'Receive updates and support messages on WhatsApp.' },
  { key: 'phone', icon: Phone, label: 'Phone Call', hint: 'Get important updates and support via phone call.' },
] as const

export default function ProfilePage() {
  const [comms, setComms] = useState({ ...CUSTOMER.communication })
  const toggle = (key: keyof typeof comms) => setComms(c => ({ ...c, [key]: !c[key] }))

  const overview = [
    { icon: ClipboardList, label: 'Total Orders', value: num(CUSTOMER.account.totalOrders) },
    { icon: ImageIcon, label: 'Total Artworks', value: num(CUSTOMER.account.totalArtworks) },
    { icon: Repeat, label: 'Total Transfers Qty', value: num(CUSTOMER.account.totalTransfersQty) },
    { icon: Wallet, label: 'Total Spent', value: money(CUSTOMER.account.totalSpent) },
    { icon: CircleDollarSign, label: 'Outstanding Amount', value: money(CUSTOMER.account.outstanding) },
  ]

  return (
    <Layout title="Profile" subtitle="View and manage your account information." searchPlaceholder="Search by order no, artwork name…">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* Left column */}
        <div className="space-y-4">
          <section className="cp-card p-5 text-center sm:text-left">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand text-xl font-bold text-white">
                {CUSTOMER.initials}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h2 className="truncate text-lg font-bold text-ink">{CUSTOMER.name}</h2>
                  <Badge tone="bg-emerald-100 text-emerald-700">{CUSTOMER.status}</Badge>
                </div>
                <p className="mt-1 truncate text-[13px] text-muted">{CUSTOMER.email}</p>
                <p className="truncate text-[13px] text-muted">{CUSTOMER.phone}</p>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted sm:justify-start">
                  <CalendarDays size={13} /> Customer Since: {CUSTOMER.customerSince}
                </p>
              </div>
            </div>
            <button className="cp-btn mt-4 w-full border-brand/40 text-brand hover:bg-brand/5">
              <Pencil size={15} /> Edit Profile
            </button>
          </section>

          <section className="cp-card p-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">Account Overview</h3>
            <div className="divide-y divide-line">
              {overview.map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex items-center gap-2 text-[13px] text-muted">
                    <Icon size={15} className="text-slate-400" /> {label}
                  </span>
                  <span className="text-[13px] font-semibold text-ink">{value}</span>
                </div>
              ))}
            </div>
          </section>

          {[
            { title: 'Billing Address', icon: MapPin, lines: CUSTOMER.billingAddress },
            { title: 'Shipping Address', icon: Truck, lines: CUSTOMER.shippingAddress },
          ].map(({ title, icon: Icon, lines }) => (
            <section key={title} className="cp-card p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Icon size={16} className="text-slate-400" /> {title}
                </h3>
                <button className="text-[13px] font-medium text-brand hover:underline">Edit</button>
              </div>
              <address className="space-y-0.5 text-[13px] not-italic leading-relaxed text-muted">
                {lines.map(l => <div key={l}>{l}</div>)}
              </address>
            </section>
          ))}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <section className="cp-card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
              <UserRound size={16} className="text-brand" /> Personal Information
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label><span className="cp-label">Full Name</span><input className="cp-input" defaultValue={CUSTOMER.name} /></label>
              <label><span className="cp-label">Email Address</span><input className="cp-input" type="email" defaultValue={CUSTOMER.email} /></label>
              <label><span className="cp-label">Phone Number</span><input className="cp-input" type="tel" defaultValue={CUSTOMER.phone} /></label>
              <label><span className="cp-label">Job Title (Optional)</span><input className="cp-input" defaultValue={CUSTOMER.jobTitle} /></label>
              <label>
                <span className="cp-label">Country</span>
                <select className="cp-input" defaultValue={CUSTOMER.country}>
                  {['United States', 'Canada', 'United Kingdom', 'Australia'].map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label>
                <span className="cp-label">Time Zone</span>
                <select className="cp-input" defaultValue={CUSTOMER.timeZone}>
                  {[CUSTOMER.timeZone, '(GMT-05:00) Eastern Time (US & Canada)', '(GMT+00:00) UTC'].map(t => <option key={t}>{t}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="cp-card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
              <Building2 size={16} className="text-brand" /> Company Information
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label><span className="cp-label">Company Name</span><input className="cp-input" defaultValue={CUSTOMER.company.name} /></label>
              <label><span className="cp-label">Company Contact Email</span><input className="cp-input" type="email" defaultValue={CUSTOMER.company.contactEmail} /></label>
              <label>
                <span className="cp-label">Business Type</span>
                <select className="cp-input" defaultValue={CUSTOMER.company.businessType}>
                  {['Apparel / Fashion', 'Promotional', 'Retail', 'Other'].map(b => <option key={b}>{b}</option>)}
                </select>
              </label>
              <label><span className="cp-label">Tax ID / EIN (Optional)</span><input className="cp-input" defaultValue={CUSTOMER.company.taxId} /></label>
              <label className="md:col-span-1"><span className="cp-label">Website (Optional)</span><input className="cp-input" defaultValue={CUSTOMER.company.website} /></label>
              <label className="md:col-span-1">
                <span className="cp-label">Notes (Optional)</span>
                <textarea className="cp-input h-24 py-2.5" defaultValue={CUSTOMER.company.notes} />
              </label>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="cp-card p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
                <Share2 size={16} className="text-brand" /> Social Accounts
              </h3>
              <div className="space-y-2">
                {CUSTOMER.social.map(s => (
                  <div key={s.network} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-muted">{s.network}</span>
                    <input className="cp-input h-10 flex-1" defaultValue={s.handle} />
                  </div>
                ))}
              </div>
            </section>

            <section className="cp-card p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <MessageSquareText size={16} className="text-brand" /> Preferred Method of Communication
              </h3>
              <p className="mb-3 mt-1 text-xs text-muted">Choose how you prefer us to contact you.</p>
              <div className="space-y-2.5">
                {CHANNELS.map(({ key, icon: Icon, label, hint }) => (
                  <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 transition hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={comms[key]}
                      onChange={() => toggle(key)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                    />
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
    </Layout>
  )
}

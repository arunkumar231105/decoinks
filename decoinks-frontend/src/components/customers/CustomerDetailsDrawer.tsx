import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Mail, MessageSquare, Phone, X } from 'lucide-react'
import { api } from '../../services/api'

export interface CustomerDetails {
  id: string; customer_number?: string; name: string; display_name?: string; contact_person?: string
  first_name?: string; last_name?: string; company_name?: string; company?: string; job_title?: string
  email?: string; phone?: string; primary_phone?: string; mobile_number?: string; whatsapp?: string; website?: string
  address_line1?: string; city?: string; state?: string; zip?: string; country?: string
  customer_type?: string; segment?: string; tier?: string; status: string; created_at: string
  payment_terms?: string; credit_limit?: number; available_credit?: number; agent_name?: string
  internal_notes?: string; source?: string
  total_orders?: number; total_spent?: number; avg_order_value?: number
  lifetime_value?: number
  last_order_date?: string; last_order_number?: string
  outstanding_balance?: number; overdue_balance?: number; open_invoices?: number
  last_payment?: { amount: number; paid_at: string; payment_method?: string } | null
  last_invoice?: { invoice_number: string; total: number; balance_due: number; status: string; issue_date: string } | null
  activity?: Array<{ description: string; created_at: string; user_name?: string }>
}

const fmt = (value?: string) => value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const fmtDate = (value?: string) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const money = (value?: number | string | null) => value == null ? '—' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const initials = (name: string) => name.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase()
const label = (value?: string) => value ? value.split(/[_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').replace('Non Profit', 'Non-Profit') : '—'

export function CustomerDetailsDrawer({ customerId, onClose }: { customerId: string | null; onClose: () => void }) {
  const nav = useNavigate()
  const { data: customer, isLoading, isError, refetch } = useQuery<CustomerDetails>({
    queryKey: ['customer-details', customerId], enabled: Boolean(customerId),
    queryFn: () => api.get(`/customers/${customerId}`).then(r => r.data.data),
  })
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close)
  }, [onClose])
  if (!customerId) return null
  const name = customer?.display_name || customer?.company_name || customer?.name || 'Unknown customer'
  const dueBalance = Number(customer?.outstanding_balance || 0)
  return <>
    <button className="leads-drawer-scrim" aria-label="Close customer details" onClick={onClose} />
    <aside className="leads-drawer" aria-label="Customer details">
      {isLoading ? <div className="leads-drawer-loading">Loading customer details…</div>
      : isError || !customer ? <div className="leads-drawer-loading">Unable to load this customer. <button className="leads-state-link" onClick={() => refetch()}>Retry</button></div>
      : <>
        <header className="leads-drawer-head">
          <div className="leads-avatar">{initials(name)}</div>
          <div><h2>{name}</h2><p>{customer.contact_person && customer.contact_person !== name ? `${customer.contact_person} · ` : ''}{customer.email || 'No email'} · Customer since {fmtDate(customer.created_at)}</p></div>
          <button className="leads-icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button>
        </header>
        <div className="leads-drawer-badges">
          {customer.customer_type && <span className="badge stage">{label(customer.customer_type)}</span>}
          {customer.segment && <span className="badge seg">{label(customer.segment)}</span>}
          <span className={`badge st-${(customer.status || '').toLowerCase()}`}>{label(customer.status)}</span>
        </div>
        <div className="leads-quick-actions">
          <a className={!customer.whatsapp && !customer.primary_phone ? 'disabled' : ''} href={customer.whatsapp || customer.primary_phone ? `https://wa.me/${(customer.whatsapp || customer.primary_phone || '').replace(/\D/g, '')}` : undefined} target="_blank" rel="noreferrer" title={customer.whatsapp || customer.primary_phone ? 'Message customer' : 'No messaging number'}><MessageSquare size={17}/><span>Message</span></a>
          <a className={!customer.primary_phone ? 'disabled' : ''} href={customer.primary_phone ? `tel:${customer.primary_phone}` : undefined} title={customer.primary_phone ? 'Call customer' : 'No phone number'}><Phone size={17}/><span>Call</span></a>
          <a className={!customer.email ? 'disabled' : ''} href={customer.email ? `mailto:${customer.email}` : undefined} title={customer.email ? 'Email customer' : 'No email address'}><Mail size={17}/><span>Email</span></a>
        </div>
        <section className="leads-drawer-section"><h3>Contact Information</h3><dl className="leads-info">
          <dt>Contact Person</dt><dd>{customer.contact_person || '—'}</dd>
          <dt>Job Title</dt><dd>{customer.job_title || '—'}</dd>
          <dt>Phone</dt><dd>{customer.primary_phone || '—'}</dd>
          <dt>Email</dt><dd>{customer.email || '—'}</dd>
          <dt>Company</dt><dd>{customer.company_name || customer.company || '—'}</dd>
          <dt>Website</dt><dd>{customer.website ? <a className="leads-link" href={/^https?:/i.test(customer.website) ? customer.website : `https://${customer.website}`} target="_blank" rel="noreferrer">{customer.website}</a> : '—'}</dd>
          <dt>Address</dt><dd>{[customer.address_line1, customer.city, customer.state, customer.zip, customer.country].filter(Boolean).join(', ') || '—'}</dd>
        </dl></section>
        <section className="leads-drawer-section"><h3>Customer Overview</h3><dl className="leads-info">
          <dt>Customer No</dt><dd>{customer.customer_number || '—'}</dd>
          <dt>Customer Type</dt><dd>{label(customer.customer_type)}</dd>
          <dt>Segment</dt><dd>{customer.segment ? label(customer.segment) : '—'}</dd>
          <dt>Customer Since</dt><dd>{fmtDate(customer.created_at)}</dd>
          <dt>Total Orders</dt><dd>{customer.total_orders ?? 0}</dd>
          <dt>Total Spent</dt><dd>{money(customer.total_spent ?? 0)}</dd>
          <dt>Avg. Order Value</dt><dd>{customer.avg_order_value == null ? '—' : money(customer.avg_order_value)}</dd>
          <dt>Customer Lifetime Value</dt><dd>{customer.lifetime_value == null ? '—' : money(customer.lifetime_value)}</dd>
          <dt>Last Order</dt><dd>{customer.last_order_date ? <>{fmtDate(customer.last_order_date)}<small className="leads-cell-sub">{customer.last_order_number || ''}</small></> : '—'}</dd>
          <dt>Assigned Agent</dt><dd>{customer.agent_name || '—'}</dd>
        </dl></section>
        <section className="leads-drawer-section"><h3>Account Summary</h3><dl className="leads-info">
          <dt>Outstanding Balance</dt><dd className={dueBalance > 0 ? 'cw-due' : ''}>{money(dueBalance)}</dd>
          <dt>Overdue Balance</dt><dd className={Number(customer.overdue_balance || 0) > 0 ? 'cw-due' : ''}>{money(customer.overdue_balance ?? 0)}</dd>
          <dt>Open Invoices</dt><dd>{customer.open_invoices ?? 0}</dd>
          <dt>Credit Limit</dt><dd>{customer.credit_limit == null ? '—' : money(customer.credit_limit)}</dd>
          <dt>Available Credit</dt><dd>{customer.available_credit == null ? '—' : money(customer.available_credit)}</dd>
          <dt>Payment Terms</dt><dd>{customer.payment_terms || '—'}</dd>
          <dt>Last Payment</dt><dd>{customer.last_payment ? <>{money(customer.last_payment.amount)}<small className="leads-cell-sub">{fmtDate(customer.last_payment.paid_at)}</small></> : '—'}</dd>
          <dt>Last Invoice</dt><dd>{customer.last_invoice ? <>{customer.last_invoice.invoice_number}<small className="leads-cell-sub">{money(customer.last_invoice.total)} · {customer.last_invoice.status}</small></> : '—'}</dd>
        </dl></section>
        <section className="leads-drawer-section"><h3>Notes</h3>{customer.internal_notes ? <p className="cw-notes">{customer.internal_notes}</p> : <p className="leads-neutral">No notes recorded.</p>}</section>
        <section className="leads-drawer-section"><h3>Activity Timeline</h3>{customer.activity?.length ? <div className="leads-timeline">{customer.activity.map((item, index) => <div key={`${item.created_at}-${index}`}><i/><p>{item.description}<small>{item.user_name ? `${item.user_name} · ` : ''}{fmt(item.created_at)}</small></p></div>)}</div> : <p className="leads-neutral">No activity recorded.</p>}</section>
        <footer className="cw-drawer-footer">
          <button className="leads-btn" onClick={() => nav(`/customers/${customer.id}`)}><ExternalLink size={16}/> View Full Profile</button>
        </footer>
      </>}
    </aside>
  </>
}

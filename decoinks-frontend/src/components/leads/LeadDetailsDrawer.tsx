import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Mail, MessageSquare, Phone, X } from 'lucide-react'
import { api } from '../../services/api'

export interface LeadDetails {
  id: string; display_number?: string; lead_number: string; customer_name?: string; supplier_name?: string
  company_name?: string; email?: string; phone?: string; whatsapp?: string; source?: string; stage: string; status: string
  created_at: string; conversion_score?: number; urgency?: string; customer_intent?: string; product_interest?: string
  estimated_value?: number; agent_name?: string; last_contact_at?: string; next_action?: string; next_followup_date?: string
  activity?: Array<{ id: string; description: string; created_at: string; user_name?: string }>
  qualification?: Record<string, boolean | number | string | null>; productInterest?: Array<{ product_type?: string }>
}

const fmt = (value?: string) => value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const initials = (name: string) => name.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase()

export function LeadDetailsDrawer({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { data: lead, isLoading } = useQuery<LeadDetails>({
    queryKey: ['lead-details', leadId], enabled: Boolean(leadId),
    queryFn: () => api.get(`/leads/${leadId}`).then(r => r.data.data),
  })
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close)
  }, [onClose])
  if (!leadId) return null
  const name = lead?.customer_name || lead?.supplier_name || lead?.company_name || 'Unknown lead'
  const score = Number(lead?.conversion_score || 0)
  const product = lead?.product_interest || lead?.productInterest?.map(x => x.product_type).filter(Boolean).join(', ') || '—'
  const checks = lead?.qualification ? Object.entries(lead.qualification).filter(([key, value]) => key !== 'id' && key !== 'lead_id' && typeof value === 'boolean') : []
  return <>
    <button className="leads-drawer-scrim" aria-label="Close lead details" onClick={onClose} />
    <aside className="leads-drawer" aria-label="Lead details">
      {isLoading || !lead ? <div className="leads-drawer-loading">Loading lead details…</div> : <>
        <header className="leads-drawer-head">
          <div className="leads-avatar">{initials(name)}</div><div><h2>{name}</h2><p>{lead.source || 'Unknown source'} · {fmt(lead.created_at)}</p></div>
          <button className="leads-icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button>
        </header>
        <div className="leads-drawer-badges"><span className="badge hot">{lead.urgency || 'No temperature'}</span><span className="badge active">{lead.status}</span><span className="badge stage">{lead.stage}</span></div>
        <div className="leads-quick-actions">
          <a className={!lead.whatsapp && !lead.phone ? 'disabled' : ''} href={lead.whatsapp || lead.phone ? `https://wa.me/${(lead.whatsapp || lead.phone || '').replace(/\D/g, '')}` : undefined} title={lead.whatsapp || lead.phone ? 'Message lead' : 'No messaging number'}><MessageSquare size={17}/><span>Message</span></a>
          <a className={!lead.phone ? 'disabled' : ''} href={lead.phone ? `tel:${lead.phone}` : undefined} title={lead.phone ? 'Call lead' : 'No phone number'}><Phone size={17}/><span>Call</span></a>
          <a className={!lead.email ? 'disabled' : ''} href={lead.email ? `mailto:${lead.email}` : undefined} title={lead.email ? 'Email lead' : 'No email address'}><Mail size={17}/><span>Email</span></a>
        </div>
        <section className="leads-drawer-section"><div className="leads-section-title"><h3>Qualification Score</h3><strong>{score}<small>/100</small></strong></div><div className="leads-score-track"><i style={{ width: `${Math.min(100, score)}%` }}/></div><p className="leads-score-label">{score >= 60 ? 'Qualified' : score >= 30 ? 'Developing' : 'Unqualified'}</p>{checks.length > 0 && <div className="leads-checks">{checks.map(([key, value]) => <div key={key} className={value ? 'done' : ''}>{value ? '✓' : '○'} {key.replaceAll('_', ' ')}</div>)}</div>}</section>
        <section className="leads-drawer-section"><h3>Lead Information</h3><dl className="leads-info"><dt>Lead No</dt><dd>{lead.display_number || lead.lead_number}</dd><dt>Source</dt><dd>{lead.source || '—'}</dd><dt>Product Interest</dt><dd>{product}</dd><dt>Purchase Intent</dt><dd>{lead.customer_intent || '—'}</dd><dt>Estimated Value</dt><dd>{lead.estimated_value == null ? '—' : `$${Number(lead.estimated_value).toLocaleString()}`}</dd><dt>Assigned Agent</dt><dd>{lead.agent_name || '—'}</dd><dt>Last Activity</dt><dd>{fmt(lead.last_contact_at)}</dd><dt>Next Action</dt><dd>{lead.next_action || '—'}</dd></dl></section>
        <section className="leads-drawer-section"><h3>Activity Timeline</h3>{lead.activity?.length ? <div className="leads-timeline">{lead.activity.map(item => <div key={item.id}><i/><p>{item.description}<small>{item.user_name ? `${item.user_name} · ` : ''}{fmt(item.created_at)}</small></p></div>)}</div> : <p className="leads-neutral">No activity recorded.</p>}</section>
      </>}
    </aside>
  </>
}

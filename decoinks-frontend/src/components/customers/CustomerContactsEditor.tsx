import { Plus, Trash2 } from 'lucide-react'

// A contact person at a customer account. Kept flat/stringy to match the
// NewCustomerPage form-state style; the page maps blanks → null on save.
export interface ContactDraft {
  first_name: string
  middle_name: string
  last_name: string
  job_title: string
  email: string
  phone: string
  mobile_number: string
  whatsapp: string
  is_primary: boolean
  notes: string
}

export const EMPTY_CONTACT: ContactDraft = {
  first_name: '', middle_name: '', last_name: '', job_title: '', email: '',
  phone: '', mobile_number: '', whatsapp: '', is_primary: false, notes: '',
}

// True when a contact row carries no data worth saving (the backend skips these
// too, so the payload and the DB stay in agreement).
export const contactIsBlank = (c: ContactDraft) =>
  !(c.first_name || c.middle_name || c.last_name || c.job_title ||
    c.email || c.phone || c.mobile_number || c.whatsapp || c.notes)

export function CustomerContactsEditor({ value, onChange }: {
  value: ContactDraft[]
  onChange: (next: ContactDraft[]) => void
}) {
  const update = (i: number, patch: Partial<ContactDraft>) =>
    onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  // Exactly one primary — mirrors the DB's one-primary-per-customer rule.
  const setPrimary = (i: number) =>
    onChange(value.map((c, idx) => ({ ...c, is_primary: idx === i })))
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const add = () => onChange([...value, { ...EMPTY_CONTACT, is_primary: value.length === 0 }])

  return (
    <div className="ncust-section-body">
      {value.length === 0 && (
        <p style={{ fontSize: 13, color: '#94A3B8', margin: '0 0 12px' }}>
          No contacts yet. Add the people you deal with at this account (e.g. Purchasing, Accounts).
        </p>
      )}
      {value.map((c, i) => (
        <div key={i} className="al-panel" style={{ padding: 14, marginBottom: 12, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
              <input type="radio" name="primary-contact" checked={c.is_primary} onChange={() => setPrimary(i)} />
              <span style={{ fontSize: 12, fontWeight: 600, color: c.is_primary ? '#0D9488' : '#64748B' }}>
                {c.is_primary ? 'Primary contact' : 'Set as primary'}
              </span>
            </label>
            <button type="button" className="lb-action-btn" style={{ color: '#DC2626', padding: '4px 8px' }}
              onClick={() => remove(i)} aria-label="Remove contact"><Trash2 size={14} /></button>
          </div>
          <div className="al-field-row">
            <div className="al-field"><label>First Name</label>
              <input className="al-input" maxLength={50} value={c.first_name} onChange={e => update(i, { first_name: e.target.value })} /></div>
            <div className="al-field"><label>Middle Name</label>
              <input className="al-input" maxLength={50} value={c.middle_name} onChange={e => update(i, { middle_name: e.target.value })} /></div>
            <div className="al-field"><label>Last Name</label>
              <input className="al-input" maxLength={50} value={c.last_name} onChange={e => update(i, { last_name: e.target.value })} /></div>
          </div>
          <div className="al-field-row">
            <div className="al-field"><label>Job Title / Role</label>
              <input className="al-input" maxLength={120} value={c.job_title} onChange={e => update(i, { job_title: e.target.value })} /></div>
            <div className="al-field"><label>Email</label>
              <input className="al-input" type="email" value={c.email} onChange={e => update(i, { email: e.target.value })} /></div>
          </div>
          <div className="al-field-row">
            <div className="al-field"><label>Phone</label>
              <input className="al-input" type="tel" value={c.phone} onChange={e => update(i, { phone: e.target.value })} /></div>
            <div className="al-field"><label>Mobile</label>
              <input className="al-input" type="tel" value={c.mobile_number} onChange={e => update(i, { mobile_number: e.target.value })} /></div>
            <div className="al-field"><label>WhatsApp</label>
              <input className="al-input" type="tel" value={c.whatsapp} onChange={e => update(i, { whatsapp: e.target.value })} /></div>
          </div>
          <div className="al-field"><label>Notes</label>
            <input className="al-input" maxLength={2000} value={c.notes} onChange={e => update(i, { notes: e.target.value })} /></div>
        </div>
      ))}
      <button type="button" className="lb-action-btn" onClick={add}><Plus size={14} /> Add Contact</button>
    </div>
  )
}

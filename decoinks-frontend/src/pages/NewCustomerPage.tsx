import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, User, Link2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import toast from '../utils/toast'
import { api } from '../services/api'

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'France', 'Mexico', 'Brazil', 'India', 'China', 'Japan']
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']
const BUYER_TYPES = ['Retail', 'Wholesale', 'Corporate', 'Non-Profit', 'Individual', 'Other']
const SOURCES = ['', 'Facebook Messenger', 'WhatsApp', 'Instagram', 'Email', 'Walk-in', 'Phone', 'Referral', 'Other']

function LeadCombobox({ value, onChange }: {
  value: string
  onChange: (text: string, lead?: { id: string; lead_number: string; customer_name: string; source: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data: leads = [] } = useQuery<any[]>({
    queryKey: ['leads-mini'],
    queryFn: () => api.get('/leads', { params: { limit: 200, status: 'Open' } }).then(r => r.data.data?.rows ?? []),
  })
  const filtered = leads.filter((l: any) =>
    (l.lead_number ?? '').toLowerCase().includes(value.toLowerCase()) ||
    (l.customer_name ?? '').toLowerCase().includes(value.toLowerCase())
  ).slice(0, 8)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <input
        className="al-input"
        value={value}
        placeholder="Search by lead # or name..."
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.1)', zIndex: 999, maxHeight: 220, overflowY: 'auto' }}>
          {filtered.map((l: any) => (
            <div
              key={l.id}
              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #F8FAFC', fontSize: 13 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
              onMouseDown={() => { onChange(l.lead_number, l); setOpen(false) }}
            >
              <span style={{ fontWeight: 600, color: '#0D9488' }}>{l.lead_number}</span>
              <span style={{ color: '#334155', marginLeft: 8 }}>{l.customer_name}</span>
              {l.source && <span style={{ color: '#94A3B8', marginLeft: 8, fontSize: 11 }}>· {l.source}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function NewCustomerPage() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)

  // Lead link
  const [leadId,     setLeadId]     = useState<string | null>(null)
  const [leadText,   setLeadText]   = useState('')

  // Section 1 — Contact Info
  const [firstName,  setFirstName]  = useState('')
  const [lastName,   setLastName]   = useState('')
  const [company,   setCompany]   = useState('')
  const [email,     setEmail]     = useState('')
  const [phone,     setPhone]     = useState('')
  const [whatsapp,  setWhatsapp]  = useState('')

  // Section 2 — Online Presence
  const [website,     setWebsite]     = useState('')
  const [facebookId,  setFacebookId]  = useState('')
  const [instagramId, setInstagramId] = useState('')

  // Section 3 — Address
  const [addrLine1,        setAddrLine1]        = useState('')
  const [city,             setCity]             = useState('')
  const [stateVal,         setStateVal]         = useState('')
  const [zip,              setZip]              = useState('')
  const [country,          setCountry]          = useState('United States')
  const [billingAddress,   setBillingAddress]   = useState('')

  // Section 4 — Classification
  const [buyerType, setBuyerType] = useState(BUYER_TYPES[0])
  const [source,    setSource]    = useState('')
  const [notes,     setNotes]     = useState('')

  const handleSave = async () => {
    if (!firstName.trim()) { toast.error('First name is required'); return }
    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        lead_id: leadId || undefined,
        name: fullName,
        company: company.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
        website: website.trim() || undefined,
        facebook_id: facebookId.trim() || undefined,
        instagram_id: instagramId.trim() || undefined,
        address_line1: addrLine1.trim() || undefined,
        city: city.trim() || undefined,
        state: stateVal || undefined,
        zip: zip.trim() || undefined,
        country: country || undefined,
        billing_address: billingAddress.trim() || undefined,
        buyer_type: buyerType,
        source: source || undefined,
        internal_notes: notes.trim() || undefined,
      }
      const res = await api.post('/customers', payload)
      const newId: string = res.data.data?.id ?? res.data.id
      toast.success('Customer created')
      navigate(`/customers/${newId}`)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string; details?: { field: string; message: string }[] } } }
      const details = e.response?.data?.details
      const firstDetail = details?.[0]
      const msg = firstDetail
        ? `${firstDetail.field}: ${firstDetail.message}`
        : (e.response?.data?.message ?? e.response?.data?.error ?? 'Failed to save customer')
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ncust-page">
      <div className="ncust-header">
        <div>
          <div className="ns-breadcrumb">
            <span style={{ cursor: 'pointer', color: '#64748B' }} onClick={() => navigate('/customers')}>Customers</span>
            <ChevronRight size={13} />
            <strong>New Customer</strong>
          </div>
          <h2 className="ns-page-title">New Customer</h2>
        </div>
        <div className="ns-header-actions">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button className="lb-action-btn lb-action-primary ns-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Customer'}
          </button>
        </div>
      </div>

      <div className="ncust-grid">

        {/* Left column */}
        <div className="ncust-col">

          {/* Lead Link */}
          <div className="al-panel al-section" style={{ borderLeft: leadId ? '3px solid #0D9488' : '3px solid #E2E8F0' }}>
            <div className="al-section-header">
              <Link2 size={15} style={{ color: leadId ? '#0D9488' : '#94A3B8' }} />
              <h4 style={{ marginLeft: 6 }}>Link to Lead <span style={{ fontSize: 11, fontWeight: 400, color: '#94A3B8' }}>(optional)</span></h4>
              {leadId && <span style={{ marginLeft: 'auto', fontSize: 11, background: '#CCFBF1', color: '#0D9488', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>Linked</span>}
            </div>
            <div className="ncust-section-body">
              <div className="al-field">
                <label>Search Lead</label>
                <LeadCombobox
                  value={leadText}
                  onChange={(text, lead) => {
                    setLeadText(text)
                    if (lead) {
                      setLeadId(lead.id)
                      if (lead.source && !source) setSource(lead.source)
                      if (lead.customer_name && !firstName) setFirstName(lead.customer_name)
                    } else {
                      setLeadId(null)
                    }
                  }}
                />
                {leadId && (
                  <button
                    style={{ fontSize: 11, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, padding: 0 }}
                    onClick={() => { setLeadId(null); setLeadText('') }}
                  >Remove link</button>
                )}
              </div>
              {!leadId && (
                <p style={{ fontSize: 12, color: '#94A3B8', margin: 0 }}>
                  Agar yeh customer kisi lead se convert hua ha toh lead search karo — warna khali chhodo.
                </p>
              )}
            </div>
          </div>

          {/* Section 1 — Contact Info */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">1</span>
              <h4>Contact Information</h4>
            </div>
            <div className="ncust-section-body">
              <div className="ncust-name-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="al-field">
                  <label>First Name <span className="al-req">*</span></label>
                  <input
                    className="al-input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="e.g. Jane"
                  />
                </div>
                <div className="al-field">
                  <label>Last Name <span className="al-optional">(optional)</span></label>
                  <input
                    className="al-input"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="e.g. Smith"
                  />
                </div>
              </div>
              <div className="al-field">
                <label>Company / Business Name <span className="al-optional">(optional)</span></label>
                <input
                  className="al-input"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Acme Corp"
                />
              </div>
              <div className="al-field">
                <label>Email Address <span className="al-optional">(optional)</span></label>
                <input
                  type="email"
                  className="al-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="customer@email.com"
                />
              </div>
              <div className="al-field-row">
                <div className="al-field">
                  <label>Phone Number <span className="al-optional">(optional)</span></label>
                  <input
                    type="tel"
                    className="al-input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
                <div className="al-field">
                  <label>WhatsApp <span className="al-optional">(optional)</span></label>
                  <input
                    type="tel"
                    className="al-input"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2 — Online Presence */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">2</span>
              <h4>Online Presence</h4>
            </div>
            <div className="ncust-section-body">
              <div className="al-field">
                <label>Website <span className="al-optional">(optional)</span></label>
                <input
                  type="url"
                  className="al-input"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div className="al-field">
                <label>Facebook ID <span className="al-optional">(optional)</span></label>
                <input
                  className="al-input"
                  value={facebookId}
                  onChange={(e) => setFacebookId(e.target.value)}
                  placeholder="facebook.com/username or Page ID"
                />
              </div>
              <div className="al-field">
                <label>Instagram ID <span className="al-optional">(optional)</span></label>
                <input
                  className="al-input"
                  value={instagramId}
                  onChange={(e) => setInstagramId(e.target.value)}
                  placeholder="@handle or instagram.com/username"
                />
              </div>
            </div>
          </div>

          {/* Section 4 — Classification */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">4</span>
              <h4>Classification</h4>
            </div>
            <div className="ncust-section-body">
              <div className="al-field-row">
                <div className="al-field">
                  <label>Source Channel <span className="al-optional">(optional)</span></label>
                  <select className="al-input" value={source} onChange={(e) => setSource(e.target.value)}>
                    {SOURCES.map(s => <option key={s} value={s}>{s || '— Select source —'}</option>)}
                  </select>
                </div>
                <div className="al-field">
                  <label>Buyer Type</label>
                  <select className="al-input" value={buyerType} onChange={(e) => setBuyerType(e.target.value)}>
                    {BUYER_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="al-field">
                <div className="al-label-row">
                  <label>Internal Notes <span className="al-optional">(optional)</span></label>
                  <span className="al-char-count">{notes.length}/500</span>
                </div>
                <textarea
                  className="al-textarea"
                  rows={5}
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any special requirements, preferences, or notes about this customer..."
                />
              </div>
            </div>
          </div>

        </div>

        {/* Right column */}
        <div className="ncust-col">

          {/* Section 3 — Address */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <span className="al-section-num">3</span>
              <h4>Address</h4>
            </div>
            <div className="ncust-section-body">
              <div className="al-field">
                <label>Address Line 1 / Street</label>
                <input
                  className="al-input"
                  value={addrLine1}
                  onChange={(e) => setAddrLine1(e.target.value)}
                  placeholder="Street address"
                />
              </div>
              <div className="al-field-row">
                <div className="al-field">
                  <label>City</label>
                  <input
                    className="al-input"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="City"
                  />
                </div>
                <div className="al-field">
                  <label>State / Province</label>
                  <select className="al-input" value={stateVal} onChange={(e) => setStateVal(e.target.value)}>
                    <option value="">Select state</option>
                    {US_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="al-field-row">
                <div className="al-field">
                  <label>ZIP / Postal Code</label>
                  <input
                    className="al-input"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    placeholder="00000"
                  />
                </div>
                <div className="al-field">
                  <label>Country</label>
                  <select className="al-input" value={country} onChange={(e) => setCountry(e.target.value)}>
                    {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #F1F5F9' }}>
                <div className="al-field">
                  <label>Billing Address</label>
                  <textarea
                    className="al-textarea"
                    rows={3}
                    value={billingAddress}
                    onChange={(e) => setBillingAddress(e.target.value)}
                    placeholder="Enter billing address (leave blank to use the address above)..."
                  />
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="al-bottom-bar">
        <div className="al-bottom-left" />
        <div className="al-bottom-center" />
        <div className="al-bottom-right">
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button className="lb-action-btn lb-action-primary ns-save-btn" onClick={handleSave} disabled={saving}>
            <User size={14} /> {saving ? 'Saving...' : 'Save Customer'}
          </button>
        </div>
      </div>
    </div>
  )
}

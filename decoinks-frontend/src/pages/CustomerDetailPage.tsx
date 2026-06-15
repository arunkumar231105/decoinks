import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '@mui/material'
import {
  ChevronRight, Edit2, Save, X,
  MapPin, Phone, Mail, Building2, FileText,
  ExternalLink, Tag, MessageCircle, FileCheck,
} from 'lucide-react'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { cn } from '../utils/cn'

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'France', 'Mexico', 'Brazil', 'India', 'China', 'Japan']
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']
const BUYER_TYPES = ['Retail', 'Wholesale', 'Corporate', 'Non-Profit', 'Individual', 'Other']

const AVATAR_COLORS = ['#0D9488','#2563EB','#7C3AED','#F59E0B','#EF4444','#10B981','#6366F1','#EC4899','#F97316','#0891B2','#16A34A','#9333EA']
function avatarColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

interface Customer {
  id: string
  customer_number?: string
  name: string
  company: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  website: string | null
  facebook_id: string | null
  instagram_id: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  same_as_billing: boolean
  billing_address: string | null
  buyer_type: string | null
  source: string | null
  notes: string | null
  status: 'Active' | 'Inactive' | 'Blocked'
  lead_id: string | null
  lead_number: string | null
  lead_source: string | null
  created_at: string
  quotes_count: number
}

interface Quote {
  id: string
  quote_number: string
  status: string
  total: number
  created_at: string
}

const QUOTE_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Draft:     { bg: '#F1F5F9', text: '#64748B' },
  Sent:      { bg: '#DBEAFE', text: '#1D4ED8' },
  Accepted:  { bg: '#D1FAE5', text: '#059669' },
  Rejected:  { bg: '#FEE2E2', text: '#DC2626' },
  Expired:   { bg: '#FEF3C7', text: '#D97706' },
  Cancelled: { bg: '#FEE2E2', text: '#DC2626' },
}

function statusBadgeStyle(status: string): React.CSSProperties {
  if (status === 'Active')   return { background: '#DCFCE7', color: '#16A34A' }
  if (status === 'Blocked')  return { background: '#FEE2E2', color: '#DC2626' }
  return { background: '#F1F5F9', color: '#64748B' }
}

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [editing, setEditing] = useState(false)

  const [name,           setName]           = useState('')
  const [company,        setCompany]        = useState('')
  const [email,          setEmail]          = useState('')
  const [phone,          setPhone]          = useState('')
  const [whatsapp,       setWhatsapp]       = useState('')
  const [website,        setWebsite]        = useState('')
  const [facebookId,     setFacebookId]     = useState('')
  const [instagramId,    setInstagramId]    = useState('')
  const [addrLine1,      setAddrLine1]      = useState('')
  const [city,           setCity]           = useState('')
  const [stateVal,       setStateVal]       = useState('')
  const [zip,            setZip]            = useState('')
  const [country,        setCountry]        = useState('United States')
  const [sameAsBilling,  setSameAsBilling]  = useState(true)
  const [billingAddress, setBillingAddress] = useState('')
  const [buyerType,      setBuyerType]      = useState(BUYER_TYPES[0])
  const [source,         setSource]         = useState('')
  const [notes,          setNotes]          = useState('')
  const [status,         setStatus]         = useState<'Active' | 'Inactive' | 'Blocked'>('Active')

  const { data: customerData, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get(`/customers/${id}`).then(r => r.data.data as { customer: Customer; quotes: Quote[] }),
    enabled: !!id,
  })

  const customer: Customer | undefined = customerData?.customer
  const quotes: Quote[] = customerData?.quotes ?? []

  const populateForm = (c: Customer) => {
    setName(c.name ?? '')
    setCompany(c.company ?? '')
    setEmail(c.email ?? '')
    setPhone(c.phone ?? '')
    setWhatsapp(c.whatsapp ?? '')
    setWebsite(c.website ?? '')
    setFacebookId(c.facebook_id ?? '')
    setInstagramId(c.instagram_id ?? '')
    setAddrLine1(c.address_line1 ?? '')
    setCity(c.city ?? '')
    setStateVal(c.state ?? '')
    setZip(c.zip ?? '')
    setCountry(c.country ?? 'United States')
    setSameAsBilling(c.same_as_billing ?? true)
    setBillingAddress(c.billing_address ?? '')
    setBuyerType(c.buyer_type ?? BUYER_TYPES[0])
    setSource(c.source ?? '')
    setNotes(c.notes ?? '')
    setStatus(c.status)
  }

  useEffect(() => {
    if (customer) populateForm(customer)
  }, [customer])

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.put(`/customers/${id}`, payload),
    onSuccess: () => {
      toast.success('Customer updated')
      qc.invalidateQueries({ queryKey: ['customer', id] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      setEditing(false)
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e?.response?.data?.error ?? 'Failed to update customer'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/customers/${id}`),
    onSuccess: () => {
      toast.success('Customer deleted')
      navigate('/customers')
    },
    onError: () => toast.error('Failed to delete customer'),
  })

  const handleSave = () => {
    if (!name.trim()) return toast.error('Name is required')
    updateMutation.mutate({
      name: name.trim(),
      company: company.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      whatsapp: whatsapp.trim() || null,
      website: website.trim() || null,
      facebook_id: facebookId.trim() || null,
      instagram_id: instagramId.trim() || null,
      address_line1: addrLine1.trim() || null,
      city: city.trim() || null,
      state: stateVal || null,
      zip: zip.trim() || null,
      country: country || null,
      same_as_billing: sameAsBilling,
      billing_address: sameAsBilling ? null : (billingAddress.trim() || null),
      buyer_type: buyerType || null,
      source: source || null,
      notes: notes.trim() || null,
      status,
    })
  }

  const handleCancel = () => {
    if (customer) populateForm(customer)
    setEditing(false)
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <span style={{ color: '#94A3B8', fontSize: 14 }}>Loading...</span>
      </div>
    )
  }

  if (!customer) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <span style={{ color: '#94A3B8', fontSize: 14 }}>Customer not found.</span>
      </div>
    )
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtCurr = (v: number) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div className="ns-breadcrumb" style={{ marginBottom: 6 }}>
            <span style={{ cursor: 'pointer', color: '#64748B' }} onClick={() => navigate('/customers')}>Customers</span>
            <ChevronRight size={13} style={{ color: '#CBD5E1' }} />
            <strong style={{ color: '#0F172A' }}>{customer.name}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>Customer Profile</h2>
            {customer.customer_number && (
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE' }}>
                #{customer.customer_number}
              </span>
            )}
            {customer.lead_id && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#FEF9C3', color: '#92400E', border: '1px solid #FDE68A' }}>
                Converted from {customer.lead_number ?? `Lead #${customer.lead_id.slice(0, 8)}`}
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Review and edit customer account details.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {editing ? (
            <>
              <button className="lb-action-btn" onClick={handleCancel}><X size={14} /> Cancel</button>
              <button
                className="lb-action-btn lb-action-primary"
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                <Save size={14} /> {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          ) : (
            <>
              <button
                className="lb-action-btn"
                style={{ color: '#DC2626' }}
                onClick={() => { if (window.confirm('Delete this customer? This cannot be undone.')) deleteMutation.mutate() }}
                disabled={deleteMutation.isPending}
              >
                Delete
              </button>
              <button className="lb-action-btn lb-action-primary" onClick={() => setEditing(true)}>
                <Edit2 size={14} /> Edit Customer
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>

        {/* Main column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Identity card */}
          <div className="al-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <Avatar sx={{ width: 56, height: 56, fontSize: 20, bgcolor: avatarColor(customer.id) }}>
                {initials(customer.name)}
              </Avatar>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>{customer.name}</div>
                {customer.company && <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>{customer.company}</div>}
                <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 999, ...statusBadgeStyle(customer.status) }}>
                  {customer.status}
                </span>
              </div>
            </div>

            {!editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {customer.email && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Mail size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#334155' }}>{customer.email}</span>
                  </div>
                )}
                {customer.phone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Phone size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#334155' }}>{customer.phone}</span>
                  </div>
                )}
                {customer.whatsapp && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MessageCircle size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#334155' }}>{customer.whatsapp}</span>
                  </div>
                )}
                {customer.company && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Building2 size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#334155' }}>{customer.company}</span>
                  </div>
                )}
                {(customer.city || customer.state) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MapPin size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#334155' }}>
                      {[customer.address_line1, customer.city, customer.state, customer.zip, customer.country].filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
                {customer.website && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ExternalLink size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <a
                      href={customer.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, color: '#2563EB', textDecoration: 'underline' }}
                    >
                      {customer.website}
                    </a>
                  </div>
                )}
                {customer.facebook_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#94A3B8', flexShrink: 0, fontWeight: 600 }}>FB</span>
                    <span style={{ fontSize: 13, color: '#334155' }}>{customer.facebook_id}</span>
                  </div>
                )}
                {customer.instagram_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#94A3B8', flexShrink: 0, fontWeight: 600 }}>IG</span>
                    <span style={{ fontSize: 13, color: '#334155' }}>{customer.instagram_id}</span>
                  </div>
                )}
                {customer.source && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#94A3B8', flexShrink: 0, fontWeight: 600 }}>SRC</span>
                    <span style={{ fontSize: 13, color: '#0D9488', fontWeight: 500 }}>{customer.source}</span>
                  </div>
                )}
                {customer.buyer_type && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#334155' }}>{customer.buyer_type}</span>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Contact */}
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '4px 0 0' }}>Contact Info</p>
                <div className="al-field">
                  <label>Full Name <span className="al-req">*</span></label>
                  <input className="al-input" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
                </div>
                <div className="al-field">
                  <label>Company / Business Name</label>
                  <input className="al-input" value={company} onChange={e => setCompany(e.target.value)} placeholder="Company name" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="al-field">
                    <label>Email Address</label>
                    <input type="email" className="al-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
                  </div>
                  <div className="al-field">
                    <label>Phone Number</label>
                    <input type="tel" className="al-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
                  </div>
                </div>
                <div className="al-field">
                  <label>WhatsApp</label>
                  <input type="tel" className="al-input" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+1 (555) 000-0000" />
                </div>

                {/* Online presence */}
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0 0' }}>Online Presence</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="al-field">
                    <label>Website</label>
                    <input type="url" className="al-input" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://example.com" />
                  </div>
                  <div className="al-field">
                    <label>Facebook ID</label>
                    <input className="al-input" value={facebookId} onChange={e => setFacebookId(e.target.value)} placeholder="facebook.com/username" />
                  </div>
                </div>
                <div className="al-field">
                  <label>Instagram ID</label>
                  <input className="al-input" value={instagramId} onChange={e => setInstagramId(e.target.value)} placeholder="@handle" />
                </div>

                {/* Address */}
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0 0' }}>Address</p>
                <div className="al-field">
                  <label>Address Line 1</label>
                  <input className="al-input" value={addrLine1} onChange={e => setAddrLine1(e.target.value)} placeholder="Street address" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div className="al-field">
                    <label>City</label>
                    <input className="al-input" value={city} onChange={e => setCity(e.target.value)} placeholder="City" />
                  </div>
                  <div className="al-field">
                    <label>State</label>
                    <select className="al-input" value={stateVal} onChange={e => setStateVal(e.target.value)}>
                      <option value="">-- State --</option>
                      {US_STATES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="al-field">
                    <label>ZIP</label>
                    <input className="al-input" value={zip} onChange={e => setZip(e.target.value)} placeholder="00000" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="al-field">
                    <label>Country</label>
                    <select className="al-input" value={country} onChange={e => setCountry(e.target.value)}>
                      {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="al-field">
                    <label>Status</label>
                    <select className="al-input" value={status} onChange={e => setStatus(e.target.value as 'Active' | 'Inactive' | 'Blocked')}>
                      <option>Active</option>
                      <option>Inactive</option>
                      <option>Blocked</option>
                    </select>
                  </div>
                </div>

                {/* Billing */}
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0 0' }}>Billing</p>
                <label className="ncust-check-opt">
                  <input type="checkbox" checked={sameAsBilling} onChange={e => setSameAsBilling(e.target.checked)} />
                  <span className="ncust-check-box" />
                  Same as Shipping Address
                </label>
                {!sameAsBilling && (
                  <div className="al-field">
                    <label>Billing Address</label>
                    <textarea
                      className="al-textarea"
                      rows={3}
                      value={billingAddress}
                      onChange={e => setBillingAddress(e.target.value)}
                      placeholder="Enter billing address..."
                    />
                  </div>
                )}

                {/* Classification */}
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0 0' }}>Classification</p>
                <div className="al-field">
                  <label>Source Channel</label>
                  <select className="al-input" value={source} onChange={e => setSource(e.target.value)}>
                    {['', 'Facebook Messenger', 'WhatsApp', 'Instagram', 'Email', 'Walk-in', 'Phone', 'Referral', 'Other'].map(s => (
                      <option key={s} value={s}>{s || '— Select source —'}</option>
                    ))}
                  </select>
                </div>
                <div className="al-field">
                  <label>Buyer Type</label>
                  <select className="al-input" value={buyerType} onChange={e => setBuyerType(e.target.value)}>
                    {BUYER_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Internal Notes */}
          <div className="al-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <FileText size={15} style={{ color: '#64748B' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Internal Notes</span>
            </div>
            {editing ? (
              <textarea
                className="al-textarea"
                rows={4}
                maxLength={500}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any special requirements, preferences, or notes about this customer..."
              />
            ) : (
              <p style={{ fontSize: 13, color: customer.notes ? '#334155' : '#94A3B8', lineHeight: 1.6, margin: 0 }}>
                {customer.notes ?? 'No notes added.'}
              </p>
            )}
          </div>

          {/* Billing address view */}
          {!editing && (
            <div className="al-panel" style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <FileCheck size={15} style={{ color: '#64748B' }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Billing Address</span>
              </div>
              {customer.same_as_billing ? (
                <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                  Same as shipping address — {[customer.address_line1, customer.city, customer.state, customer.zip, customer.country].filter(Boolean).join(', ') || 'No address on file'}
                </p>
              ) : (
                <p style={{ fontSize: 13, color: customer.billing_address ? '#334155' : '#94A3B8', lineHeight: 1.6, margin: 0 }}>
                  {customer.billing_address ?? 'No billing address on file.'}
                </p>
              )}
            </div>
          )}

          {/* Quotations list */}
          <div className="al-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={15} style={{ color: '#64748B' }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Quotations</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 999, background: '#F1F5F9', color: '#64748B' }}>
                  {quotes.length}
                </span>
              </div>
              <button
                className="lb-action-btn"
                style={{ fontSize: 12 }}
                onClick={() => navigate('/quotes/new', { state: { fromCustomerId: id } })}
              >
                New Quote <ExternalLink size={12} />
              </button>
            </div>
            {quotes.length === 0 ? (
              <p style={{ fontSize: 13, color: '#94A3B8', margin: 0 }}>No quotations yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 420, borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                      {['Quote #', 'Status', 'Total', 'Date'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#94A3B8', fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map(q => {
                      const sc = QUOTE_STATUS_COLORS[q.status] ?? { bg: '#F1F5F9', text: '#64748B' }
                      return (
                        <tr
                          key={q.id}
                          style={{ borderBottom: '1px solid #F8FAFC', cursor: 'pointer' }}
                          onClick={() => navigate(`/quotes/${q.id}`)}
                          onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                          onMouseLeave={e => (e.currentTarget.style.background = '')}
                        >
                          <td style={{ padding: '8px 8px', fontWeight: 600, color: '#2563EB' }}>{q.quote_number}</td>
                          <td style={{ padding: '8px 8px' }}>
                            <span style={{ background: sc.bg, color: sc.text, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                              {q.status}
                            </span>
                          </td>
                          <td style={{ padding: '8px 8px', fontWeight: 600 }}>{fmtCurr(q.total)}</td>
                          <td style={{ padding: '8px 8px', color: '#94A3B8' }}>{fmtDate(q.created_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

        {/* Right sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="al-panel" style={{ padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
              Account Summary
            </div>
            {[
              { label: 'Customer Since', value: fmtDate(customer.created_at) },
              { label: 'Total Quotes', value: String(customer.quotes_count ?? quotes.length) },
              { label: 'Source Channel', value: customer.source ?? customer.lead_source ?? 'Not set' },
              { label: 'Buyer Type', value: customer.buyer_type ?? 'Not set' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F1F5F9' }}>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{value}</span>
              </div>
            ))}
          </div>

          {customer.lead_id && (
            <div className="al-panel" style={{ padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                Lead Origin
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#64748B' }}>Lead ID</span>
                  <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: '#FEF9C3', color: '#92400E', border: '1px solid #FDE68A' }}>
                    {customer.lead_number ?? `#${customer.lead_id.slice(0, 8)}`}
                  </span>
                </div>
                {(customer.lead_source || customer.source) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#64748B' }}>Source Channel</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#0D9488' }}>
                      {customer.lead_source ?? customer.source}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="al-panel" style={{ padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>
              Quick Actions
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="lb-action-btn"
                style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
                onClick={() => navigate('/quotes/new', { state: { fromCustomerId: id } })}
              >
                <FileText size={13} /> New Quotation
              </button>
              <button
                className={cn('lb-action-btn', editing && 'lb-action-primary')}
                style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
                onClick={() => setEditing(true)}
              >
                <Edit2 size={13} /> Edit Customer
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

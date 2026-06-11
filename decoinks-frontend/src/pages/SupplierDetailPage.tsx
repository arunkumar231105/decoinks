import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '@mui/material'
import {
  ChevronRight, Edit2, Save, X, KeyRound,
  MapPin, Phone, Mail, Building2, FileText,
  ShoppingBag, DollarSign, Clock, ExternalLink,
} from 'lucide-react'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { cn } from '../utils/cn'
import PortalAccessModal from '../components/PortalAccessModal'

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'France', 'Mexico', 'Brazil', 'India', 'China', 'Japan']
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']

const AVATAR_COLORS = ['#0D9488','#2563EB','#7C3AED','#F59E0B','#EF4444','#10B981','#6366F1','#EC4899','#F97316','#0891B2','#16A34A','#9333EA']
function avatarColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

interface Supplier {
  id: string; name: string; email: string | null; phone: string | null
  company: string | null; address_line1: string | null; address_line2: string | null
  city: string | null; state: string | null; zip: string | null; country: string | null
  status: 'Active' | 'Inactive'; notes: string | null; created_at: string
  orders_count: number; total_spent: number
  website: string | null; facebook_id: string | null; instagram_id: string | null
}
interface Order {
  id: string; order_number: string; order_type: string; status: string
  payment_status: string; total: number; order_date: string
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Draft:        { bg: '#F1F5F9', text: '#64748B' },
  Confirmed:    { bg: '#DBEAFE', text: '#1D4ED8' },
  'In Production': { bg: '#FEF3C7', text: '#D97706' },
  'Ready to Ship': { bg: '#D1FAE5', text: '#059669' },
  Shipped:      { bg: '#EDE9FE', text: '#7C3AED' },
  Delivered:    { bg: '#D1FAE5', text: '#15803D' },
  Compleoed:    { bg: '#DCFCE7', text: '#16A34A' },
  Cancelled:    { bg: '#FEE2E2', text: '#DC2626' },
  'On Hold':    { bg: '#FEF9C3', text: '#CA8A04' },
}

export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [portalModal, setPortalModal] = useState(false)

  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [email,     setEmail]     = useState('')
  const [phone,     setPhone]     = useState('')
  const [company,   setCompany]   = useState('')
  const [addrLine1, setAddrLine1] = useState('')
  const [addrLine2, setAddrLine2] = useState('')
  const [city,      setCity]      = useState('')
  const [stateVal,  setStateVal]  = useState('')
  const [zip,       setZip]       = useState('')
  const [country,   setCountry]   = useState('United States')
  const [notes,       setNotes]       = useState('')
  const [status,      setStatus]      = useState<'Active' | 'Inactive'>('Active')
  const [website,     setWebsite]     = useState('')
  const [facebookId,  setFacebookId]  = useState('')
  const [instagramId, setInstagramId] = useState('')

  const { data: supplierData, isLoading: supplierLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api.get(`/suppliers/${id}`).then(r => r.data.data as Supplier),
    enabled: !!id,
  })
  const supplier = supplierData

  const { data: ordersData } = useQuery({
    queryKey: ['supplier-orders', id],
    queryFn: () => api.get(`/suppliers/${id}/orders`, { params: { page: 1, limit: 5 } }).then(r => r.data.data),
    enabled: !!id,
  })
  const orders: Order[] = ordersData?.rows ?? []

  const { data: portalData } = useQuery({
    queryKey: ['portal-access', id],
    queryFn: () => api.get(`/suppliers/${id}/portal-access`).then(r => r.data),
    enabled: !!id,
  })
  const portalAccess = portalData?.portalAccess ?? null

  useEffect(() => {
    if (!supplier) return
    const parts = supplier.name.split(' ')
    setFirstName(parts[0] ?? '')
    setLastName(parts.slice(1).join(' ') ?? '')
    setEmail(supplier.email ?? '')
    setPhone(supplier.phone ?? '')
    setCompany(supplier.company ?? '')
    setAddrLine1(supplier.address_line1 ?? '')
    setAddrLine2(supplier.address_line2 ?? '')
    setCity(supplier.city ?? '')
    setStateVal(supplier.state ?? '')
    setZip(supplier.zip ?? '')
    setCountry(supplier.country ?? 'United States')
    setNotes(supplier.notes ?? '')
    setStatus(supplier.status)
    setWebsite(supplier.website ?? '')
    setFacebookId(supplier.facebook_id ?? '')
    setInstagramId(supplier.instagram_id ?? '')
  }, [supplier])

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.put(`/suppliers/${id}`, payload),
    onSuccess: () => {
      toast.success('Supplier updated')
      qc.invalidateQueries({ queryKey: ['supplier', id] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setEditing(false)
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e?.response?.data?.error ?? 'Failed to update supplier'),
  })

  const handleSave = () => {
    if (!firstName.trim()) return toast.error('First Name is required')
    updateMutation.mutate({
      name: `${firstName.trim()} ${lastName.trim()}`.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      company: company.trim() || null,
      address_line1: addrLine1.trim() || null,
      address_line2: addrLine2.trim() || null,
      city: city.trim() || null,
      state: stateVal || null,
      zip: zip.trim() || null,
      country: country || null,
      notes: notes.trim() || null,
      status,
      website: website.trim() || null,
      facebook_id: facebookId.trim() || null,
      instagram_id: instagramId.trim() || null,
    })
  }

  const handleCancel = () => {
    if (!supplier) return
    const parts = supplier.name.split(' ')
    setFirstName(parts[0] ?? '')
    setLastName(parts.slice(1).join(' ') ?? '')
    setEmail(supplier.email ?? '')
    setPhone(supplier.phone ?? '')
    setCompany(supplier.company ?? '')
    setAddrLine1(supplier.address_line1 ?? '')
    setAddrLine2(supplier.address_line2 ?? '')
    setCity(supplier.city ?? '')
    setStateVal(supplier.state ?? '')
    setZip(supplier.zip ?? '')
    setCountry(supplier.country ?? 'United States')
    setNotes(supplier.notes ?? '')
    setStatus(supplier.status)
    setWebsite(supplier.website ?? '')
    setFacebookId(supplier.facebook_id ?? '')
    setInstagramId(supplier.instagram_id ?? '')
    setEditing(false)
  }

  if (supplierLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <span style={{ color: '#94A3B8', fontSize: 14 }}>Loading...</span>
      </div>
    )
  }

  if (!supplier) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <span style={{ color: '#94A3B8', fontSize: 14 }}>Supplier not found.</span>
      </div>
    )
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtCurr = (v: number) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div className="ns-breadcrumb" style={{ marginBottom: 6 }}>
            <span style={{ cursor: 'pointer', color: '#64748B' }} onClick={() => navigate('/suppliers')}>Suppliers</span>
            <ChevronRight size={13} style={{ color: '#CBD5E1' }} />
            <strong style={{ color: '#0F172A' }}>{supplier.name}</strong>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>Supplier Profile</h2>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>Review and edit account details.</p>
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
              <button className="lb-action-btn" onClick={() => setPortalModal(true)}>
                <KeyRound size={14} />
                {portalAccess ? 'Manage Portal' : 'Enable Portal'}
              </button>
              <button className="lb-action-btn lb-action-primary" onClick={() => setEditing(true)}>
                <Edit2 size={14} /> Edit Supplier
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="al-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <Avatar sx={{ width: 56, height: 56, fontSize: 20, bgcolor: avatarColor(supplier.id) }}>
                {initials(supplier.name)}
              </Avatar>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>{supplier.name}</div>
                {supplier.company && <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>{supplier.company}</div>}
                <span style={{
                  display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 600,
                  padding: '2px 10px', borderRadius: 999,
                  background: supplier.status === 'Active' ? '#DCFCE7' : '#FEE2E2',
                  color: supplier.status === 'Active' ? '#16A34A' : '#DC2626',
                }}>
                  {supplier.status}
                </span>
              </div>
            </div>

            {!editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {supplier.email && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Mail size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#334155' }}>{supplier.email}</span>
                  </div>
                )}
                {supplier.phone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Phone size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#334155' }}>{supplier.phone}</span>
                  </div>
                )}
                {supplier.company && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Building2 size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#334155' }}>{supplier.company}</span>
                  </div>
                )}
                {(supplier.city || supplier.state) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MapPin size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#334155' }}>
                      {[supplier.address_line1, supplier.city, supplier.state, supplier.zip, supplier.country]
                        .filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
                {supplier.website && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ExternalLink size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                    <a
                      href={supplier.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, color: '#2563EB', textDecoration: 'underline' }}
                    >
                      {supplier.website}
                    </a>
                  </div>
                )}
                {supplier.facebook_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0, fontWeight: 600 }}>FB</span>
                    <span style={{ fontSize: 13, color: '#334155' }}>{supplier.facebook_id}</span>
                  </div>
                )}
                {supplier.instagram_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0, fontWeight: 600 }}>IG</span>
                    <span style={{ fontSize: 13, color: '#334155' }}>{supplier.instagram_id}</span>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="al-field">
                    <label>First Name <span className="al-req">*</span></label>
                    <input className="al-input" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First Name" />
                  </div>
                  <div className="al-field">
                    <label>Last Name</label>
                    <input className="al-input" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last Name" />
                  </div>
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
                  <label>Address Line 1</label>
                  <input className="al-input" value={addrLine1} onChange={e => setAddrLine1(e.target.value)} placeholder="Street address" />
                </div>
                <div className="al-field">
                  <label>Address Line 2</label>
                  <input className="al-input" value={addrLine2} onChange={e => setAddrLine2(e.target.value)} placeholder="Apt, suite, unit..." />
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
                    <select className="al-input" value={status} onChange={e => setStatus(e.target.value as 'Active' | 'Inactive')}>
                      <option>Active</option>
                      <option>Inactive</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="al-field">
                    <label>Website</label>
                    <input
                      type="url"
                      className="al-input"
                      value={website}
                      onChange={e => setWebsite(e.target.value)}
                      placeholder="https://example.com"
                    />
                  </div>
                  <div className="al-field">
                    <label>Facebook</label>
                    <input
                      className="al-input"
                      value={facebookId}
                      onChange={e => setFacebookId(e.target.value)}
                      placeholder="facebook.com/username or Page ID"
                    />
                  </div>
                </div>
                <div className="al-field">
                  <label>Instagram</label>
                  <input
                    className="al-input"
                    value={instagramId}
                    onChange={e => setInstagramId(e.target.value)}
                    placeholder="@handle or instagram.com/username"
                  />
                </div>
              </div>
            )}
          </div>

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
                placeholder="Any special requirements, preferences, or notes about this supplier..."
              />
            ) : (
              <p style={{ fontSize: 13, color: supplier.notes ? '#334155' : '#94A3B8', lineHeight: 1.6, margin: 0 }}>
                {supplier.notes ?? 'No notes added.'}
              </p>
            )}
          </div>

          <div className="al-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShoppingBag size={15} style={{ color: '#64748B' }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Receno Orders</span>
              </div>
              <button
                className="lb-action-btn"
                style={{ fontSize: 12 }}
                onClick={() => navigate(`/orders?supplier=${id}`)}
              >
                View All <ExternalLink size={12} />
              </button>
            </div>
            {orders.length === 0 ? (
              <p style={{ fontSize: 13, color: '#94A3B8', margin: 0 }}>No orders yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                    {['Order #', 'Type', 'Status', 'Total', 'Date'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#94A3B8', fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => {
                    const sc = STATUS_COLORS[o.status] ?? { bg: '#F1F5F9', text: '#64748B' }
                    return (
                      <tr
                        key={o.id}
                        style={{ borderBottom: '1px solid #F8FAFC', cursor: 'pointer' }}
                        onClick={() => navigate(`/orders/${o.id}`)}
                        onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <td style={{ padding: '8px 8px', fontWeight: 600, color: '#2563EB' }}>{o.order_number}</td>
                        <td style={{ padding: '8px 8px', color: '#64748B' }}>{o.order_type}</td>
                        <td style={{ padding: '8px 8px' }}>
                          <span style={{ background: sc.bg, color: sc.text, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                            {o.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 8px', fontWeight: 600 }}>{fmtCurr(o.total)}</td>
                        <td style={{ padding: '8px 8px', color: '#94A3B8' }}>{fmtDate(o.order_date)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="al-panel" style={{ padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
              Account Summary
            </div>
            {[
              { icon: <ShoppingBag size={15} />, label: 'Total Orders', value: String(supplier.orders_count ?? 0) },
              { icon: <DollarSign size={15} />, label: 'Total Spent', value: fmtCurr(supplier.total_spent ?? 0) },
              { icon: <Clock size={15} />, label: 'Supplier Since', value: fmtDate(supplier.created_at) },
            ].map(({ icon, label, value }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>
                  {icon}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{value}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="al-panel" style={{ padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>
              Portal Access
            </div>
            {portalAccess ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: portalAccess.is_active ? '#16A34A' : '#DC2626' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: portalAccess.is_active ? '#16A34A' : '#DC2626' }}>
                    {portalAccess.is_active ? 'Active' : 'Disabled'}
                  </span>
                </div>
                {[
                  { label: 'Username', value: portalAccess.username },
                  { label: 'Last Login', value: portalAccess.last_login ? fmtDate(portalAccess.last_login) : 'Never' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
                    <span style={{ color: '#94A3B8' }}>{label}</span>
                    <span style={{ color: '#334155', fontWeight: 500 }}>{value}</span>
                  </div>
                ))}
                {portalAccess.must_change_pw && (
                  <p style={{ fontSize: 11, color: '#D97706', background: '#FEF3C7', padding: '6px 10px', borderRadius: 6, marginTop: 8 }}>
                    Password change required on next login
                  </p>
                )}
                <button
                  className="lb-action-btn"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 12, fontSize: 12 }}
                  onClick={() => setPortalModal(true)}
                >
                  <KeyRound size={13} /> Manage Portal Access
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <p style={{ fontSize: 13, color: '#94A3B8', marginBottom: 12 }}>No portal access yeo.</p>
                <button
                  className="lb-action-btn lb-action-primary"
                  style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
                  onClick={() => setPortalModal(true)}
                >
                  <KeyRound size={13} /> Enable Portal Access
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {portalModal && (
        <PortalAccessModal
          supplierId={supplier.id}
          supplierName={supplier.name}
          onClose={() => {
            setPortalModal(false)
            qc.invalidateQueries({ queryKey: ['portal-access', id] })
            qc.invalidateQueries({ queryKey: ['suppliers'] })
          }}
        />
      )}
    </div>
  )
}







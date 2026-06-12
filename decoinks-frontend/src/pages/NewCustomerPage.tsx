import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, User } from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'France', 'Mexico', 'Brazil', 'India', 'China', 'Japan']
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']
const BUYER_TYPES = ['Retail', 'Wholesale', 'Corporate', 'Non-Profit', 'Individual', 'Other']

export function NewCustomerPage() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)

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
  const [sameAsBilling,    setSameAsBilling]    = useState(true)
  const [billingAddress,   setBillingAddress]   = useState('')

  // Section 4 — Classification
  const [buyerType, setBuyerType] = useState(BUYER_TYPES[0])
  const [notes,     setNotes]     = useState('')

  const handleSave = async () => {
    if (!firstName.trim()) { toast.error('First name is required'); return }
    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
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
        same_as_billing: sameAsBilling,
        billing_address: sameAsBilling ? undefined : (billingAddress.trim() || undefined),
        buyer_type: buyerType,
        notes: notes.trim() || undefined,
      }
      const res = await api.post('/customers', payload)
      const newId: string = res.data.data?.id ?? res.data.id
      toast.success('Customer created')
      navigate(`/customers/${newId}`)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string } } }
      toast.error(e.response?.data?.message ?? e.response?.data?.error ?? 'Failed to save customer')
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
              <div className="al-field">
                <label>Buyer Type</label>
                <select className="al-input" value={buyerType} onChange={(e) => setBuyerType(e.target.value)}>
                  {BUYER_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
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
                <label className="ncust-check-opt" style={{ marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={sameAsBilling}
                    onChange={(e) => setSameAsBilling(e.target.checked)}
                  />
                  <span className="ncust-check-box" />
                  Same as Shipping Address
                </label>
                <div className="al-field">
                  <label>Billing Address</label>
                  <textarea
                    className="al-textarea"
                    rows={3}
                    disabled={sameAsBilling}
                    value={sameAsBilling ? [addrLine1, city, stateVal, zip, country].filter(Boolean).join(', ') : billingAddress}
                    onChange={(e) => setBillingAddress(e.target.value)}
                    placeholder="Enter billing address..."
                    style={sameAsBilling ? { opacity: 0.5, cursor: 'not-allowed', resize: 'none' } : {}}
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

import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, UserRound, MapPin } from 'lucide-react'
import { Country, State } from 'country-state-city'
import { api } from '../services/api'
import toast from '../utils/toast'

const SEGMENTS = ['retail', 'reseller', 'corporate', 'non-profit', 'individual']
const TIERS = ['Standard', 'Silver', 'Gold', 'Platinum']

// ── Country / State data (all 250 countries + their states) ──────────────────
const COUNTRIES = Country.getAllCountries()
const COUNTRY_NAMES = COUNTRIES.map(c => c.name)
// Map legacy/short country values onto the canonical dropdown names so old
// records still show a selected country instead of a blank field.
const COUNTRY_ALIASES: Record<string, string> = {
  USA: 'United States', US: 'United States', 'U.S.A.': 'United States', 'U.S.': 'United States',
  UK: 'United Kingdom', UAE: 'United Arab Emirates',
}
const resolveCountry = (v?: string | null) => (v ? COUNTRY_ALIASES[v] ?? v : '')
const isoForCountry = (name: string) => COUNTRIES.find(c => c.name === name)?.isoCode ?? ''
// Resolve a stored state (full name OR code) to its short code (e.g. "New
// York" / "NY" → "NY"). Unknown values pass through unchanged.
const stateCodeFor = (countryName: string, val?: string | null) => {
  if (!val) return ''
  const list = State.getStatesOfCountry(isoForCountry(countryName))
  const hit = list.find(s => s.isoCode === val || s.name.toLowerCase() === val.toLowerCase())
  return hit ? hit.isoCode : val
}

// ── Validation ──────────────────────────────────────────────────────────────
// Strict rules, but only First Name is required. Every other field is optional
// and is validated *only when the user has entered something* — an empty
// optional field never blocks the save, so nothing in the data flow breaks.
const RE_NAME = /^[A-Za-z\s'.-]+$/          // letters, spaces, . - '
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RE_ZIP = /^[A-Za-z0-9][A-Za-z0-9\s-]{1,11}$/   // 2–12 chars: US ZIP, ZIP+4 and international postcodes
const RE_PHONE = /^[\d\s()+-]+$/            // digits + common formatting chars

function validateCustomer(form: typeof EMPTY_FORM, sameAsShipping: boolean) {
  const errs: Record<string, string> = {}
  const val = (k: keyof typeof form) => (form[k] ?? '').trim()

  // First Name — the only required field
  const fn = val('first_name')
  if (!fn) errs.first_name = 'First name is required'
  else if (!RE_NAME.test(fn) || fn.length > 50) errs.first_name = 'Letters only, max 50 characters'

  // Name-like fields: letters only, max 50 (validated only when filled)
  const nameCheck = (k: keyof typeof form, label: string) => {
    const v = val(k); if (!v) return
    if (!RE_NAME.test(v) || v.length > 50) errs[k] = `${label} must be letters only (max 50)`
  }
  nameCheck('last_name', 'Last name')
  // City/State are international (accents, punctuation, dropdown-selected state)
  // so we only cap length rather than restricting characters.
  const cityStateCheck = (k: keyof typeof form, label: string) => {
    const v = val(k); if (v && v.length > 100) errs[k] = `${label} is too long (max 100)`
  }
  cityStateCheck('shipping_city', 'City'); cityStateCheck('shipping_state', 'State')
  if (!sameAsShipping) { cityStateCheck('billing_city', 'City'); cityStateCheck('billing_state', 'State') }

  // Company Name — 2–100 chars
  const cn = val('company_name')
  if (cn && (cn.length < 2 || cn.length > 100)) errs.company_name = 'Company name must be 2–100 characters'

  // Email — valid format
  const em = val('email')
  if (em && !RE_EMAIL.test(em)) errs.email = 'Enter a valid email address'

  // Phones — optional; if filled, allow formatting chars and require 7–15 digits
  const phoneCheck = (k: keyof typeof form) => {
    const v = val(k); if (!v) return
    const digits = v.replace(/\D/g, '')
    if (!RE_PHONE.test(v) || digits.length < 7 || digits.length > 15)
      errs[k] = 'Enter a valid phone number (7–15 digits)'
  }
  phoneCheck('company_phone_number'); phoneCheck('mobile_number'); phoneCheck('whatsapp_number')

  // ZIP — 3–10 chars, alphanumeric + hyphen/space
  const zipCheck = (k: keyof typeof form) => {
    const v = val(k); if (!v) return
    if (!RE_ZIP.test(v)) errs[k] = 'Enter a valid ZIP / postal code'
  }
  zipCheck('shipping_zipcode'); if (!sameAsShipping) zipCheck('billing_zipcode')

  // Address lines — max 100 chars
  const lenCheck = (k: keyof typeof form) => {
    const v = val(k); if (v && v.length > 100) errs[k] = 'Address is too long (max 100 characters)'
  }
  lenCheck('shipping_line1'); lenCheck('shipping_line2')
  if (!sameAsShipping) { lenCheck('billing_line1'); lenCheck('billing_line2') }

  return errs
}

const EMPTY_FORM = {
  first_name: '', last_name: '', company_name: '', email: '',
  company_phone_number: '', whatsapp_number: '', mobile_number: '',
  preferred_language: 'en', customer_segment: 'retail', tier: 'Standard',
  shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '',
  shipping_zipcode: '', shipping_country: 'United States',
  billing_line1: '', billing_line2: '', billing_city: '', billing_state: '',
  billing_zipcode: '', billing_country: 'United States',
}

interface CustomerAddress {
  address_type: string; line1?: string | null; line2?: string | null
  city?: string | null; state?: string | null; zipcode?: string | null; country?: string | null
}

export function NewCustomerPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const [saving, setSaving] = useState(false)
  const [sameAsShipping, setSameAsShipping] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (key: keyof typeof form, value: string) => {
    setForm(v => ({ ...v, [key]: value }))
    // Clear the field's error as soon as the user edits it.
    setErrors(e => {
      if (!e[key]) return e
      const next = { ...e }; delete next[key]; return next
    })
  }

  // ── Edit mode: load the existing customer and pre-fill the same form ──
  const qc = useQueryClient()
  const { data: existing } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get(`/customers/${id}`).then(r => r.data.data),
    enabled: isEdit,
  })

  useEffect(() => {
    if (!existing) return
    const addrs: CustomerAddress[] = existing.addresses ?? []
    const ship = addrs.find(a => a.address_type === 'shipping')
    const bill = addrs.find(a => a.address_type === 'billing')
    const shipCountry = resolveCountry(ship?.country ?? existing.country) || 'United States'
    const billCountry = resolveCountry(bill?.country) || 'United States'
    setForm({
      first_name: existing.first_name ?? (existing.name?.split(' ')[0] ?? ''),
      last_name: existing.last_name ?? (existing.name?.split(' ').slice(1).join(' ') ?? ''),
      company_name: existing.company_name ?? existing.company ?? '',
      email: existing.email ?? '',
      company_phone_number: existing.company_phone_number ?? existing.phone ?? '',
      whatsapp_number: existing.whatsapp ?? '',
      mobile_number: existing.mobile_number ?? '',
      preferred_language: existing.preferred_language ?? 'en',
      customer_segment: existing.customer_segment ?? existing.buyer_type ?? 'retail',
      tier: existing.tier ?? 'Standard',
      shipping_line1: ship?.line1 ?? existing.address_line1 ?? '',
      shipping_line2: ship?.line2 ?? '',
      shipping_city: ship?.city ?? existing.city ?? '',
      shipping_state: stateCodeFor(shipCountry, ship?.state ?? existing.state),
      shipping_zipcode: ship?.zipcode ?? existing.zip ?? '',
      shipping_country: shipCountry,
      billing_line1: bill?.line1 ?? '',
      billing_line2: bill?.line2 ?? '',
      billing_city: bill?.city ?? '',
      billing_state: stateCodeFor(billCountry, bill?.state),
      billing_zipcode: bill?.zipcode ?? '',
      billing_country: billCountry,
    })
    setSameAsShipping(!!existing.same_as_shipping)
  }, [existing])

  const save = async () => {
    const errs = validateCustomer(form, sameAsShipping)
    if (Object.keys(errs).length) {
      setErrors(errs)
      return toast.error('Please fix the highlighted fields')
    }
    setErrors({})
    setSaving(true)
    try {
      // When "Same as Shipping" is ticked, billing mirrors the shipping address.
      const billing = sameAsShipping
        ? { line1: form.shipping_line1, line2: form.shipping_line2, city: form.shipping_city,
            state: form.shipping_state, zipcode: form.shipping_zipcode, country: form.shipping_country }
        : { line1: form.billing_line1, line2: form.billing_line2, city: form.billing_city,
            state: form.billing_state, zipcode: form.billing_zipcode, country: form.billing_country }
      const addresses = [
        { address_type: 'shipping', line1: form.shipping_line1, line2: form.shipping_line2,
          city: form.shipping_city, state: form.shipping_state, zipcode: form.shipping_zipcode,
          country: form.shipping_country, is_default: true },
        { address_type: 'billing', ...billing, is_default: true },
      ].filter(a => a.line1 || a.city || a.state || a.zipcode)
      const payload = {
        name: [form.first_name, form.last_name].filter(Boolean).join(' '),
        first_name: form.first_name, last_name: form.last_name || null,
        company_name: form.company_name || null, email: form.email || null,
        company_phone_number: form.company_phone_number || null,
        phone: form.company_phone_number || null, whatsapp: form.whatsapp_number || null,
        mobile_number: form.mobile_number || null, preferred_language: form.preferred_language,
        customer_segment: form.customer_segment, tier: form.tier,
        same_as_shipping: sameAsShipping, addresses,
      }
      if (isEdit) {
        await api.put(`/customers/${id}`, payload)
        qc.invalidateQueries({ queryKey: ['customers'] })
        qc.invalidateQueries({ queryKey: ['customer', id] })
        qc.invalidateQueries({ queryKey: ['customer-details', id] })
        toast.success('Customer updated')
        navigate(`/customers/${id}`)
      } else {
        const res = await api.post('/customers', payload)
        qc.invalidateQueries({ queryKey: ['customers'] })
        toast.success('Customer created')
        navigate(`/customers/${res.data.data?.id ?? res.data.id}`)
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? `Failed to ${isEdit ? 'update' : 'create'} customer`)
    } finally { setSaving(false) }
  }

  const field = (label: string, key: keyof typeof form, type = 'text', maxLength?: number, numeric = false) => (
    <div className="al-field"><label>{label}</label>
      <input className="al-input" type={type} maxLength={maxLength} inputMode={numeric ? 'numeric' : undefined}
        value={form[key]} onChange={e => set(key, numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
        aria-invalid={!!errors[key]} style={errors[key] ? { borderColor: '#dc2626' } : undefined} />
      {errors[key] && <span style={{ color: '#dc2626', fontSize: 12, marginTop: 4, display: 'block' }}>{errors[key]}</span>}
    </div>
  )

  // Billing field: when "Same as Shipping" is on, it shows the shipping value
  // (read-only) so the user sees exactly what will be saved.
  const billingField = (label: string, key: keyof typeof form, maxLength?: number, numeric = false) => {
    const shipKey = key.replace('billing_', 'shipping_') as keyof typeof form
    const value = sameAsShipping ? form[shipKey] : form[key]
    return <div className="al-field"><label>{label}</label>
      <input className="al-input" value={value} disabled={sameAsShipping} maxLength={maxLength}
        inputMode={numeric ? 'numeric' : undefined}
        onChange={e => set(key, numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
        aria-invalid={!sameAsShipping && !!errors[key]}
        style={sameAsShipping ? { background: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' }
          : errors[key] ? { borderColor: '#dc2626' } : undefined} />
      {!sameAsShipping && errors[key] && <span style={{ color: '#dc2626', fontSize: 12, marginTop: 4, display: 'block' }}>{errors[key]}</span>}
    </div>
  }

  const mutedStyle = { background: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' } as const

  // Country dropdown (all countries). Billing mirrors shipping when "Same as
  // Shipping" is on. Changing the country resets that block's state field.
  const countrySelect = (key: 'shipping_country' | 'billing_country') => {
    const mirror = key.startsWith('billing_') && sameAsShipping
    const value = mirror ? form[key.replace('billing_', 'shipping_') as keyof typeof form] : form[key]
    const stateKey = key.replace('country', 'state') as keyof typeof form
    // Keep an unrecognised legacy value visible as its own option.
    const options = value && !COUNTRY_NAMES.includes(value) ? [value, ...COUNTRY_NAMES] : COUNTRY_NAMES
    return <div className="al-field"><label>Country</label>
      <select className="al-input" value={value} disabled={mirror}
        onChange={e => { set(key, e.target.value); set(stateKey, '') }}
        style={mirror ? mutedStyle : undefined}>
        {options.map(c => <option key={c} value={c}>{c}</option>)}
      </select></div>
  }

  // State dropdown for the chosen country; falls back to free text when the
  // country has no predefined states, so every country still works.
  const stateSelect = (key: 'shipping_state' | 'billing_state') => {
    const mirror = key.startsWith('billing_') && sameAsShipping
    const shipKey = key.replace('billing_', 'shipping_') as keyof typeof form
    const countryKey = key.replace('state', 'country') as keyof typeof form
    const shipCountryKey = countryKey.replace('billing_', 'shipping_') as keyof typeof form
    const value = mirror ? form[shipKey] : form[key]
    const countryVal = mirror ? form[shipCountryKey] : form[countryKey]
    const states = State.getStatesOfCountry(isoForCountry(countryVal)) // [{ isoCode, name }]
    if (!states.length) {
      return <div className="al-field"><label>State</label>
        <input className="al-input" value={value} disabled={mirror} onChange={e => set(key, e.target.value)}
          aria-invalid={!mirror && !!errors[key]}
          style={mirror ? mutedStyle : errors[key] ? { borderColor: '#dc2626' } : undefined} />
        {!mirror && errors[key] && <span style={{ color: '#dc2626', fontSize: 12, marginTop: 4, display: 'block' }}>{errors[key]}</span>}
      </div>
    }
    // Store the short code (e.g. "NY"); keep an unrecognised legacy value visible.
    const options = value && !states.some(s => s.isoCode === value)
      ? [{ isoCode: value, name: value }, ...states] : states
    return <div className="al-field"><label>State</label>
      <select className="al-input" value={value} disabled={mirror} onChange={e => set(key, e.target.value)}
        style={mirror ? mutedStyle : undefined}>
        <option value="">Select state…</option>
        {options.map(s => <option key={s.isoCode} value={s.isoCode}>{s.isoCode} — {s.name}</option>)}
      </select></div>
  }

  const segmentOptions = Array.from(new Set([...SEGMENTS, form.customer_segment].filter(Boolean)))
  const tierOptions = Array.from(new Set([...TIERS, form.tier].filter(Boolean)))
  const title = isEdit ? 'Edit Customer' : 'New Customer'

  return <div className="ncust-page">
    <div className="ncust-header"><div><div className="ns-breadcrumb"><span onClick={() => navigate('/customers')}>Customers</span><ChevronRight size={13}/><strong>{title}</strong></div><h2 className="ns-page-title">{title}</h2></div>
      <div className="ns-header-actions"><button className="lb-action-btn" onClick={() => isEdit ? navigate(`/customers/${id}`) : navigate(-1)}>Cancel</button><button className="lb-action-btn lb-action-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Customer'}</button></div></div>
    <div className="ncust-grid">
      <div className="ncust-col">
        <section className="al-panel al-section"><div className="al-section-header"><UserRound size={16}/><h4>Customer Profile</h4></div><div className="ncust-section-body">
          <div className="al-field-row">{field('First Name *','first_name')}{field('Last Name','last_name')}</div>
          {field('Company Name','company_name')}{field('Email Address','email','email')}
          <div className="al-field-row">{field('Company Phone','company_phone_number','tel')}{field('Mobile Number','mobile_number','tel')}</div>
          {field('WhatsApp Number','whatsapp_number','tel')}
          <div className="al-field-row"><div className="al-field"><label>Preferred Language</label><select className="al-input" value={form.preferred_language} onChange={e=>set('preferred_language',e.target.value)}><option value="en">English</option><option value="es">Spanish</option></select></div>
          <div className="al-field"><label>Customer Segment</label><select className="al-input" value={form.customer_segment} onChange={e=>set('customer_segment',e.target.value)}>{segmentOptions.map(x=><option key={x}>{x}</option>)}</select></div></div>
          <div className="al-field"><label>Loyalty Tier</label><select className="al-input" value={form.tier} onChange={e=>set('tier',e.target.value)}>{tierOptions.map(x=><option key={x}>{x}</option>)}</select></div>
        </div></section>
      </div>
      <div className="ncust-col"><section className="al-panel al-section"><div className="al-section-header"><MapPin size={16}/><h4>Addresses</h4></div><div className="ncust-section-body">
        <h5>Shipping Address</h5>{field('Address Line 1','shipping_line1')}{field('Address Line 2','shipping_line2')}<div className="al-field-row">{field('City','shipping_city')}{stateSelect('shipping_state')}</div><div className="al-field-row">{field('ZIP Code','shipping_zipcode','text',12,false)}{countrySelect('shipping_country')}</div>
        <h5 style={{marginTop:20}}>Billing Address</h5>
        <label className="ncust-check-opt" style={{ margin: '4px 0 12px' }}>
          <input type="checkbox" checked={sameAsShipping} onChange={e => setSameAsShipping(e.target.checked)} />
          <span className="ncust-check-box" />
          Same as Shipping Address
        </label>
        {billingField('Address Line 1','billing_line1')}{billingField('Address Line 2','billing_line2')}<div className="al-field-row">{billingField('City','billing_city')}{stateSelect('billing_state')}</div><div className="al-field-row">{billingField('ZIP Code','billing_zipcode',12,false)}{countrySelect('billing_country')}</div>
      </div></section></div>
    </div>
  </div>
}

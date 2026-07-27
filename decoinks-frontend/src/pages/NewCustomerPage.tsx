import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, UserRound, MapPin } from 'lucide-react'
import { api } from '../services/api'
import toast from '../utils/toast'

const SEGMENTS = ['retail', 'reseller', 'corporate', 'non-profit', 'individual']
const TIERS = ['Standard', 'Silver', 'Gold', 'Platinum']

const EMPTY_FORM = {
  first_name: '', last_name: '', company_name: '', email: '',
  company_phone_number: '', whatsapp_number: '', mobile_number: '',
  preferred_language: 'en', customer_segment: 'retail', tier: 'Standard',
  shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '',
  shipping_zipcode: '', shipping_country: 'USA',
  billing_line1: '', billing_line2: '', billing_city: '', billing_state: '',
  billing_zipcode: '', billing_country: 'USA',
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
  const set = (key: keyof typeof form, value: string) => setForm(v => ({ ...v, [key]: value }))

  // ── Edit mode: load the existing customer and pre-fill the same form ──
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
      shipping_state: ship?.state ?? existing.state ?? '',
      shipping_zipcode: ship?.zipcode ?? existing.zip ?? '',
      shipping_country: ship?.country ?? existing.country ?? 'USA',
      billing_line1: bill?.line1 ?? '',
      billing_line2: bill?.line2 ?? '',
      billing_city: bill?.city ?? '',
      billing_state: bill?.state ?? '',
      billing_zipcode: bill?.zipcode ?? '',
      billing_country: bill?.country ?? 'USA',
    })
    setSameAsShipping(!!existing.same_as_shipping)
  }, [existing])

  const save = async () => {
    if (!form.first_name.trim()) return toast.error('First name is required')
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
        toast.success('Customer updated')
        navigate(`/customers/${id}`)
      } else {
        const res = await api.post('/customers', payload)
        toast.success('Customer created')
        navigate(`/customers/${res.data.data?.id ?? res.data.id}`)
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? `Failed to ${isEdit ? 'update' : 'create'} customer`)
    } finally { setSaving(false) }
  }

  const field = (label: string, key: keyof typeof form, type = 'text') => (
    <div className="al-field"><label>{label}</label><input className="al-input" type={type} value={form[key]} onChange={e => set(key, e.target.value)} /></div>
  )

  // Billing field: when "Same as Shipping" is on, it shows the shipping value
  // (read-only) so the user sees exactly what will be saved.
  const billingField = (label: string, key: keyof typeof form) => {
    const shipKey = key.replace('billing_', 'shipping_') as keyof typeof form
    const value = sameAsShipping ? form[shipKey] : form[key]
    return <div className="al-field"><label>{label}</label>
      <input className="al-input" value={value} disabled={sameAsShipping}
        onChange={e => set(key, e.target.value)}
        style={sameAsShipping ? { background: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' } : undefined} /></div>
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
        <h5>Shipping Address</h5>{field('Address Line 1','shipping_line1')}{field('Address Line 2','shipping_line2')}<div className="al-field-row">{field('City','shipping_city')}{field('State','shipping_state')}</div><div className="al-field-row">{field('ZIP Code','shipping_zipcode')}{field('Country','shipping_country')}</div>
        <h5 style={{marginTop:20}}>Billing Address</h5>
        <label className="ncust-check-opt" style={{ margin: '4px 0 12px' }}>
          <input type="checkbox" checked={sameAsShipping} onChange={e => setSameAsShipping(e.target.checked)} />
          <span className="ncust-check-box" />
          Same as Shipping Address
        </label>
        {billingField('Address Line 1','billing_line1')}{billingField('Address Line 2','billing_line2')}<div className="al-field-row">{billingField('City','billing_city')}{billingField('State','billing_state')}</div><div className="al-field-row">{billingField('ZIP Code','billing_zipcode')}{billingField('Country','billing_country')}</div>
      </div></section></div>
    </div>
  </div>
}

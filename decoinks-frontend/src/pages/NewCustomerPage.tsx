import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, UserRound, MapPin } from 'lucide-react'
import { api } from '../services/api'
import toast from '../utils/toast'

const SEGMENTS = ['retail', 'reseller', 'corporate', 'non-profit', 'individual']
const TIERS = ['Standard', 'Silver', 'Gold', 'Platinum']

export function NewCustomerPage() {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    first_name: '', last_name: '', company_name: '', email: '',
    company_phone_number: '', whatsapp_number: '', mobile_number: '',
    preferred_language: 'en', customer_segment: 'retail', tier: 'Standard',
    shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '',
    shipping_zipcode: '', shipping_country: 'USA',
    billing_line1: '', billing_line2: '', billing_city: '', billing_state: '',
    billing_zipcode: '', billing_country: 'USA',
  })
  const set = (key: keyof typeof form, value: string) => setForm(v => ({ ...v, [key]: value }))

  const save = async () => {
    if (!form.first_name.trim()) return toast.error('First name is required')
    setSaving(true)
    try {
      const addresses = [
        { address_type: 'shipping', line1: form.shipping_line1, line2: form.shipping_line2,
          city: form.shipping_city, state: form.shipping_state, zipcode: form.shipping_zipcode,
          country: form.shipping_country, is_default: true },
        { address_type: 'billing', line1: form.billing_line1, line2: form.billing_line2,
          city: form.billing_city, state: form.billing_state, zipcode: form.billing_zipcode,
          country: form.billing_country, is_default: true },
      ].filter(a => a.line1 || a.city || a.state || a.zipcode)
      const res = await api.post('/customers', {
        name: [form.first_name, form.last_name].filter(Boolean).join(' '),
        first_name: form.first_name, last_name: form.last_name || null,
        company_name: form.company_name || null, email: form.email || null,
        company_phone_number: form.company_phone_number || null,
        phone: form.company_phone_number || null, whatsapp: form.whatsapp_number || null,
        mobile_number: form.mobile_number || null, preferred_language: form.preferred_language,
        customer_segment: form.customer_segment, tier: form.tier, addresses,
      })
      toast.success('Customer created')
      navigate(`/customers/${res.data.data?.id ?? res.data.id}`)
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Failed to create customer')
    } finally { setSaving(false) }
  }

  const field = (label: string, key: keyof typeof form, type = 'text') => (
    <div className="al-field"><label>{label}</label><input className="al-input" type={type} value={form[key]} onChange={e => set(key, e.target.value)} /></div>
  )

  return <div className="ncust-page">
    <div className="ncust-header"><div><div className="ns-breadcrumb"><span onClick={() => navigate('/customers')}>Customers</span><ChevronRight size={13}/><strong>New Customer</strong></div><h2 className="ns-page-title">New Customer</h2></div>
      <div className="ns-header-actions"><button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button><button className="lb-action-btn lb-action-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save Customer'}</button></div></div>
    <div className="ncust-grid">
      <div className="ncust-col">
        <section className="al-panel al-section"><div className="al-section-header"><UserRound size={16}/><h4>Customer Profile</h4></div><div className="ncust-section-body">
          <div className="al-field-row">{field('First Name *','first_name')}{field('Last Name','last_name')}</div>
          {field('Company Name','company_name')}{field('Email Address','email','email')}
          <div className="al-field-row">{field('Company Phone','company_phone_number','tel')}{field('Mobile Number','mobile_number','tel')}</div>
          {field('WhatsApp Number','whatsapp_number','tel')}
          <div className="al-field-row"><div className="al-field"><label>Preferred Language</label><select className="al-input" value={form.preferred_language} onChange={e=>set('preferred_language',e.target.value)}><option value="en">English</option><option value="es">Spanish</option></select></div>
          <div className="al-field"><label>Customer Segment</label><select className="al-input" value={form.customer_segment} onChange={e=>set('customer_segment',e.target.value)}>{SEGMENTS.map(x=><option key={x}>{x}</option>)}</select></div></div>
          <div className="al-field"><label>Loyalty Tier</label><select className="al-input" value={form.tier} onChange={e=>set('tier',e.target.value)}>{TIERS.map(x=><option key={x}>{x}</option>)}</select></div>
        </div></section>
      </div>
      <div className="ncust-col"><section className="al-panel al-section"><div className="al-section-header"><MapPin size={16}/><h4>Addresses</h4></div><div className="ncust-section-body">
        <h5>Shipping Address</h5>{field('Address Line 1','shipping_line1')}{field('Address Line 2','shipping_line2')}<div className="al-field-row">{field('City','shipping_city')}{field('State','shipping_state')}</div><div className="al-field-row">{field('ZIP Code','shipping_zipcode')}{field('Country','shipping_country')}</div>
        <h5 style={{marginTop:20}}>Billing Address</h5>{field('Address Line 1','billing_line1')}{field('Address Line 2','billing_line2')}<div className="al-field-row">{field('City','billing_city')}{field('State','billing_state')}</div><div className="al-field-row">{field('ZIP Code','billing_zipcode')}{field('Country','billing_country')}</div>
      </div></section></div>
    </div>
  </div>
}

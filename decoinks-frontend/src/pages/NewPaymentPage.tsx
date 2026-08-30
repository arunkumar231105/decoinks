import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleDollarSign } from 'lucide-react'
import { api } from '../services/api'
import toast from '../utils/toast'
import { useFormDraft } from '../hooks/useFormDraft'
import { DraftBanner } from '../components/DraftBanner'

const METHODS = ['Bank Transfer', 'Cash', 'Card', 'PayPal', 'Zelle', 'Stripe', 'Shopify', 'Cheque', 'Other']
const STATUSES = ['Completed', 'Pending', 'Failed', 'Refunded']

const today = () => new Date().toISOString().slice(0, 10)

interface Option { id: string; label: string }

const EMPTY = {
  payment_date: today(),
  amount: '',
  fee_amount: '',
  payment_method: 'Bank Transfer',
  status: 'Completed',
  transaction_id: '',
  reference_no: '',
  customer_id: '',
  order_id: '',
  received_from_name: '',
  received_into_account_id: '',
  sender_bank_name: '',
  sender_account_name: '',
  sender_account_last4: '',
  sender_reference: '',
  notes: '',
}

export function NewPaymentPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { id } = useParams<{ id?: string }>()
  const isEdit = !!id
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const set = (key: keyof typeof form, value: string) => setForm(v => ({ ...v, [key]: value }))

  // Customers and orders to link the payment against.
  const { data: customers = [] } = useQuery<Option[]>({
    queryKey: ['payment-customers'],
    queryFn: () => api.get('/customers', { params: { page: 1, limit: 1000 } })
      .then(r => (r.data.data?.rows ?? r.data.data ?? []).map((c: Record<string, unknown>) => ({
        id: String(c.id), label: String(c.display_name || c.name || '—'),
      }))),
  })

  // The company's own receiving accounts — a lookup, so a renamed account
  // updates everywhere at once.
  const { data: accounts = [] } = useQuery<Array<{ value: string; label: string }>>({
    queryKey: ['payment-accounts'],
    queryFn: () => api.get('/payments/filters').then(r => r.data.data?.accounts ?? []),
  })

  const { data: existing } = useQuery<Record<string, unknown>>({
    queryKey: ['payment', id],
    queryFn: () => api.get(`/payments/${id}`).then(r => r.data.data),
    enabled: isEdit,
  })

  useEffect(() => {
    if (!existing) return
    setForm({
      payment_date: String(existing.payment_date ?? existing.paid_at ?? today()).slice(0, 10),
      amount: String(existing.amount ?? ''),
      fee_amount: String(existing.fee_amount ?? ''),
      transaction_id: String(existing.transaction_id ?? ''),
      received_from_name: String(existing.received_from_name ?? ''),
      received_into_account_id: String(existing.received_into_account_id ?? ''),
      sender_bank_name: String(existing.sender_bank_name ?? ''),
      sender_account_name: String(existing.sender_account_name ?? ''),
      sender_account_last4: String(existing.sender_account_last4 ?? ''),
      sender_reference: String(existing.sender_reference ?? ''),
      payment_method: String(existing.payment_method ?? 'Bank Transfer'),
      status: String(existing.status ?? 'Completed'),
      reference_no: String(existing.reference_no ?? ''),
      customer_id: String(existing.customer_id ?? ''),
      order_id: String(existing.order_id ?? ''),
      notes: String(existing.notes ?? ''),
    })
  }, [existing])

  // Keep a half-filled payment across a refresh (create mode only).
  const { restored, clearDraft } = useFormDraft(
    'payment:new', form,
    saved => setForm(f => ({ ...f, ...(saved as typeof EMPTY) })),
    { enabled: !isEdit },
  )

  const totalAmount = +Number(form.amount || 0).toFixed(2)
  const feeAmount = Number(form.fee_amount) || 0
  const netAmount = +(totalAmount - feeAmount).toFixed(2)

  // A payment can cover several orders (combined billing). One empty row is
  // shown by default; the single-order case just fills that row.
  const [allocations, setAllocations] = useState<Array<{ order_id: string; allocated_amount: string }>>([
    { order_id: '', allocated_amount: '' },
  ])
  const allocatedTotal = allocations.reduce((sum, a) => sum + (Number(a.allocated_amount) || 0), 0)

  const save = async () => {
    if (!(totalAmount > 0)) return toast.error('Enter an amount greater than zero')
    if (feeAmount < 0 || feeAmount > totalAmount) return toast.error('Fee cannot be negative or exceed the total')
    const lines = allocations.filter(a => a.order_id && Number(a.allocated_amount) > 0)
    if (allocatedTotal > totalAmount) return toast.error('Applied amounts exceed the payment total')
    setSaving(true)
    try {
      const payload = {
        payment_date: form.payment_date || null,
        amount: totalAmount,
        fee_amount: feeAmount,
        transaction_id: form.transaction_id || null,
        payment_method: form.payment_method,
        status: form.status,
        reference_no: form.reference_no || null,
        customer_id: form.customer_id || null,
        order_id: form.order_id || lines[0]?.order_id || null,
        allocations: lines.map(a => ({ order_id: a.order_id, allocated_amount: Number(a.allocated_amount) })),
        received_from_name: form.received_from_name || null,
        received_into_account_id: form.received_into_account_id || null,
        sender_bank_name: form.sender_bank_name || null,
        sender_account_name: form.sender_account_name || null,
        sender_account_last4: form.sender_account_last4 || null,
        sender_reference: form.sender_reference || null,
        notes: form.notes || null,
      }
      if (isEdit) {
        await api.put(`/payments/${id}`, payload)
        toast.success('Payment updated')
      } else {
        await api.post('/payments', payload)
        clearDraft()
        toast.success('Payment recorded')
      }
      qc.invalidateQueries({ queryKey: ['payments'] })
      navigate('/payments')
    } catch (e) {
      toast.apiError(e)
    } finally { setSaving(false) }
  }

  const field = (label: string, key: keyof typeof form, type = 'text', placeholder = '') => (
    <div className="al-field"><label>{label}</label>
      <input className="al-input" type={type} value={form[key]} placeholder={placeholder}
        onChange={e => set(key, e.target.value)} />
    </div>
  )

  const title = isEdit ? 'Edit Payment' : 'New Payment'

  return <div className="ncust-page">
    <div className="ncust-header">
      <div>
        <div className="ns-breadcrumb"><span onClick={() => navigate('/payments')}>Payments</span><ChevronRight size={13}/><strong>{title}</strong></div>
        <h2 className="ns-page-title">{title}</h2>
      </div>
      <div className="ns-header-actions">
        <button className="lb-action-btn" onClick={() => navigate('/payments')}>Cancel</button>
        <button className="lb-action-btn lb-action-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Record Payment'}
        </button>
      </div>
    </div>

    <DraftBanner show={restored} onDiscard={() => { clearDraft(); setForm({ ...EMPTY }) }} />

    <div className="ncust-grid">
      <div className="ncust-col">
        <section className="al-panel al-section">
          <div className="al-section-header"><CircleDollarSign size={16}/><h4>Payment Details</h4></div>
          <div className="ncust-section-body">
            {field('Payment Date', 'payment_date', 'date')}
            <div className="al-field-row">
              {field('Amount', 'amount', 'number', '0.00')}
              {field('Processor Fee', 'fee_amount', 'number', 'PayPal / card cut — 0.00')}
            </div>
            {feeAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5,
                            color: '#166534', margin: '-6px 0 10px', padding: '0 14px' }}>
                <span>Net received (after fee)</span><strong>${netAmount.toFixed(2)}</strong>
              </div>
            )}
            <div className="al-field-row">
              <div className="al-field"><label>Payment Method</label>
                <select className="al-input" value={form.payment_method} onChange={e => set('payment_method', e.target.value)}>
                  {METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="al-field"><label>Status</label>
                <select className="al-input" value={form.status} onChange={e => set('status', e.target.value)}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="al-field-row">
              {field('Transaction ID', 'transaction_id', 'text', 'PayPal / Zelle txn id')}
              {field('Reference No', 'reference_no', 'text', 'Cheque / internal reference')}
            </div>
          </div>
        </section>

        <section className="al-panel al-section" style={{ marginTop: 14 }}>
          <div className="al-section-header"><CircleDollarSign size={16}/><h4>Sender / Payer Bank</h4></div>
          <div className="ncust-section-body">
            {field('Sender Bank', 'sender_bank_name', 'text', 'e.g. Chase, Wells Fargo')}
            {field('Account Name', 'sender_account_name', 'text', 'Name on the sending account')}
            <div className="al-field-row">
              {field('Account (last 4)', 'sender_account_last4', 'text', '1234')}
              {field('Sender Reference', 'sender_reference', 'text', 'Their transaction ref')}
            </div>
            <p style={{ fontSize: 11.5, color: '#6b7280', margin: '2px 0 0', lineHeight: 1.5 }}>
              Only the last four digits are stored — a payer's full account number is
              sensitive and this system has no need to hold it.
            </p>
          </div>
        </section>
      </div>

      <div className="ncust-col">
        <section className="al-panel al-section">
          <div className="al-section-header"><CircleDollarSign size={16}/><h4>Linked To</h4></div>
          <div className="ncust-section-body">
            {field('Received From', 'received_from_name', 'text', 'Who actually sent the money')}
            <div className="al-field"><label>Received Into (our account)</label>
              <select className="al-input" value={form.received_into_account_id}
                      onChange={e => set('received_into_account_id', e.target.value)}>
                <option value="">— Select account —</option>
                {accounts.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div className="al-field"><label>Customer</label>
              <select className="al-input" value={form.customer_id} onChange={e => set('customer_id', e.target.value)}>
                <option value="">— Select customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            {/* The sales order is chosen from the ORDER form, not here. Money
                lands before the order is keyed in, so the order is raised
                against an existing payment and links itself on save. The
                order_id and allocation columns are untouched — only this
                picker is gone, so nothing already linked is affected. */}
            <div className="al-field"><label>Notes</label>
              <textarea className="al-textarea" rows={4} value={form.notes}
                onChange={e => set('notes', e.target.value)} placeholder="Any notes about this payment…" />
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
}

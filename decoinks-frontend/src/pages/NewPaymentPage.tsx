import { useEffect, useState } from 'react'
import { PAYMENT_METHODS, isListedPaymentMethod } from '../utils/paymentMethods'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleDollarSign } from 'lucide-react'
import { api } from '../services/api'
import toast from '../utils/toast'
import { useFormDraft } from '../hooks/useFormDraft'
import { DraftBanner } from '../components/DraftBanner'
import { SearchableSelect } from '../components/SearchableSelect'
import { toIsoDate } from '../utils/period'
import '../styles/form-errors.css'

// The same list the sales order form offers — an order's method is its payment's.
const METHODS: readonly string[] = PAYMENT_METHODS
const STATUSES = ['Completed', 'Pending', 'Failed', 'Refunded']

// The shop's own calendar day. toISOString() is UTC, so from early evening in
// the US it already reads tomorrow.
const today = () => toIsoDate(new Date())

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

// ── The form's rules ─────────────────────────────────────────────────────────
// The server holds the same ones (backend payments.rules.js) and adds what only
// it can check: a transaction ID already on another payment, and a linked
// payment's customer. Payments the system records itself — Stripe, PayPal —
// never come through this form and are never held to these.
type PaymentForm = typeof EMPTY
type Account = { value: string; label: string; account_type?: string }
const methodKey = (v?: string | null) => String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
// Where each method's money lands. A method with no account of the shop's own
// (Cash App, Venmo, cash) is tied to none.
const ACCOUNT_FOR: Record<string, string> = {
  zelle: 'zelle', paypal: 'paypal', stripe: 'stripe', shopify: 'shopify', banktransfer: 'bank', bankdeposit: 'bank',
}
const NEEDS_TRANSACTION_ID = new Set(['stripe', 'paypal', 'shopify'])
const NUMBER = /^-?\d+(\.\d+)?$/
const sameValue = (a: string, b: string) => {
  const x = String(a ?? '').trim(), y = String(b ?? '').trim()
  return NUMBER.test(x) && NUMBER.test(y) ? Number(x) === Number(y) : x === y
}

function paymentProblems(form: PaymentForm, original: PaymentForm | null, accounts: Account[]) {
  const errors: Partial<Record<keyof PaymentForm, string>> = {}
  const fail = (field: keyof PaymentForm, message: string) => { if (!errors[field]) errors[field] = message }
  // Editing checks only what is being changed, so an older payment with a gap
  // can still have its notes corrected.
  const changed = (...keys: (keyof PaymentForm)[]) => !original || keys.some(k => !sameValue(form[k], original[k]))
  const text = (k: keyof PaymentForm) => String(form[k] ?? '').trim()

  if (changed('payment_date')) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text('payment_date'))) fail('payment_date', 'Enter the date the payment was received')
    else if (text('payment_date') > today()) fail('payment_date', 'Payment date cannot be in the future')
  }
  const amount = Number(form.amount)
  if (changed('amount') && (!text('amount') || !Number.isFinite(amount) || amount <= 0)) {
    fail('amount', 'Enter the amount received — it must be more than 0')
  }
  if (changed('fee_amount', 'amount')) {
    const fee = text('fee_amount') ? Number(form.fee_amount) : 0
    if (!Number.isFinite(fee) || fee < 0) fail('fee_amount', 'Fee cannot be negative')
    else if (amount > 0 && fee >= amount) fail('fee_amount', 'Fee must be less than the amount')
  }
  const method = form.payment_method
  const name = PAYMENT_METHODS.find(m => methodKey(m) === methodKey(method)) ?? method
  if (changed('payment_method')) {
    if (!text('payment_method')) fail('payment_method', 'Choose how the money was paid')
    else if (!PAYMENT_METHODS.some(m => methodKey(m) === methodKey(method))) fail('payment_method', 'Choose a payment method from the list')
  }
  if (changed('payment_method', 'transaction_id') && NEEDS_TRANSACTION_ID.has(methodKey(method)) && !text('transaction_id')) {
    fail('transaction_id', `Enter the ${name} transaction ID`)
  }
  if (changed('transaction_id') && /\s/.test(text('transaction_id'))) fail('transaction_id', 'Transaction ID cannot contain spaces')
  if (changed('received_from_name')) {
    if (!text('received_from_name')) fail('received_from_name', 'Enter who sent the money')
    else if (!/\p{L}.*\p{L}/u.test(text('received_from_name'))) fail('received_from_name', 'Enter the name of who sent the money — not a number')
  }
  if (changed('payment_method', 'received_into_account_id')) {
    const wanted = ACCOUNT_FOR[methodKey(method)]
    const where = wanted === 'bank' ? 'the bank account' : `the ${name} account`
    const chosen = accounts.find(a => a.value === form.received_into_account_id)
    if (wanted && !form.received_into_account_id) fail('received_into_account_id', `Choose the account the money went into — ${where}`)
    else if (wanted && chosen && methodKey(chosen.account_type) !== wanted) {
      fail('received_into_account_id', `A ${name} payment must go into ${where}, not ${chosen.label}`)
    }
  }
  if (changed('customer_id') && !form.customer_id) fail('customer_id', 'Choose the customer this payment is from')
  for (const [k, label] of [['sender_bank_name', 'Sender bank'], ['sender_account_name', 'Account name']] as const) {
    if (changed(k) && text(k) && !/\p{L}/u.test(text(k))) fail(k, `${label} must be a name, not only numbers`)
  }
  if (changed('sender_account_last4') && text('sender_account_last4') && !/^\d{4}$/.test(text('sender_account_last4'))) {
    fail('sender_account_last4', 'Enter exactly the last 4 digits')
  }
  if (changed('notes') && text('notes').length > 1000) fail('notes', 'Notes can be at most 1000 characters')
  return errors
}

export function NewPaymentPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { id } = useParams<{ id?: string }>()
  const isEdit = !!id
  const [form, setForm] = useState(() => ({ ...EMPTY, payment_date: today() }))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof PaymentForm, string>>>({})
  // The payment as loaded, when editing — the rules check only what changes.
  const [original, setOriginal] = useState<PaymentForm | null>(null)
  const set = (key: keyof typeof form, value: string) => {
    setForm(v => ({ ...v, [key]: value }))
    setErrors(e => { if (!e[key]) return e; const next = { ...e }; delete next[key]; return next })
  }

  // Customers and orders to link the payment against.
  const { data: customers = [] } = useQuery<Option[]>({
    queryKey: ['payment-customers'],
    queryFn: () => api.get('/customers', { params: { page: 1, limit: 1000 } })
      .then(r => (r.data.data?.rows ?? r.data.data ?? []).map((c: Record<string, unknown>) => ({
        id: String(c.id), label: String(c.display_name || c.name || '—'),
      }))),
  })
  // Alphabetical, so browsing without typing lands where you expect.
  const customerOptions = customers
    .map(c => ({ value: c.id, label: c.label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))

  // The company's own receiving accounts — a lookup, so a renamed account
  // updates everywhere at once.
  const { data: accounts = [] } = useQuery<Account[]>({
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
    const loaded = {
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
    }
    setForm(loaded)
    setOriginal(loaded)
  }, [existing])

  // Keep a half-filled payment across a refresh (create mode only).
  //
  // Everything comes back except the date. The draft is written on every visit,
  // so a stale one is almost always waiting — and it carried the date of the
  // first time the form was opened, which is why a new payment kept opening
  // dated weeks back. A payment is recorded today unless someone says otherwise.
  const { restored, clearDraft } = useFormDraft(
    'payment:new', form,
    saved => {
      const { payment_date: _stale, ...rest } = saved as typeof EMPTY
      setForm(f => ({ ...f, ...rest, payment_date: today() }))
    },
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

  // The account follows the method: choosing Stripe picks the Stripe account.
  const chooseMethod = (method: string) => {
    set('payment_method', method)
    const wanted = ACCOUNT_FOR[methodKey(method)]
    const current = accounts.find(a => a.value === form.received_into_account_id)
    const match = wanted ? accounts.find(a => methodKey(a.account_type) === wanted) : undefined
    if (match && (!current || methodKey(current.account_type) !== wanted)) set('received_into_account_id', match.value)
  }
  // A new payment opens with the account its default method goes into.
  useEffect(() => {
    if (isEdit || form.received_into_account_id || !accounts.length) return
    const wanted = ACCOUNT_FOR[methodKey(form.payment_method)]
    const match = wanted ? accounts.find(a => methodKey(a.account_type) === wanted) : undefined
    if (match) setForm(v => ({ ...v, received_into_account_id: match.value }))
  }, [accounts, isEdit]) // eslint-disable-line react-hooks/exhaustive-deps
  // Choosing the customer fills Received From when nobody has typed one yet.
  const chooseCustomer = (customerId: string) => {
    set('customer_id', customerId)
    const label = customerOptions.find(c => c.value === customerId)?.label
    if (label && !form.received_from_name.trim()) set('received_from_name', label)
  }

  const save = async () => {
    const problems = paymentProblems(form, isEdit ? original : null, accounts)
    if (Object.keys(problems).length) {
      setErrors(problems)
      return toast.error('Please fix the fields marked in red')
    }
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
      // The server's rules answer field by field; each goes under its field.
      const details = (e as { response?: { data?: { details?: Array<{ field?: string; message: string }> } } })
        ?.response?.data?.details
      const fielded = Array.isArray(details) ? details.filter(d => d?.field) : []
      if (fielded.length) {
        setErrors(Object.fromEntries(fielded.map(d => [d.field, d.message])))
        toast.error('Please fix the fields marked in red')
      } else {
        toast.apiError(e)
      }
    } finally { setSaving(false) }
  }

  const inputClass = (key: keyof typeof form, base = 'al-input') => (errors[key] ? `${base} has-error` : base)
  const errorFor = (key: keyof typeof form) => (errors[key] ? <span className="al-field-error">{errors[key]}</span> : null)
  const field = (label: string, key: keyof typeof form, type = 'text', placeholder = '') => (
    <div className="al-field"><label>{label}</label>
      <input className={inputClass(key)} type={type} value={form[key]} placeholder={placeholder}
        aria-invalid={Boolean(errors[key])}
        onChange={e => set(key, e.target.value)} />
      {errorFor(key)}
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
                <select className={inputClass('payment_method')} value={form.payment_method} onChange={e => chooseMethod(e.target.value)}>
                  {form.payment_method && !isListedPaymentMethod(form.payment_method) && <option>{form.payment_method}</option>}
                  {METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
                {errorFor('payment_method')}
              </div>
              <div className="al-field"><label>Status</label>
                <select className={inputClass('status')} value={form.status} onChange={e => set('status', e.target.value)}>
                  {form.status && !STATUSES.some(s => s.toLowerCase() === form.status.toLowerCase()) && <option>{form.status}</option>}
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
                {errorFor('status')}
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
              <select className={inputClass('received_into_account_id')} value={form.received_into_account_id}
                      onChange={e => set('received_into_account_id', e.target.value)}>
                <option value="">— Select account —</option>
                {accounts.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
              {errorFor('received_into_account_id')}
            </div>
            <div className="al-field"><label>Customer</label>
              <SearchableSelect
                value={form.customer_id}
                options={customerOptions}
                onChange={chooseCustomer}
                className={inputClass('customer_id')}
                placeholder="— Select customer —"
                searchPlaceholder="Search customer…"
              />
              {errorFor('customer_id')}
            </div>
            {/* The sales order is chosen from the ORDER form, not here. Money
                lands before the order is keyed in, so the order is raised
                against an existing payment and links itself on save. The
                order_id and allocation columns are untouched — only this
                picker is gone, so nothing already linked is affected. */}
            <div className="al-field"><label>Notes</label>
              <textarea className={inputClass('notes', 'al-textarea')} rows={4} value={form.notes}
                onChange={e => set('notes', e.target.value)} placeholder="Any notes about this payment…" />
              {errorFor('notes')}
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
}

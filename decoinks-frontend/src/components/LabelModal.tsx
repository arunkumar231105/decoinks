import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Tag, AlertTriangle } from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'

interface Rate {
  id: string
  carrier: string
  service: string
  amount: string
  currency: string
  estimated_days?: number | null
}

const FROM_KEY = 'decoinks_ship_from'
const loadFrom = () => {
  try { return JSON.parse(localStorage.getItem(FROM_KEY) || 'null') } catch { return null }
}

const blankAddr = { name: '', street1: '', city: '', state: '', zip: '', country: 'US', phone: '' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
const label: React.CSSProperties = { fontSize: 12, color: '#475569', fontWeight: 600, marginBottom: 3, display: 'block' }

// Buy a shipping label through Shippo: enter From / To / parcel → Get Rates
// (free) → pick a rate → Buy Label (charges the account). On success a shipment
// with the label + tracking number is created.
export function LabelModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [from, setFrom] = useState({ ...blankAddr, ...(loadFrom() || {}) })
  const [to, setTo] = useState({ ...blankAddr })
  const [parcel, setParcel] = useState({ length: '10', width: '8', height: '4', weight: '1' })
  const [rates, setRates] = useState<Rate[] | null>(null)
  const [isTest, setIsTest] = useState(false)
  const [selected, setSelected] = useState<Rate | null>(null)

  const ratesMutation = useMutation({
    mutationFn: () => api.post('/shipments/rates', { from, to, parcel }).then(r => r.data.data),
    onSuccess: (data) => {
      localStorage.setItem(FROM_KEY, JSON.stringify(from))
      setRates(data.rates); setIsTest(Boolean(data.test)); setSelected(null)
      if (data.messages?.length) toast.success(data.messages.join('; '))
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Could not get rates'),
  })

  const buyMutation = useMutation({
    mutationFn: () => api.post('/shipments/label', {
      rate_id: selected!.id, carrier: selected!.carrier, service: selected!.service, amount: selected!.amount,
      to_name: to.name, to_street: to.street1, to_city: to.city, to_state: to.state, to_zip: to.zip,
    }).then(r => r.data.data),
    onSuccess: (s) => {
      toast.success(`Label purchased — ${s.tracking_number ?? 'tracking pending'}`)
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      if (s.label_url) window.open(s.label_url, '_blank')
      onClose()
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Label purchase failed'),
  })

  const handleBuy = () => {
    if (!selected) return
    const msg = isTest
      ? 'Buy this TEST label? (no real charge)'
      : `Buy this label for ${selected.currency} ${selected.amount}? This charges your Shippo account (real money).`
    if (window.confirm(msg)) buyMutation.mutate()
  }

  const addrFields = (val: typeof blankAddr, set: (v: typeof blankAddr) => void, showName: boolean) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {showName && <div style={{ gridColumn: 'span 2' }}><label style={label}>Name</label><input style={inputStyle} value={val.name} onChange={e => set({ ...val, name: e.target.value })} /></div>}
      <div style={{ gridColumn: 'span 2' }}><label style={label}>Street</label><input style={inputStyle} value={val.street1} onChange={e => set({ ...val, street1: e.target.value })} /></div>
      <div><label style={label}>City</label><input style={inputStyle} value={val.city} onChange={e => set({ ...val, city: e.target.value })} /></div>
      <div><label style={label}>State</label><input style={inputStyle} value={val.state} onChange={e => set({ ...val, state: e.target.value })} placeholder="e.g. CA" /></div>
      <div><label style={label}>ZIP</label><input style={inputStyle} value={val.zip} onChange={e => set({ ...val, zip: e.target.value })} /></div>
      <div><label style={label}>Phone</label><input style={inputStyle} value={val.phone} onChange={e => set({ ...val, phone: e.target.value })} /></div>
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 640, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 56px rgba(0,0,0,0.18)' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}><Tag size={18} /> Create Shipping Label</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}><X size={20} /></button>
        </div>

        <div style={{ padding: '18px 24px', overflowY: 'auto', flex: 1 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', color: '#0f766e' }}>Ship From</h3>
          {addrFields(from, setFrom, true)}

          <h3 style={{ fontSize: 13, fontWeight: 700, margin: '18px 0 8px', color: '#0f766e' }}>Ship To (customer)</h3>
          {addrFields(to, setTo, true)}

          <h3 style={{ fontSize: 13, fontWeight: 700, margin: '18px 0 8px', color: '#0f766e' }}>Parcel</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            <div><label style={label}>Length (in)</label><input style={inputStyle} value={parcel.length} onChange={e => setParcel({ ...parcel, length: e.target.value })} /></div>
            <div><label style={label}>Width (in)</label><input style={inputStyle} value={parcel.width} onChange={e => setParcel({ ...parcel, width: e.target.value })} /></div>
            <div><label style={label}>Height (in)</label><input style={inputStyle} value={parcel.height} onChange={e => setParcel({ ...parcel, height: e.target.value })} /></div>
            <div><label style={label}>Weight (lb)</label><input style={inputStyle} value={parcel.weight} onChange={e => setParcel({ ...parcel, weight: e.target.value })} /></div>
          </div>

          <button
            className="lb-action-btn lb-action-primary"
            style={{ marginTop: 16 }}
            disabled={ratesMutation.isPending || !from.street1 || !to.street1 || !to.zip}
            onClick={() => ratesMutation.mutate()}
          >
            {ratesMutation.isPending ? 'Getting rates…' : 'Get Rates'}
          </button>

          {rates && (
            <div style={{ marginTop: 18 }}>
              {isTest && (
                <div style={{ fontSize: 12, color: '#a16207', background: '#fef9c3', borderRadius: 6, padding: '6px 10px', marginBottom: 10 }}>
                  TEST mode — no real charge.
                </div>
              )}
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>Choose a rate</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rates.map(r => (
                  <label key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${selected?.id === r.id ? '#0f766e' : '#e5e7eb'}`, background: selected?.id === r.id ? '#f0fdfa' : '#fff',
                  }}>
                    <input type="radio" checked={selected?.id === r.id} onChange={() => setSelected(r)} />
                    <span style={{ flex: 1, fontSize: 13 }}>
                      <strong>{r.carrier}</strong> · {r.service}
                      {r.estimated_days != null && <span style={{ color: '#94a3b8' }}> · {r.estimated_days}d</span>}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{r.currency} {r.amount}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 24px', borderTop: '1px solid #e5e7eb' }}>
          <span style={{ fontSize: 11, color: '#b45309', display: 'flex', alignItems: 'center', gap: 6 }}>
            {!isTest && rates && <><AlertTriangle size={13} /> Buying a label charges real money.</>}
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="lb-action-btn" onClick={onClose} disabled={buyMutation.isPending}>Cancel</button>
            <button
              className="lb-action-btn lb-action-primary"
              disabled={!selected || buyMutation.isPending}
              onClick={handleBuy}
            >
              {buyMutation.isPending ? 'Buying…' : selected ? `Buy Label — ${selected.currency} ${selected.amount}` : 'Buy Label'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, X, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import { api } from '../services/api'
import toast from '../utils/toast'

interface ParsedRow {
  po_number: string
  po_date: string
  client_name: string
  shipping_name: string
  ship_to: string
  vendor: string
  dispatch_date: string
  print_type: string
  total_gangsheets: number
  total_artworks: number
  gangsheet_width: string
  gangsheet_lengths: string
  payment_received: string
  shipping_charge: number
  net_amount: number
  payment_terms: string
  notes: string
  // computed
  size_desc: string
  unit_price: number
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      result.push(cur.trim()); cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur.trim())
  return result
}

function parseMoney(str: string): number {
  if (!str || str.toLowerCase() === 'free' || str === '') return 0
  return parseFloat(str.replace(/[^0-9.]/g, '')) || 0
}

function parseDateStr(str: string): string | null {
  if (!str) return null
  // "21-Apr-2026" or "21-Apr-2026 before 2 pm"
  const months: Record<string, number> = {
    Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11
  }
  const m = str.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/)
  if (!m) return null
  const d = new Date(+m[3], months[m[2]], +m[1])
  return d.toISOString().split('T')[0]
}

function buildSizeDesc(width: string, lengths: string): string {
  const w = width.replace(/['"]/g, '').trim()
  // lengths can be "W21.6/H24.7" or "01 W21.6/H198.7; 02 W21.6/H198.7; ..."
  const clean = lengths.replace(/['"]/g, '').trim()
  // If single: "W21.6/H24.7"
  const single = clean.match(/^W([\d.]+)\/H([\d.]+)$/)
  if (single) return `${w}" × ${single[2]}"`
  // Multiple: extract all lengths
  const multiMatches = [...clean.matchAll(/W[\d.]+\/H([\d.]+)/g)]
  if (multiMatches.length > 0) {
    const lengths = multiMatches.map(m => m[1]).join(', ')
    return `${w}" × [${lengths}]"`
  }
  return `${w}" ${clean}`
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 3) return []

  // First line might be title, second line headers
  // Detect header line by checking if it contains "PO Number"
  let headerIdx = 0
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    if (lines[i].includes('PO Number') || lines[i].includes('Client Name')) {
      headerIdx = i; break
    }
  }

  const headers = parseCsvLine(lines[headerIdx]).map(h => h.replace(/['"]/g, '').trim())
  const idx = (name: string) => headers.indexOf(name)

  const rows: ParsedRow[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i])
    if (vals.every(v => !v)) continue
    const get = (name: string) => (vals[idx(name)] ?? '').replace(/^"|"$/g, '').trim()

    const totalGS = parseInt(get('Total Gangsheets')) || 1
    const netAmt = parseMoney(get('Net Product Amount'))
    const shipping = parseMoney(get('Shipping Charge'))
    const width = get('Gangsheet Width')
    const lengths = get('Gangsheet Length(s)')

    rows.push({
      po_number: get('PO Number'),
      po_date: get('PO Date'),
      client_name: get('Client Name'),
      shipping_name: get('PO Shipping Name'),
      ship_to: get('Ship To Address'),
      vendor: get('Vendor'),
      dispatch_date: get('Required Dispatch Date'),
      print_type: get('Print Type'),
      total_gangsheets: totalGS,
      total_artworks: parseInt(get('Total Artworks')) || 0,
      gangsheet_width: width,
      gangsheet_lengths: lengths,
      payment_received: get('Payment Received'),
      shipping_charge: shipping,
      net_amount: netAmt,
      payment_terms: get('Payment Terms'),
      notes: get('Notes'),
      size_desc: buildSizeDesc(width, lengths),
      unit_price: totalGS > 0 ? +(netAmt / totalGS).toFixed(2) : netAmt,
    })
  }
  return rows
}

function buildQuotePayload(row: ParsedRow) {
  const ptMap: Record<string, string> = {
    'Advance': 'Due on Receipt',
    'advance': 'Due on Receipt',
  }
  return {
    customer_name: row.client_name || null,
    shipping_address: row.ship_to || null,
    due_date: parseDateStr(row.dispatch_date),
    estimated_shipping: row.shipping_charge,
    payment_terms: ptMap[row.payment_terms] || 'Due on Receipt',
    internal_notes: [
      row.po_number ? `PO: ${row.po_number}` : '',
      row.vendor    ? `Vendor: ${row.vendor}` : '',
      row.po_date   ? `PO Date: ${row.po_date}` : '',
    ].filter(Boolean).join(' | ') || null,
    notes: row.notes || null,
    items: [{
      description: `${row.size_desc} Gangsheet (${row.print_type || 'DTF'})`,
      qty: row.total_gangsheets,
      unit_price: row.unit_price,
      artwork_count: row.total_artworks,
      sizes: row.size_desc,
    }],
  }
}

interface Props { onClose: () => void }

export function CsvImportQuotesModal({ onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [results, setResults] = useState<Array<{ po: string; status: 'ok' | 'err'; msg?: string }>>([])
  const [importing, setImporting] = useState(false)
  const queryClient = useQueryClient()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResults([])
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCsv(text)
      setRows(parsed)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (!rows.length) return
    setImporting(true)
    const res: typeof results = []
    for (const row of rows) {
      try {
        await api.post('/quotations', buildQuotePayload(row))
        res.push({ po: row.po_number || row.client_name, status: 'ok' })
      } catch (err: any) {
        res.push({
          po: row.po_number || row.client_name,
          status: 'err',
          msg: err.response?.data?.message || err.message,
        })
      }
    }
    setResults(res)
    setImporting(false)
    const ok = res.filter(r => r.status === 'ok').length
    if (ok > 0) {
      queryClient.invalidateQueries({ queryKey: ['quotations'] })
      toast.success(`${ok} quote${ok > 1 ? 's' : ''} imported successfully`)
    }
  }

  const done = results.length > 0
  const okCount = results.filter(r => r.status === 'ok').length
  const errCount = results.filter(r => r.status === 'err').length

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300,
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, width: 860, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Import Quotes from CSV</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>
              DTF PO Master Sheet format — each row creates one Quote
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <X size={20} />
          </button>
        </div>

        {/* Upload area */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #f3f4f6' }}>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: '2px dashed #d1d5db', borderRadius: 8, padding: '16px 24px',
              display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
              background: '#f9fafb', transition: 'border-color .15s',
            }}
          >
            <Upload size={20} color="#6b7280" />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {fileName || 'Click to upload CSV file'}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                {rows.length > 0 ? `${rows.length} rows detected` : 'DTF PO Master Sheet (.csv)'}
              </div>
            </div>
            {rows.length > 0 && <CheckCircle size={18} color="#16a34a" style={{ marginLeft: 'auto' }} />}
          </div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
        </div>

        {/* Preview table */}
        {rows.length > 0 && !done && (
          <div style={{ flex: 1, overflow: 'auto', padding: '0 24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
                  {['#', 'PO No.', 'Client', 'Ship To', 'Due Date', 'Gangsheets', 'Artworks', 'Size', 'Net Amt', 'Shipping'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 10px', color: '#9ca3af' }}>{i + 1}</td>
                    <td style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.po_number}</td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{r.client_name}</td>
                    <td style={{ padding: '6px 10px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.ship_to}>{r.ship_to || '—'}</td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{parseDateStr(r.dispatch_date) || r.dispatch_date}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'center' }}>{r.total_gangsheets}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'center' }}>{r.total_artworks}</td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: '#0d9488', fontWeight: 500 }}>{r.size_desc}</td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                      {r.net_amount > 0 ? `$${r.net_amount.toFixed(2)}` : <span style={{ color: '#9ca3af' }}>Free</span>}
                    </td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                      {r.shipping_charge > 0 ? `$${r.shipping_charge.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Results after import */}
        {done && (
          <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              {okCount > 0 && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={16} color="#16a34a" />
                  <span style={{ fontWeight: 600, color: '#15803d' }}>{okCount} imported</span>
                </div>
              )}
              {errCount > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle size={16} color="#dc2626" />
                  <span style={{ fontWeight: 600, color: '#dc2626' }}>{errCount} failed</span>
                </div>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['PO / Client', 'Status', 'Message'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>{r.po}</td>
                    <td style={{ padding: '6px 10px' }}>
                      {r.status === 'ok'
                        ? <span style={{ color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={13} /> Imported</span>
                        : <span style={{ color: '#dc2626', display: 'flex', alignItems: 'center', gap: 4 }}><AlertCircle size={13} /> Failed</span>}
                    </td>
                    <td style={{ padding: '6px 10px', color: '#6b7280' }}>{r.msg || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button
              onClick={handleImport}
              disabled={rows.length === 0 || importing}
              style={{
                padding: '8px 18px', borderRadius: 6, border: 'none',
                background: rows.length === 0 ? '#d1d5db' : '#0d9488',
                color: '#fff', cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {importing && <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />}
              {importing ? 'Importing...' : `Import ${rows.length} Quote${rows.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

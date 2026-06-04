import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Download, Upload, X, XCircle } from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'

interface PreviewRow {
  rowNumber: number
  mapped: Record<string, string | null>
  item: Record<string, unknown> | null
  errors: string[]
}

interface PreviewData {
  totalRows: number
  validRows: number
  skippedRows: number
  headersDetected: string[]
  recognisedColumns: string[]
  rows: PreviewRow[]
}

const TYPE_COLORS: Record<string, string> = {
  apparel: '#0d9488', gangsheet: '#7c3aed', dtf: '#2563eb',
}

export function BulkUploadOrdersModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)

  const previewMutation = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData(); fd.append('file', f)
      return api.post('/orders/bulk-upload?preview=true', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: (res) => setPreview(res.data.data),
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Preview failed'),
  })

  const importMutation = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData(); fd.append('file', f)
      return api.post('/orders/bulk-upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: (res) => {
      const d = res.data.data
      toast.success(`Created ${d.created} order${d.created !== 1 ? 's' : ''}${d.skipped ? `, skipped ${d.skipped}` : ''}`)
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      onClose()
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Upload failed'),
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f); setPreview(null)
    if (f) previewMutation.mutate(f)
  }

  const pending = previewMutation.isPending || importMutation.isPending

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 56px rgba(0,0,0,0.18)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#111827' }}>Bulk Upload Orders (CSV)</h2>
            <p style={{ margin: '3px 0 0', fontSize: 13, color: '#6b7280' }}>CSV se multiple orders ek saath create karo</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>

          {/* Step 1 */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>Step 1 — CSV Template download karo</p>
            <a href="/api/orders/csv-template" download="orders_template.csv">
              <button className="lb-action-btn" style={{ gap: 6, fontSize: 13 }}>
                <Download size={14} /> Download Orders Template
              </button>
            </a>
            <p style={{ fontSize: 11, color: '#9ca3af', margin: '6px 0 0' }}>
              Columns: order_type (apparel/gangsheet/dtf), supplier_name, order_date, due_date, item, color, size, qty, unit_price, notes
            </p>
          </div>

          {/* Step 2 */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>Step 2 — Apni CSV file select karo</p>
            <div
              style={{ border: '2px dashed #d1d5db', borderRadius: 8, padding: '18px 16px', textAlign: 'center', cursor: 'pointer', background: '#f9fafb' }}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={22} style={{ color: '#9ca3af', marginBottom: 6 }} />
              <p style={{ fontSize: 13, color: '#374151', margin: '0 0 4px' }}>{file ? file.name : 'Click to choose CSV file'}</p>
              <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>Max 5 MB, .csv only</p>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={handleFile} />
          </div>

          {previewMutation.isPending && (
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#6b7280', fontSize: 13 }}>Analysing CSV...</div>
          )}

          {/* Preview */}
          {preview && (
            <div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
                  <CheckCircle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  {preview.validRows} orders create honge
                </span>
                {preview.skippedRows > 0 && (
                  <span style={{ background: '#fee2e2', color: '#dc2626', borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
                    <XCircle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    {preview.skippedRows} skip honge
                  </span>
                )}
                <span style={{ background: '#f1f5f9', color: '#64748b', borderRadius: 20, padding: '4px 12px', fontSize: 12 }}>
                  {preview.totalRows} rows total
                </span>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['#', 'Type', 'Supplier', 'Item', 'Qty', 'Price', 'Status/Error'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => {
                      const hasError = row.errors.length > 0
                      const ot = row.mapped.order_type as string
                      const color = TYPE_COLORS[ot] ?? '#64748b'
                      return (
                        <tr key={row.rowNumber} style={{ background: hasError ? '#fff7f7' : undefined }}>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', color: hasError ? '#dc2626' : '#6b7280' }}>{row.rowNumber}</td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9' }}>
                            {ot && <span style={{ background: `${color}20`, color, borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 700 }}>{ot}</span>}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', color: '#374151' }}>{row.mapped.supplier_name || '-'}</td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', color: '#374151' }}>
                            {row.item ? String((row.item as any).item || (row.item as any).artwork_name || (row.item as any).size || '-') : '-'}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9' }}>{row.item ? String((row.item as any).qty || '-') : '-'}</td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9' }}>
                            {row.item ? `$${(row.item as any).unit_price ?? (row.item as any).price_per_sheet ?? 0}` : '-'}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9' }}>
                            {hasError
                              ? <span style={{ color: '#dc2626', fontSize: 11 }}>{row.errors.join('; ')}</span>
                              : <span style={{ color: '#15803d', fontSize: 11 }}>Ready</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 24px', borderTop: '1px solid #e5e7eb' }}>
          <button className="lb-action-btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button
            className="lb-action-btn lb-action-primary"
            disabled={!preview || preview.validRows === 0 || pending}
            onClick={() => file && importMutation.mutate(file)}
            style={{ gap: 6 }}
          >
            {importMutation.isPending
              ? 'Creating Orders...'
              : preview ? `Create ${preview.validRows} Order${preview.validRows !== 1 ? 's' : ''}` : 'Create Orders'}
          </button>
        </div>
      </div>
    </div>
  )
}

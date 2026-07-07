import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Download, Sparkles, Upload, X, XCircle } from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'

interface PreviewRow {
  rowNumber: number
  mappedFields: Record<string, string | null>
  lineItem: { description: string; qty: number; unit_price: number } | null
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

interface ImportResult {
  created: number
  skipped: number
  skippedRows: { rowNumber: number; errors: string[] }[]
}

export function BulkUploadModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [useAi, setUseAi] = useState(false)

  const previewMutation = useMutation({
    mutationFn: ({ f, ai }: { f: File; ai: boolean }) => {
      const fd = new FormData()
      fd.append('file', f)
      return api.post(`/quotations/bulk-upload?preview=true${ai ? '&ai=true' : ''}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: (res) => setPreview(res.data.data),
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Preview failed'),
  })

  const importMutation = useMutation({
    mutationFn: ({ f, ai }: { f: File; ai: boolean }) => {
      const fd = new FormData()
      fd.append('file', f)
      return api.post(`/quotations/bulk-upload${ai ? '?ai=true' : ''}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: (res) => {
      const d: ImportResult = res.data.data
      toast.success(`Created ${d.created} quotation${d.created !== 1 ? 's' : ''}${d.skipped ? `, skipped ${d.skipped}` : ''}`)
      queryClient.invalidateQueries({ queryKey: ['quotations'] })
      onClose()
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Upload failed'),
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setPreview(null)
    if (f) previewMutation.mutate({ f, ai: useAi })
  }

  const toggleAi = (next: boolean) => {
    setUseAi(next)
    setPreview(null)
    if (file) previewMutation.mutate({ f: file, ai: next })
  }

  const handleDownloadTemplate = () => {
    const link = document.createElement('a')
    link.href = '/api/quotations/csv-template'
    link.download = 'quotations_template.csv'
    link.click()
  }

  const pending = previewMutation.isPending || importMutation.isPending

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 50, padding: 16,
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 680,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 56px rgba(0,0,0,0.18)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#111827' }}>Bulk Upload Quotations</h2>
            <p style={{ margin: '3px 0 0', fontSize: 13, color: '#6b7280' }}>Upload a CSV to create multiple quotations at once.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>

          {/* AI toggle */}
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18, cursor: 'pointer',
            padding: '12px 14px', borderRadius: 10,
            border: `1px solid ${useAi ? '#5eead4' : '#e5e7eb'}`,
            background: useAi ? '#f0fdfa' : '#fafafa',
          }}>
            <input type="checkbox" checked={useAi} onChange={e => toggleAi(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: '#0f766e' }}>
                <Sparkles size={14} /> Smart import with AI
              </span>
              <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Let AI read any column layout (e.g. a DTF PO master sheet) — it maps
                fields, detects the quote type and works out totals. You still review
                the preview before importing.
              </span>
            </span>
          </label>

          {/* Step 1: Template */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 13, color: '#374151', margin: '0 0 8px', fontWeight: 600 }}>
              Step 1 — Download the template
            </p>
            <button
              className="lb-action-btn"
              onClick={handleDownloadTemplate}
              style={{ gap: 6, fontSize: 13 }}
            >
              <Download size={14} /> Download CSV Template
            </button>
            <p style={{ fontSize: 11, color: '#9ca3af', margin: '6px 0 0' }}>
              Optional columns are left blank; present columns will be mapped automatically.
            </p>
          </div>

          {/* Step 2: File picker */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 13, color: '#374151', margin: '0 0 8px', fontWeight: 600 }}>
              Step 2 — Select your CSV file
            </p>
            <div
              style={{
                border: '2px dashed #d1d5db', borderRadius: 8, padding: '18px 16px',
                textAlign: 'center', cursor: 'pointer', background: '#f9fafb',
                transition: 'border-color 0.2s',
              }}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={22} style={{ color: '#9ca3af', marginBottom: 6 }} />
              <p style={{ fontSize: 13, color: '#374151', margin: '0 0 4px' }}>
                {file ? file.name : 'Click to choose a CSV file'}
              </p>
              <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>Max 5 MB, .csv only</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={handleFileChange}
            />
          </div>

          {/* Loading indicator */}
          {previewMutation.isPending && (
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#6b7280', fontSize: 13 }}>
              Analysing CSV...
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div>
              {/* Summary chips */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
                  <CheckCircle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  {preview.validRows} will be created
                </span>
                {preview.skippedRows > 0 && (
                  <span style={{ background: '#fee2e2', color: '#dc2626', borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
                    <XCircle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    {preview.skippedRows} will be skipped
                  </span>
                )}
                <span style={{ background: '#f1f5f9', color: '#64748b', borderRadius: 20, padding: '4px 12px', fontSize: 12 }}>
                  {preview.totalRows} rows total
                </span>
              </div>

              {/* Detected headers */}
              <p style={{ fontSize: 11, color: '#9ca3af', margin: '0 0 12px' }}>
                Recognised columns: <strong>{preview.recognisedColumns.join(', ')}</strong>
              </p>

              {/* Row table */}
              <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>#</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>Customer</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>Product</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>Total</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => {
                      const hasError = row.errors.length > 0
                      const total = row.lineItem
                        ? ((row.lineItem.qty || 1) * (row.lineItem.unit_price || 0)).toFixed(2)
                        : '0.00'
                      return (
                        <tr key={row.rowNumber} style={{ background: hasError ? '#fff7f7' : undefined }}>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', color: hasError ? '#dc2626' : '#6b7280' }}>
                            {row.rowNumber}
                            {hasError && <XCircle size={11} style={{ marginLeft: 4, verticalAlign: 'middle', color: '#dc2626' }} />}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', color: '#111827' }}>
                            {row.mappedFields.customer_name || row.mappedFields.company_name || '—'}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', color: '#374151' }}>
                            {row.lineItem?.description || '—'}
                            {row.lineItem && <span style={{ color: '#9ca3af', marginLeft: 4 }}>×{row.lineItem.qty}</span>}
                          </td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', color: '#374151' }}>${total}</td>
                          <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9' }}>
                            {hasError ? (
                              <span style={{ color: '#dc2626', fontSize: 11 }}>{row.errors.join('; ')}</span>
                            ) : (
                              <span style={{ color: '#15803d', fontSize: 11 }}>{row.mappedFields.status || 'Draft'}</span>
                            )}
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
            disabled={!preview || preview.validRows === 0 || pending || importMutation.isPending}
            onClick={() => file && importMutation.mutate({ f: file, ai: useAi })}
            style={{ gap: 6 }}
          >
            {importMutation.isPending
              ? 'Importing...'
              : preview
                ? `Confirm & Import ${preview.validRows} Quotation${preview.validRows !== 1 ? 's' : ''}`
                : 'Confirm & Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

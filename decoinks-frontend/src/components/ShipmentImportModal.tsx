import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Upload, X } from 'lucide-react'
import toast from '../utils/toast'
import { api } from '../services/api'

interface PreviewData { total: number; willImport: number; willSkip: number }

// Bulk import shipments from a Shippo "Shipping Fee" CSV export.
// The file carries tracking number, carrier, service level, ship date and cost;
// PO / address come from Shippo when the shipment's tracking is refreshed.
export function ShipmentImportModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)

  const previewMutation = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData(); fd.append('file', f)
      return api.post('/shipments/import?preview=true', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: (res) => setPreview(res.data.data),
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Could not read CSV'),
  })

  const importMutation = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData(); fd.append('file', f)
      return api.post('/shipments/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: (res) => {
      const d = res.data.data
      toast.success(`Imported ${d.imported} shipment${d.imported !== 1 ? 's' : ''}${d.skipped ? `, skipped ${d.skipped}` : ''}`)
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      onClose()
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Import failed'),
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f); setPreview(null)
    if (f) previewMutation.mutate(f)
  }

  const pending = previewMutation.isPending || importMutation.isPending

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 520, boxShadow: '0 24px 56px rgba(0,0,0,0.18)' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#111827' }}>Import Shipments (CSV)</h2>
            <p style={{ margin: '3px 0 0', fontSize: 13, color: '#6b7280' }}>Shippo "Shipping Fee" export upload karo</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}><X size={20} /></button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          <div
            style={{ border: '2px dashed #d1d5db', borderRadius: 8, padding: '22px 16px', textAlign: 'center', cursor: 'pointer', background: '#f9fafb' }}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={22} style={{ color: '#9ca3af', marginBottom: 6 }} />
            <p style={{ fontSize: 13, color: '#374151', margin: '0 0 4px' }}>{file ? file.name : 'Click to choose CSV file'}</p>
            <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>Max 5 MB, .csv only</p>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={handleFile} />
          <p style={{ fontSize: 11, color: '#9ca3af', margin: '8px 0 0' }}>
            Expected columns: Tracking Number, Carrier, Service Level, Transaction Creation Date, Amount, Invoice Number.
          </p>

          {previewMutation.isPending && (
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#6b7280', fontSize: 13 }}>Reading CSV…</div>
          )}

          {preview && (
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
                <CheckCircle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                {preview.willImport} import honge
              </span>
              {preview.willSkip > 0 && (
                <span style={{ background: '#fef9c3', color: '#a16207', borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
                  {preview.willSkip} already exist (skip)
                </span>
              )}
              <span style={{ background: '#f1f5f9', color: '#64748b', borderRadius: 20, padding: '4px 12px', fontSize: 12 }}>
                {preview.total} unique tracking #
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 24px', borderTop: '1px solid #e5e7eb' }}>
          <button className="lb-action-btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button
            className="lb-action-btn lb-action-primary"
            disabled={!preview || preview.willImport === 0 || pending}
            onClick={() => file && importMutation.mutate(file)}
            style={{ gap: 6 }}
          >
            {importMutation.isPending ? 'Importing…' : preview ? `Import ${preview.willImport} Shipment${preview.willImport !== 1 ? 's' : ''}` : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

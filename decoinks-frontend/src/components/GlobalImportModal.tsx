import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles, Upload, X, CheckCircle, ArrowRight } from 'lucide-react'
import { api } from '../services/api'
import toast from '../utils/toast'

type Target = 'quote' | 'order'

interface Analysis {
  target: string
  order_type: string | null
  reason: string
  supported: boolean
}
interface Preview {
  validRows: number
  skippedRows: number
  totalRows: number
  recognisedColumns: string[]
}

const PATH: Record<Target, string> = {
  quote: '/quotations/bulk-upload',
  order: '/orders/bulk-upload',
}
const ROUTE: Record<Target, string> = { quote: '/quotes', order: '/orders' }
const LABEL: Record<string, string> = {
  quote: 'Quotation', order: 'Order',
  purchase_order: 'Purchase Order', invoice: 'Invoice',
}

export function GlobalImportModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<'analyze' | 'preview' | 'import' | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [target, setTarget] = useState<Target>('quote')
  const [preview, setPreview] = useState<Preview | null>(null)

  async function onPick(f: File) {
    setFile(f); setAnalysis(null); setPreview(null)
    setBusy('analyze')
    try {
      const fd = new FormData(); fd.append('file', f)
      const res = await api.post('/import/analyze', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const a: Analysis = res.data.data
      setAnalysis(a)
      const chosen: Target = a.target === 'order' ? 'order' : 'quote'
      setTarget(chosen)
      await runPreview(f, chosen)
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not analyze the file')
    } finally { setBusy(null) }
  }

  async function runPreview(f: File, t: Target) {
    setBusy('preview'); setPreview(null)
    try {
      const fd = new FormData(); fd.append('file', f)
      const res = await api.post(`${PATH[t]}?preview=true&ai=true`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setPreview(res.data.data)
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Preview failed')
    } finally { setBusy(null) }
  }

  async function changeTarget(t: Target) {
    setTarget(t)
    if (file) await runPreview(file, t)
  }

  async function doImport() {
    if (!file) return
    setBusy('import')
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await api.post(`${PATH[target]}?ai=true`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = res.data.data
      toast.success(`Imported ${d.created} ${LABEL[target].toLowerCase()}${d.created !== 1 ? 's' : ''}${d.skipped ? `, skipped ${d.skipped}` : ''}`)
      queryClient.invalidateQueries({ queryKey: [target === 'order' ? 'orders' : 'quotations'] })
      navigate(ROUTE[target])
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Import failed')
    } finally { setBusy(null) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 620, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 56px rgba(0,0,0,0.22)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Sparkles size={17} style={{ color: '#0d9488' }} /> Smart Import
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: 13, color: '#6b7280' }}>
              Drop any CSV — AI figures out whether it's quotes or orders and imports it.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px', overflowY: 'auto', flex: 1 }}>
          {/* File picker */}
          <div
            onClick={() => fileRef.current?.click()}
            style={{ border: '2px dashed #cbd5e1', borderRadius: 10, padding: '22px', textAlign: 'center', cursor: 'pointer', background: '#fafafa' }}>
            <Upload size={22} style={{ color: '#94a3b8', margin: '0 auto 6px' }} />
            <div style={{ fontSize: 13.5, color: '#374151' }}>
              {file ? file.name : <>Click to choose a CSV file — <span style={{ color: '#0d9488', fontWeight: 700 }}>any layout</span></>}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Max 5 MB, .csv</div>
            <input ref={fileRef} type="file" accept=".csv" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = '' }} />
          </div>

          {busy === 'analyze' && <p style={{ fontSize: 13, color: '#0d9488', marginTop: 14 }}>✨ Analyzing the file…</p>}

          {/* Analysis result */}
          {analysis && (
            <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, background: '#f0fdfa', border: '1px solid #99f6e4' }}>
              <div style={{ fontSize: 13.5, color: '#0f766e' }}>
                <strong>AI detected:</strong> {LABEL[analysis.target] ?? analysis.target}
                {analysis.order_type ? ` · ${analysis.order_type.toUpperCase()}` : ''}
              </div>
              {analysis.reason && <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>{analysis.reason}</div>}
              {!analysis.supported && (
                <div style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>
                  {LABEL[analysis.target]} bulk import isn't available yet — choose Quote or Order below to import there.
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                <span style={{ fontSize: 12.5, color: '#334155', fontWeight: 600 }}>Import as:</span>
                {(['quote', 'order'] as Target[]).map(t => (
                  <button key={t} onClick={() => changeTarget(t)}
                    className={`lb-action-btn${target === t ? ' lb-action-primary' : ''}`}
                    style={{ fontSize: 12.5 }}>
                    {LABEL[t]}s
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {busy === 'preview' && <p style={{ fontSize: 13, color: '#64748b', marginTop: 14 }}>Building preview…</p>}
          {preview && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#15803d', background: '#f0fdf4', padding: '5px 12px', borderRadius: 8 }}>
                  <CheckCircle size={14} /> {preview.validRows} {LABEL[target].toLowerCase()}{preview.validRows !== 1 ? 's' : ''} will be created
                </span>
                {preview.skippedRows > 0 && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#b45309', background: '#fffbeb', padding: '5px 12px', borderRadius: 8 }}>
                    {preview.skippedRows} skipped
                  </span>
                )}
                <span style={{ fontSize: 12.5, color: '#94a3b8' }}>{preview.totalRows} rows total</span>
              </div>
              {preview.recognisedColumns?.length > 0 && (
                <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '10px 0 0' }}>
                  Recognised: <strong>{preview.recognisedColumns.join(', ')}</strong>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 22px', borderTop: '1px solid #e5e7eb' }}>
          <button className="lb-action-btn" onClick={onClose}>Cancel</button>
          <button className="lb-action-btn lb-action-primary"
            disabled={!preview || preview.validRows === 0 || busy !== null}
            onClick={doImport}>
            {busy === 'import' ? 'Importing…' : preview ? <>Import {preview.validRows} {LABEL[target]}{preview.validRows !== 1 ? 's' : ''} <ArrowRight size={13} /></> : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

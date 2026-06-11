import { useRef, useState, useEffect } from 'react'
import React from 'react'
import { Building2, FileText, Upload } from 'lucide-react'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={checked ? 'sg-toggle sg-toggle-on' : 'sg-toggle'}
      onClick={() => onChange(!checked)}
    >
      <span className="sg-toggle-thumb" />
    </button>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asStr(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val)
}

function asBool(val: unknown): boolean {
  if (val === true || val === 'true' || val === '1' || val === 1) return true
  return false
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SettingsGeneralPage() {
  const logoRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  // ── Local form state ──────────────────────────────────────────────────────
  const [companyName,            setCompanyName]            = useState('')
  const [companyLogoUrl,         setCompanyLogoUrl]         = useState('')
  const [logoPreview,            setLogoPreview]            = useState<string | null>(null)
  const [logoUploading,          setLogoUploading]          = useState(false)

  const [invoiceShowDiscount,    setInvoiceShowDiscount]    = useState(false)
  const [invoiceShowPackaging,   setInvoiceShowPackaging]   = useState(false)
  const [invoiceStyle,           setInvoiceStyle]           = useState('detailed')
  const [quoteShowDiscount,      setQuoteShowDiscount]      = useState(false)
  const [quoteRequireApproval,   setQuoteRequireApproval]   = useState(false)

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data.data ?? r.data),
  })

  useEffect(() => {
    if (!settingsData) return
    const s = settingsData
    setCompanyName(asStr(s.company_name))
    setCompanyLogoUrl(asStr(s.company_logo_url))
    setInvoiceShowDiscount(asBool(s.invoice_show_discount))
    setInvoiceShowPackaging(asBool(s.invoice_show_packaging))
    setInvoiceStyle(asStr(s.invoice_style) || 'detailed')
    setQuoteShowDiscount(asBool(s.quote_show_discount))
    setQuoteRequireApproval(asBool(s.quote_require_approval))
  }, [settingsData])

  // ── Save mutation ─────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.put('/settings', payload),
    onSuccess: () => {
      toast.success('Settings saved')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (err: unknown) => {
      const msg = (err as any)?.response?.data?.message ?? 'Failed to save settings'
      toast.error(msg)
    },
  })

  const handleSave = () => {
    saveMutation.mutate({
      company_name:             companyName,
      company_logo_url:         companyLogoUrl,
      invoice_show_discount:    invoiceShowDiscount,
      invoice_show_packaging:   invoiceShowPackaging,
      invoice_style:            invoiceStyle,
      quote_show_discount:      quoteShowDiscount,
      quote_require_approval:   quoteRequireApproval,
    })
  }

  // ── Logo upload ───────────────────────────────────────────────────────────
  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file)
    setLogoPreview(objectUrl)

    // Upload to server
    setLogoUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post('/upload/image', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const url = res.data?.url ?? res.data?.data?.url ?? ''
      if (url) {
        setCompanyLogoUrl(url)
        toast.success('Logo uploaded')
      }
    } catch (err: unknown) {
      toast.error((err as any)?.response?.data?.message ?? 'Logo upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  // Effective logo: prefer fresh upload preview, then saved URL
  const displayLogo = logoPreview || companyLogoUrl || null

  if (isLoading) {
    return (
      <div className="sg-page">
        <div className="al-panel sg-card" style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
          Loading settings...
        </div>
      </div>
    )
  }

  return (
    <div className="sg-page">

      {/* ── ROW 1: Company Info ─────────────────────────────────────────────── */}
      <div className="sg-grid" style={{ gridTemplateColumns: '1fr' }}>

        <div className="al-panel sg-card">
          <div className="sg-card-header">
            <span className="sg-card-icon" style={{ background: '#ccfbf1', color: '#0d9488' }}>
              <Building2 size={16} />
            </span>
            <h3>Company Information</h3>
          </div>

          {/* Logo */}
          <div className="sg-logo-row">
            <div className="sg-logo-preview">
              {displayLogo
                ? <img src={displayLogo} alt="company logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <span className="sg-logo-placeholder">CO</span>
              }
            </div>
            <div className="sg-logo-actions">
              <p className="sg-logo-hint">PNG or SVG recommended. Max 2 MB.</p>
              <input
                ref={logoRef}
                type="file"
                accept=".png,.jpg,.jpeg,.svg,.webp"
                hidden
                onChange={handleLogoFileChange}
              />
              <button
                className="lb-action-btn sg-logo-btn"
                onClick={() => logoRef.current?.click()}
                disabled={logoUploading}
              >
                <Upload size={13} />
                {logoUploading ? 'Uploading...' : 'Change Logo'}
              </button>
            </div>
          </div>

          <div className="sg-fields">
            <div className="al-field">
              <label>Company Name</label>
              <input
                className="al-input"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Decoinks Printshop"
              />
            </div>
          </div>
        </div>

      </div>

      {/* ── ROW 2: Document Visibility ──────────────────────────────────────── */}
      <div className="sg-grid" style={{ gridTemplateColumns: '1fr' }}>

        <div className="al-panel sg-card">
          <div className="sg-card-header">
            <span className="sg-card-icon" style={{ background: '#dbeafe', color: '#2563eb' }}>
              <FileText size={16} />
            </span>
            <h3>Document Visibility</h3>
          </div>

          {/* ── Invoice section ── */}
          <div style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>
              Invoices
            </p>
            <div className="sg-toggle-list">
              <div className="sg-toggle-row">
                <div className="sg-toggle-copy">
                  <strong>Show Discount on Invoices</strong>
                  <span>Display the discount line on customer-facing invoices</span>
                </div>
                <Toggle checked={invoiceShowDiscount} onChange={setInvoiceShowDiscount} />
              </div>

              <div className="sg-toggle-row">
                <div className="sg-toggle-copy">
                  <strong>Show Packaging Charges on Invoices</strong>
                  <span>Include packaging &amp; handling fees as a separate line</span>
                </div>
                <Toggle checked={invoiceShowPackaging} onChange={setInvoiceShowPackaging} />
              </div>

              <div className="sg-toggle-row" style={{ alignItems: 'flex-start' }}>
                <div className="sg-toggle-copy">
                  <strong>Invoice Style</strong>
                  <span>Choose how line items are presented on invoices</span>
                  <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#334155' }}>
                      <input
                        type="radio"
                        name="invoice_style"
                        value="detailed"
                        checked={invoiceStyle === 'detailed'}
                        onChange={() => setInvoiceStyle('detailed')}
                        style={{ accentColor: '#0d9488' }}
                      />
                      Detailed
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#334155' }}>
                      <input
                        type="radio"
                        name="invoice_style"
                        value="summary"
                        checked={invoiceStyle === 'summary'}
                        onChange={() => setInvoiceStyle('summary')}
                        style={{ accentColor: '#0d9488' }}
                      />
                      Summary
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Quotation section ── */}
          <div style={{ marginTop: 24 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>
              Quotations
            </p>
            <div className="sg-toggle-list">
              <div className="sg-toggle-row">
                <div className="sg-toggle-copy">
                  <strong>Show Discount on Quotations</strong>
                  <span>Display discount amounts on customer-facing quotes</span>
                </div>
                <Toggle checked={quoteShowDiscount} onChange={setQuoteShowDiscount} />
              </div>

              <div className="sg-toggle-row">
                <div className="sg-toggle-copy">
                  <strong>Require Approval before Invoice Conversion</strong>
                  <span>A manager must approve the quotation before it can become an invoice</span>
                </div>
                <Toggle checked={quoteRequireApproval} onChange={setQuoteRequireApproval} />
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Save bar ─────────────────────────────────────────────────────────── */}
      <div className="al-bottom-bar">
        <div className="al-bottom-left" />
        <div className="al-bottom-center" />
        <div className="al-bottom-right">
          <button
            className="lb-action-btn lb-action-primary ns-save-btn"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

    </div>
  )
}

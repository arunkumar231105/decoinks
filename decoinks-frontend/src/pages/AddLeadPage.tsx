import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '@mui/material'
import { ChevronDown, Zap } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import { cn } from '../utils/cn'
import { api } from '../services/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiUser { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCES = ['Facebook Messenger', 'WhatsApp', 'Instagram', 'Email', 'Walk-in', 'Phone'] as const

// ── Component ─────────────────────────────────────────────────────────────────

export function AddLeadPage() {
  const navigate    = useNavigate()
  const queryClient = useQueryClient()

  // ── Remote data ──
  const { data: apiUsers = [] } = useQuery<ApiUser[]>({
    queryKey: ['users', 'mini'],
    queryFn:  () => api.get('/users', { params: { limit: 100 } }).then(r => r.data.data.rows),
  })

  // ── Lead meta ──
  const [customerName,    setCustomerName]    = useState('')
  const [source,          setSource]          = useState('Email')
  const [assignedTo,      setAssignedTo]      = useState<string | null>(null)
  const [showAgentDrop,   setShowAgentDrop]   = useState(false)

  // ── Notes ──
  const [internalNotes, setInternalNotes] = useState('')

  // ── Validation errors ──
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Derived ──
  const selectedAgent = apiUsers.find(u => u.id === assignedTo)

  // ── Mutation ──
  const createMutation = useMutation({
    mutationFn: (payload: object) => api.post('/leads', payload),
    onSuccess: () => {
      toast.success('Lead created')
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      navigate('/leads')
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to create lead'),
  })

  // ── Validation ──
  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!customerName.trim()) errs.customerName = 'Customer name is required'
    if (!source) errs.source = 'Source is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Submit ──
  const handleSubmit = () => {
    if (!validate()) return
    createMutation.mutate({
      customer_name:  customerName,
      source,
      assigned_to:    assignedTo     || null,
      internal_notes: internalNotes  || null,
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="add-lead-page">
      <div className="al-body">

        {/* ════ LEFT PANEL ════ */}
        <aside className="al-left">
          <div className="al-panel">
            <div className="al-panel-header">
              <div className="al-panel-avatar"><Zap size={16} /></div>
              <h3>Add Lead</h3>
            </div>

            <div className="al-fields">

              {/* Lead No */}
              <div className="al-field">
                <label>Lead No.</label>
                <input className="al-input al-input-readonly" value="AUTO-GENERATED" readOnly />
              </div>

              {/* Customer Name */}
              <div className="al-field">
                <label>Customer Name <span className="al-req">*</span></label>
                {errors.customerName && <span className="al-error">{errors.customerName}</span>}
                <input
                  className="al-input"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="e.g. John Smith / Acme Corp"
                />
              </div>

              {/* Source */}
              <div className="al-field">
                <label>Source Channel <span className="al-req">*</span></label>
                {errors.source && <span className="al-error">{errors.source}</span>}
                <select
                  className="al-input"
                  value={source}
                  onChange={e => setSource(e.target.value)}
                >
                  {SOURCES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              {/* Assigned To */}
              <div className="al-field" style={{ position: 'relative' }}>
                <label>Assigned To</label>
                <button
                  className="al-agent-select"
                  onClick={() => setShowAgentDrop(v => !v)}
                >
                  <Avatar sx={{ width: 22, height: 22, fontSize: 9, bgcolor: '#0D9488' }}>
                    {selectedAgent?.name?.charAt(0) ?? '?'}
                  </Avatar>
                  <span className="al-agent-name">
                    {selectedAgent?.name ?? 'Select agent'}
                  </span>
                  <ChevronDown size={13} className="al-agent-chevron" />
                </button>
                {showAgentDrop && (
                  <div className="al-dropdown al-agent-dropdown">
                    {apiUsers.map(a => (
                      <button
                        key={a.id}
                        className={cn(
                          'al-dropdown-item al-dropdown-agent',
                          assignedTo === a.id && 'al-dropdown-item-active',
                        )}
                        onClick={() => { setAssignedTo(a.id); setShowAgentDrop(false) }}
                      >
                        <Avatar sx={{ width: 22, height: 22, fontSize: 9, bgcolor: '#0D9488' }}>
                          {a.name.charAt(0)}
                        </Avatar>
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </aside>

        {/* ════ MAIN AREA ════ */}
        <main className="al-center">

          {/* ── Internal Notes ── */}
          <div className="al-panel al-section">
            <div className="al-section-header">
              <h4>Internal Notes</h4>
            </div>
            <div className="al-field">
              <div className="al-label-row">
                <label>Internal Notes <span className="al-optional">(optional)</span></label>
                <span className="al-char-count">{internalNotes.length}/1000</span>
              </div>
              <textarea
                className="al-textarea"
                rows={4}
                maxLength={1000}
                value={internalNotes}
                onChange={e => setInternalNotes(e.target.value)}
                placeholder="Private notes visible only to the team..."
              />
            </div>
          </div>

        </main>
      </div>

      {/* ════ BOTTOM BAR ════ */}
      <div className="al-bottom-bar">
        <div className="al-bottom-right" style={{ marginLeft: 'auto' }}>
          <button className="lb-action-btn" onClick={() => navigate(-1)}>Cancel</button>
          <button
            className="lb-action-btn lb-action-primary al-create-btn"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Lead'}
          </button>
        </div>
      </div>

    </div>
  )
}

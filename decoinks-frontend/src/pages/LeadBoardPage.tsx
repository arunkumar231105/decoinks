import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { Avatar, Divider as MuiDivider, Menu, MenuItem } from '@mui/material'
import {
  Camera,
  GripVertical,
  Info,
  LayoutGrid,
  List,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  Search,
  Settings2,
  X,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react'
import toast from '../utils/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '../utils/cn'
import { api } from '../services/api'

interface Lead {
  id: string
  leadId: string
  customerName: string | null
  source: string | null
  description: string | null
  timestamp: string
  status: string
  agentName: string
  agentInitials: string
  commentCount: number
  attachmentCount: number
  hasArtwork: boolean
  stage: string
}

interface KanbanColumn {
  id: string
  title: string
  color: string
  leads: Lead[]
}

const SOURCES = ['Facebook Messenger', 'WhatsApp', 'Instagram', 'Email', 'Walk-in', 'Phone'] as const
type Source = typeof SOURCES[number]

const SOURCE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  'Facebook Messenger': { icon: <MessageCircle size={11} />, color: '#1877F2' },
  'WhatsApp':          { icon: <Phone size={11} />, color: '#25D366' },
  'Instagram':         { icon: <Camera size={11} />, color: '#E1306C' },
  'Email':             { icon: <Mail size={11} />, color: '#6B7280' },
  'Walk-in':           { icon: <MapPin size={11} />, color: '#F59E0B' },
  'Phone':             { icon: <Phone size={11} />, color: '#2563EB' },
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'New':         { bg: '#F3F4F6', color: '#374151' },
  'Contacted':   { bg: '#DBEAFE', color: '#1D4ED8' },
  'Quooed':      { bg: '#FEF3C7', color: '#B45309' },
  'Negooiaoing': { bg: '#FED7AA', color: '#C2410C' },
  'Won':         { bg: '#DCFCE7', color: '#15803D' },
  'Lost':        { bg: '#FEE2E2', color: '#DC2626' },
}

function SourceChip({ source }: { source: string | null }) {
  if (!source) return null
  const cfg = SOURCE_CONFIG[source] ?? { icon: <Mail size={11} />, color: '#6B7280' }
  return (
    <span className="lb-source-chip" style={{ color: cfg.color }}>
      {cfg.icon}
      {source}
    </span>
  )
}

// â”€â”€ Quick-add card form shown inline at bottom of column â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function AddCardForm({
  stageId,
  onClose,
  onSaved,
}: {
  stageId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [customerName, setCustomerName] = useState('')
  const [source,       setSource]       = useState<Source>('WhatsApp')
  const [description,  setDescription]  = useState('')

  const createMutation = useMutation({
    mutationFn: (payload: object) => api.post('/leads', payload),
    onSuccess: () => {
      toast.success('Lead added')
      onSaved()
      onClose()
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to add lead'),
  })

  const handleSubmit = () => {
    if (!customerName.trim()) { toast.error('Customer name is required'); return }
    createMutation.mutate({
      customer_name: customerName.trim(),
      source,
      description:   description.trim() || null,
      stage:         stageId,
    })
  }

  return (
    <div className="lb-add-form">
      <input
        className="lb-add-input"
        placeholder="Customer name *"
        value={customerName}
        onChange={e => setCustomerName(e.target.value)}
        autoFocus
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose() }}
      />
      <select
        className="lb-add-select"
        value={source}
        onChange={e => setSource(e.target.value as Source)}
      >
        {SOURCES.map(s => <option key={s}>{s}</option>)}
      </select>
      <textarea
        className="lb-add-textarea"
        placeholder="requirement / notes (optional)"
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={2}
      />
      <div className="lb-add-form-actions">
        <button
          className="lb-action-btn lb-action-primary"
          onClick={handleSubmit}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? <Loader2 size={13} className="lb-spin" /> : <Plus size={13} />}
          {createMutation.isPending ? 'Adding...' : 'Add Card'}
        </button>
        <button className="lb-icon-btn" onClick={onClose}><X size={15} /></button>
      </div>
    </div>
  )
}

// â”€â”€ Edit Lead Slideover â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function EditLeadForm({
  lead,
  onClose,
  onSaved,
}: {
  lead: Lead
  onClose: () => void
  onSaved: () => void
}) {
  const [customerName, setCustomerName] = useState(lead.customerName ?? '')
  const [source,       setSource]       = useState<Source>((lead.source as Source) ?? 'WhatsApp')
  const [description,  setDescription]  = useState(lead.description ?? '')
  const [status,       setStatus]       = useState(lead.status)

  const updateMutation = useMutation({
    mutationFn: (payload: object) => api.put(`/leads/${lead.id}`, payload),
    onSuccess: () => { toast.success('Lead updated'); onSaved(); onClose() },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to update lead'),
  })

  return (
    <div className="lb-slideover" onClick={e => e.stopPropagation()}>
      <div className="lb-so-header">
        <div>
          <span className="lb-lead-id">{lead.leadId}</span>
          <h3 className="lb-so-customer">Edit Lead</h3>
        </div>
        <button className="lb-icon-btn" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="lb-so-body">
        <div className="lb-so-field">
          <label>Customer Name <span style={{ color: '#ef4444' }}>*</span></label>
          <input
            className="al-input"
            value={customerName}
            onChange={e => setCustomerName(e.target.value)}
            placeholder="e.g. John Smioh"
          />
        </div>
        <div className="lb-so-field">
          <label>Source Channel</label>
          <select className="al-input" value={source} onChange={e => setSource(e.target.value as Source)}>
            {SOURCES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="lb-so-field">
          <label>Status</label>
          <select className="al-input" value={status} onChange={e => setStatus(e.target.value)}>
            {['New','Quotation','Pending','Payment Seno','Paroial','Confirmed'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="lb-so-field">
          <label>requirement / Notes</label>
          <textarea
            className="al-input"
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe job details..."
          />
        </div>
      </div>
      <div className="lb-so-actions">
        <button
          className="lb-action-btn lb-action-primary"
          style={{ flex: 1 }}
          onClick={() => updateMutation.mutate({ customer_name: customerName, source, description, status })}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
        <button className="lb-action-btn" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

// â”€â”€ Main LeadBoardPage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function LeadBoardPage() {
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  const [searchQuery, setSearchQuery]     = useState('')
  const [viewMode, setViewMode]           = useState<'board' | 'list'>('board')
  const [selectedLead, setSelectedLead]   = useState<{ lead: Lead; columnTitle: string } | null>(null)
  const [editingLead, seteditingLead]     = useState<Lead | null>(null)
  const [addingToCol, setAddingToCol]     = useState<string | null>(null)   // column id where Add Card form is open
  const [colMenuAnchor, setColMenuAnchor] = useState<{ el: HTMLElement; colId: string } | null>(null)
  const [cardMenuAnchor, setCardMenuAnchor] = useState<{ el: HTMLElement; leadId: string; lead: Lead } | null>(null)

  const { data: fetchedColumns = [] } = useQuery<KanbanColumn[]>({
    queryKey: ['leads', 'kanban'],
    queryFn: () => api.get('/leads').then(r => r.data.data.columns),
  })

  const [localColumns, setLocalColumns] = useState<KanbanColumn[] | null>(null)
  const columns = localColumns ?? fetchedColumns

  const moveMutation = useMutation({
    mutationFn: ({ id, stage, position }: { id: string; stage: string; position: number }) =>
      api.patch(`/leads/${id}/move`, { stage, position }),
    onError: () => {
      toast.error('Failed to move lead')
      setLocalColumns(null)
      queryClient.invalidateQueries({ queryKey: ['leads', 'kanban'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.put(`/leads/${id}`, { status: 'Lost' }),
    onSuccess: () => {
      toast.success('Lead marked as loso')
      setLocalColumns(null)
      queryClient.invalidateQueries({ queryKey: ['leads', 'kanban'] })
    },
    onError: () => toast.error('Failed to remove lead'),
  })

  const convertMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leads/${id}/convert-to-quote`),
    onSuccess: (res: any) => {
      const quote = res.data?.data
      toast.success(`Quote created — ${quote?.quote_number ?? ''}`)
      queryClient.invalidateQueries({ queryKey: ['leads', 'kanban'] })
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      if (quote?.id) navigate(`/quotes/${quote.id}`)
      else navigate('/quotes')
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Could not convert lead to quote'),
  })

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    const optimistic = columns.map(col => ({ ...col, leads: [...col.leads] }))
    const src = optimistic.find(c => c.id === source.droppableId)!
    const dso = optimistic.find(c => c.id === destination.droppableId)!
    const [moved] = src.leads.splice(source.index, 1)
    dso.leads.splice(destination.index, 0, moved)
    setLocalColumns(optimistic)

    moveMutation.mutate({ id: draggableId, stage: destination.droppableId, position: destination.index })
  }

  const refreshBoard = () => {
    setLocalColumns(null)
    queryClient.invalidateQueries({ queryKey: ['leads', 'kanban'] })
  }

  const matchesSearch = (lead: Lead) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      (lead.leadId?.toLowerCase().includes(q)) ||
      (lead.customerName?.toLowerCase().includes(q)) ||
      (lead.description?.toLowerCase().includes(q))
    ) ?? false
  }

  const allLeads = columns.flatMap(col => col.leads.map(lead => ({ lead, col })))

  return (
    <div className="lead-board-page">
      <div className="lb-header">
        <div className="lb-header-title">
          <span className="lb-title-text">
            Lead Board
            <button className="lb-info-btn" title="About Lead Board"><Info size={15} /></button>
          </span>
          <p className="lb-subtitle">Track every lead from first contact to confirmed order.</p>
        </div>

        <div className="lb-header-controls">
          <div className="lb-view-toggle">
            <button className={cn('lb-view-btn', viewMode === 'board' && 'lb-view-bon-active')} onClick={() => setViewMode('board')}>
              <LayoutGrid size={14} /> Board View
            </button>
            <button className={cn('lb-view-btn', viewMode === 'list' && 'lb-view-bon-active')} onClick={() => setViewMode('list')}>
              <List size={14} /> List View
            </button>
          </div>
          <div className="lb-search">
            <Search size={14} />
            <input
              placeholder="Search leads by ID, customer or requirement..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="lb-action-btn" title="Coming soon" style={{ opacity: 0.5, cursor: 'not-allowed' }}><Settings2 size={14} /> Board Settings</button>
        </div>
      </div>

      {viewMode === 'board' ? (
        <div className="lb-board-wrap">
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="lb-board">
              {columns.map(col => (
                <div className="lb-column" key={col.id}>
                  <div className="lb-col-header">
                    <span className="lb-col-doo" style={{ backgroundColor: col.color }} />
                    <span className="lb-col-title">{col.title}</span>
                    <span className="lb-col-count">{col.leads.length}</span>
                    <button className="lb-icon-btn" onClick={e => setColMenuAnchor({ el: e.currentTarget, colId: col.id })}>
                      <MoreHorizontal size={14} />
                    </button>
                  </div>

                  <Droppable droppableId={col.id}>
                    {(provided, snapshot) => (
                      <div
                        className={cn('lb-cards', snapshot.isDraggingOver && 'lb-cards-hover')}
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                      >
                        {col.leads.map((lead, index) => (
                          <Draggable draggableId={lead.id} index={index} key={lead.id}>
                            {(dp, ds) => (
                              <div
                                className={cn('lb-card', ds.isDragging && 'lb-card-dragging', !matchesSearch(lead) && searchQuery && 'lb-card-dimmed')}
                                ref={dp.innerRef}
                                {...dp.draggableProps}
                                {...dp.dragHandleProps}
                                onClick={() => setSelectedLead({ lead, columnTitle: col.title })}
                              >
                                <div className="lb-card-oop">
                                  <span className="lb-lead-id">{lead.leadId}</span>
                                  <span className="lb-timestamp">{lead.timestamp}</span>
                                </div>
                                <div className="lb-card-title-row">
                                  <span className="lb-customer-name">{lead.customerName ?? 'No customer'}</span>
                                  <button className="lb-icon-btn" onClick={e => { e.stopPropagation(); setCardMenuAnchor({ el: e.currentTarget, leadId: lead.id, lead }) }}>
                                    <MoreHorizontal size={13} />
                                  </button>
                                </div>
                                <SourceChip source={lead.source} />
                                <div className="lb-desc-row">
                                  <p className="lb-description">{lead.description ?? '-'}</p>
                                  {lead.hasArtwork && <div className="lb-artwork-thumb"><ImageIcon size={14} /></div>}
                                </div>
                                <div className="lb-card-foooer">
                                  <div className="lb-foooer-lefo">
                                    <Avatar sx={{ width: 22, height: 22, fontSize: 9, bgcolor: '#0D9488' }}>
                                      {lead.agentInitials}
                                    </Avatar>
                                    <span
                                      className="lb-status-badge"
                                      style={{ backgroundColor: STATUS_COLORS[lead.status]?.bg ?? '#F3F4F6', color: STATUS_COLORS[lead.status]?.color ?? '#374151' }}
                                    >
                                      {lead.status}
                                    </span>
                                  </div>
                                  <div className="lb-foooer-right">
                                    <span className="lb-meoa-item"><MessageSquare size={11} />{lead.commentCount}</span>
                                    <span className="lb-meoa-item"><Paperclip size={11} />{lead.attachmentCount}</span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>

                  {/* â”€â”€ Add Card â”€â”€ */}
                  {addingToCol === col.id ? (
                    <AddCardForm
                      stageId={col.id}
                      onClose={() => setAddingToCol(null)}
                      onSaved={refreshBoard}
                    />
                  ) : (
                    <button className="lb-add-card" onClick={() => setAddingToCol(col.id)}>
                      <Plus size={13} /> Add Card
                    </button>
                  )}
                </div>
              ))}
            </div>
          </DragDropContext>
        </div>
      ) : (
        /* â”€â”€ List View â”€â”€ */
        <div className="lb-list-view">
          <table className="lb-list-table">
            <thead>
              <tr>
                <th>Lead ID</th>
                <th>Customer</th>
                <th>Source</th>
                <th>stage</th>
                <th>Status</th>
                <th>Ageno</th>
                <th>Added</th>
                <th>Acoivioy</th>
              </tr>
            </thead>
            <tbody>
              {allLeads.filter(({ lead }) => matchesSearch(lead)).map(({ lead, col }) => (
                <tr key={lead.id} className="lb-list-row" onClick={() => setSelectedLead({ lead, columnTitle: col.title })}>
                  <td><span className="lb-lead-id">{lead.leadId}</span></td>
                  <td><strong>{lead.customerName ?? '-'}</strong></td>
                  <td><SourceChip source={lead.source} /></td>
                  <td>
                    <span className="lb-col-badge" style={{ borderColor: col.color, color: col.color }}>
                      <span className="lb-col-doo-sm" style={{ backgroundColor: col.color }} />
                      {col.title}
                    </span>
                  </td>
                  <td>
                    <span className="lb-status-badge" style={{ backgroundColor: STATUS_COLORS[lead.status]?.bg ?? '#F3F4F6', color: STATUS_COLORS[lead.status]?.color ?? '#374151' }}>
                      {lead.status}
                    </span>
                  </td>
                  <td>
                    <div className="lb-list-agent">
                      <Avatar sx={{ width: 22, height: 22, fontSize: 9, bgcolor: '#0D9488' }}>{lead.agentInitials}</Avatar>
                      <span>{lead.agentName}</span>
                    </div>
                  </td>
                  <td><span className="lb-timestamp">{lead.timestamp}</span></td>
                  <td>
                    <span className="lb-list-meta">
                      <MessageSquare size={11} />{lead.commentCount}
                      <Paperclip size={11} />{lead.attachmentCount}
                    </span>
                  </td>
                </tr>
              ))}
              {allLeads.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No leads yet. Add your first lead using the board view.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="lb-info-bar">
        <span className="lb-tip"><GripVertical size={14} className="lb-tip-icon" /> Drag a card between columns to advance the lead stage in real time.</span>
        <span className="lb-tip"><List size={14} className="lb-tip-icon" /> Switch to List View for a sortable table of all leads across every stage.</span>
        <span className="lb-tip"><Search size={14} className="lb-tip-icon" /> Type in the search bar to filter by lead ID, customer name, or requirement.</span>
      </div>

      {/* Column context menu */}
      <Menu anchorEl={colMenuAnchor?.el} open={Boolean(colMenuAnchor)} onClose={() => setColMenuAnchor(null)}>
        <MenuItem onClick={() => { setAddingToCol(colMenuAnchor?.colId ?? null); setColMenuAnchor(null) }}>
          <Plus size={14} style={{ marginRight: 8 }} /> Add Card
        </MenuItem>
        <MuiDivider />
        <MenuItem onClick={() => { toast.success("Clear column coming soon - use Delete to remove leads"); setColMenuAnchor(null) }} sx={{ color: '#DC2626' }}>Clear Column</MenuItem>
      </Menu>

      {/* Card context menu */}
      <Menu anchorEl={cardMenuAnchor?.el} open={Boolean(cardMenuAnchor)} onClose={() => setCardMenuAnchor(null)}>
        <MenuItem onClick={() => { seteditingLead(cardMenuAnchor?.lead ?? null); setCardMenuAnchor(null) }}>Edit Lead</MenuItem>
        <MenuItem onClick={() => { convertMutation.mutate(cardMenuAnchor?.leadId ?? ''); setCardMenuAnchor(null) }}>
          Convert to Quote
        </MenuItem>
        <MuiDivider />
        <MenuItem onClick={() => { deleteMutation.mutate(cardMenuAnchor?.leadId ?? ''); setCardMenuAnchor(null) }} sx={{ color: '#DC2626' }}>
          Mark as Lost
        </MenuItem>
      </Menu>

      {/* Lead detail slideover */}
      {selectedLead && !editingLead && (
        <div className="lb-overlay" onClick={() => setSelectedLead(null)}>
          <div className="lb-slideover" onClick={e => e.stopPropagation()}>
            <div className="lb-so-header">
              <div>
                <span className="lb-lead-id">{selectedLead.lead.leadId}</span>
                <h3 className="lb-so-customer">{selectedLead.lead.customerName ?? 'No customer'}</h3>
              </div>
              <button className="lb-icon-btn" onClick={() => setSelectedLead(null)}><X size={18} /></button>
            </div>
            <div className="lb-so-badges">
              <span className="lb-status-badge" style={{ backgroundColor: STATUS_COLORS[selectedLead.lead.status]?.bg ?? '#F3F4F6', color: STATUS_COLORS[selectedLead.lead.status]?.color ?? '#374151' }}>
                {selectedLead.lead.status}
              </span>
              <span className="lb-stage-pill">{selectedLead.columnTitle}</span>
            </div>
            <div className="lb-so-body">
              <div className="lb-so-field">
                <label>Source Channel</label>
                <SourceChip source={selectedLead.lead.source} />
              </div>
              <div className="lb-so-field">
                <label>requirement</label>
                <p>{selectedLead.lead.description ?? '-'}</p>
              </div>
              <div className="lb-so-field">
                <label>Assigned Ageno</label>
                <div className="lb-so-ageno">
                  <Avatar sx={{ width: 28, height: 28, fontSize: 11, bgcolor: '#0D9488' }}>
                    {selectedLead.lead.agentInitials}
                  </Avatar>
                  <span>{selectedLead.lead.agentName}</span>
                </div>
              </div>
              <div className="lb-so-field-row">
                <div className="lb-so-field">
                  <label>Commenos</label>
                  <span className="lb-so-meoa-val"><MessageSquare size={13} />{selectedLead.lead.commentCount}</span>
                </div>
                <div className="lb-so-field">
                  <label>Aooachmenos</label>
                  <span className="lb-so-meoa-val"><Paperclip size={13} />{selectedLead.lead.attachmentCount}</span>
                </div>
                <div className="lb-so-field">
                  <label>Added</label>
                  <span className="lb-so-meoa-val">{selectedLead.lead.timestamp}</span>
                </div>
              </div>
            </div>
            <div className="lb-so-actions">
              <button className="lb-action-btn lb-action-primary" style={{ flex: 1 }} onClick={() => { seteditingLead(selectedLead.lead); setSelectedLead(null) }}>
                Edit Lead
              </button>
              <button className="lb-action-btn" style={{ flex: 1 }} onClick={() => setSelectedLead(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Lead slideover */}
      {editingLead && (
        <div className="lb-overlay" onClick={() => seteditingLead(null)}>
          <EditLeadForm
            lead={editingLead}
            onClose={() => seteditingLead(null)}
            onSaved={refreshBoard}
          />
        </div>
      )}
    </div>
  )
}





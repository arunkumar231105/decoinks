import { useState, type FormEvent, type ReactNode } from 'react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import {
  CheckCircle2,
  Clock,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
  X,
} from 'lucide-react'
import { cn } from '../utils/cn'
import { api } from '../services/api'

// ── Types ──────────────────────────────────────────────────────────────────────

interface DesignTask {
  id: string
  artwork_no: string
  name: string
  status: string
  file_url: string | null
  file_type: string | null
  tags: string[] | null
  customer_name: string | null
  created_at: string
}

interface DesignColumn {
  status: string
  tasks: DesignTask[]
}

// ── Column config ──────────────────────────────────────────────────────────────

const COLUMN_META: Record<string, { color: string; icon: ReactNode }> = {
  'Draft':             { color: '#64748B', icon: <Clock size={14} /> },
  'Pending Approval':  { color: '#F59E0B', icon: <Clock size={14} /> },
  'Changes Requested': { color: '#8B5CF6', icon: <RefreshCw size={14} /> },
  'Approved':          { color: '#10B981', icon: <CheckCircle2 size={14} /> },
  'Archived':          { color: '#EF4444', icon: <XCircle size={14} /> },
}

// ── Add Task Form ──────────────────────────────────────────────────────────────

function AddTaskForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await api.post('/artworks/task', { name: name.trim(), notes: notes.trim() || null })
      toast.success('Design task created')
      onSaved()
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to create task')
      setSaving(false)
    }
  }

  return (
    <form className="db-add-form" onSubmit={handleSubmit}>
      <input
        className="lb-add-input"
        placeholder="Task name *"
        value={name}
        onChange={e => setName(e.target.value)}
        autoFocus
      />
      <textarea
        className="lb-add-textarea"
        placeholder="Notes (optional)"
        rows={2}
        value={notes}
        onChange={e => setNotes(e.target.value)}
      />
      <div className="lb-add-actions">
        <button type="submit" className="lb-add-btn-save" disabled={saving}>
          {saving ? <Loader2 size={12} className="lb-spin" /> : 'Add Task'}
        </button>
        <button type="button" className="lb-add-btn-cancel" onClick={onCancel}>
          <X size={12} />
        </button>
      </div>
    </form>
  )
}

// ── Task Card ──────────────────────────────────────────────────────────────────

function TaskCard({ task, index }: { task: DesignTask; index: number }) {
  return (
    <Draggable draggableId={task.id} index={index}>
      {(dp, ds) => (
        <div
          className={cn('db-card', ds.isDragging && 'fb-card-dragging')}
          ref={dp.innerRef}
          {...dp.draggableProps}
          {...dp.dragHandleProps}
        >
          <div className="fb-card-top">
            <span className="fb-order-id">{task.artwork_no}</span>
          </div>
          <p className="fb-product-name">{task.name}</p>
          {task.customer_name && (
            <p className="fb-customer">{task.customer_name}</p>
          )}
          {task.tags && task.tags.length > 0 && (
            <div className="db-tags">
              {task.tags.slice(0, 3).map(tag => (
                <span key={tag} className="db-tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </Draggable>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function BoardPage({ boardName }: { boardName: string }) {
  const queryClient = useQueryClient()
  const [addingToCol, setAddingToCol] = useState<string | null>(null)

  const { data: serverColumns = [], isLoading } = useQuery<DesignColumn[]>({
    queryKey: ['design', 'board'],
    queryFn: () => api.get('/artworks/board').then(r => r.data.data),
  })

  const [localColumns, setLocalColumns] = useState<DesignColumn[] | null>(null)
  const columns = localColumns ?? serverColumns

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/artworks/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['design', 'board'] })
      setLocalColumns(null)
    },
    onError: () => {
      toast.error('Failed to move task')
      setLocalColumns(null)
    },
  })

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    const newStatus = destination.droppableId

    setLocalColumns((prev) => {
      const cols = (prev ?? serverColumns).map(col => ({ ...col, tasks: [...col.tasks] }))
      const srcCol = cols.find(c => c.status === source.droppableId)!
      const dstCol = cols.find(c => c.status === destination.droppableId)!
      const [moved] = srcCol.tasks.splice(source.index, 1)
      dstCol.tasks.splice(destination.index, 0, { ...moved, status: newStatus })
      return cols
    })

    moveMutation.mutate({ id: draggableId, status: newStatus })
  }

  const refreshBoard = () => {
    setLocalColumns(null)
    queryClient.invalidateQueries({ queryKey: ['design', 'board'] })
  }

  return (
    <div className="fb-page">

      {/* ── HEADER ── */}
      <div className="fb-header">
        <div className="fb-header-left">
          <h2 className="fb-title">{boardName}</h2>
          <p className="fb-subtitle">Manage design tasks and artwork approvals</p>
        </div>
        <div className="fb-header-controls">
          <button
            className="lb-action-btn lb-action-primary"
            onClick={() => setAddingToCol('Draft')}
          >
            <Plus size={14} />
            Add Design Task
          </button>
        </div>
      </div>

      {/* ── LOADING ── */}
      {isLoading && (
        <div className="fb-loading">
          <Loader2 size={24} className="fb-spinner" />
          <span>Loading board…</span>
        </div>
      )}

      {/* ── BOARD ── */}
      {!isLoading && (
        <div className="fb-board-wrap">
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="fb-board">
              {columns.map((col) => {
                const meta = COLUMN_META[col.status] ?? { color: '#64748B', icon: <Clock size={14} /> }
                return (
                  <div className="fb-column" key={col.status}>

                    <div className="fb-col-header">
                      <span
                        className="fb-col-icon"
                        style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                      >
                        {meta.icon}
                      </span>
                      <span className="fb-col-title">{col.status}</span>
                      <span className="fb-col-count">{col.tasks.length}</span>
                    </div>

                    <Droppable droppableId={col.status}>
                      {(provided, snapshot) => (
                        <div
                          className={cn('fb-cards', snapshot.isDraggingOver && 'fb-cards-hover')}
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                        >
                          {col.tasks.map((task, index) => (
                            <TaskCard key={task.id} task={task} index={index} />
                          ))}
                          {col.tasks.length === 0 && !snapshot.isDraggingOver && (
                            <div className="fb-empty-col">No tasks</div>
                          )}
                          {provided.placeholder}

                          {addingToCol === col.status && (
                            <AddTaskForm
                              onSaved={() => { setAddingToCol(null); refreshBoard() }}
                              onCancel={() => setAddingToCol(null)}
                            />
                          )}
                        </div>
                      )}
                    </Droppable>

                    <button className="fb-add-card" onClick={() => setAddingToCol(col.status)}>
                      <Plus size={12} />
                      Add Task
                    </button>

                  </div>
                )
              })}
            </div>
          </DragDropContext>
        </div>
      )}

      {/* ── BOTTOM INFO BAR ── */}
      <div className="lb-info-bar">
        <span className="lb-tip">
          <GripVertical size={14} className="lb-tip-icon" />
          Drag tasks to update artwork status
        </span>
        <span className="lb-tip">
          <CheckCircle2 size={14} className="lb-tip-icon" />
          Approved artworks are ready for production
        </span>
      </div>

    </div>
  )
}

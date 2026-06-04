import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from '../utils/toast'
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  GripVertical,
  List,
  Package,
  PackageCheck,
  Plus,
  Printer,
  Settings2,
  Truck,
  ClipboardCheck,
  DollarSign,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import { cn } from '../utils/cn'
import { api } from '../services/api'

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface FulfillOrder {
  id: string
  order_number: string
  status: string
  order_type: 'apparel' | 'gangsheet' | 'dtf'
  due_date: string | null
  total: number | string
  customer_name: string | null
  created_at: string
}

interface BoardColumn {
  status: string
  orders: FulfillOrder[]
}

// â”€â”€â”€ Column config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const COLUMN_META: Record<string, { title: string; color: string; icon: React.ReactNode }> = {
  'Confirmed':      { title: 'Order Finalized',    color: '#0D9488', icon: <ClipboardCheck size={14} /> },
  'In Production':  { title: 'In Production',       color: '#8B5CF6', icon: <Printer size={14} /> },
  'Ready to Ship':  { title: 'Ready to Ship',       color: '#F59E0B', icon: <PackageCheck size={14} /> },
  'Shipped':        { title: 'Shipped',             color: '#F97316', icon: <Truck size={14} /> },
  'Delivered':      { title: 'Delivered',           color: '#10B981', icon: <Package size={14} /> },
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  apparel:    'Apparel',
  gangsheet:  'Gangsheet',
  dtf:        'DTF',
}

const VALID_STATUSES = ['Confirmed', 'In Production', 'Ready to Ship', 'Shipped', 'Delivered']

// â”€â”€â”€ Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FulfillCardItem({ order, index }: { order: FulfillOrder; index: number }) {
  const dueDate = order.due_date ? new Date(order.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
  const total = typeof order.total === 'string' ? parseFloat(order.total) : order.total

  return (
    <Draggable draggableId={order.id} index={index}>
      {(dp, ds) => (
        <div
          className={cn('fb-card', ds.isDragging && 'fb-card-dragging')}
          ref={dp.innerRef}
          {...dp.draggableProps}
          {...dp.dragHandleProps}
        >
          <div className="fb-card-top">
            <span className="fb-order-id">{order.order_number}</span>
            <span className="fb-type-badge">{ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}</span>
          </div>

          <p className="fb-customer">{order.customer_name ?? '-'}</p>

          <div className="fb-card-meta">
            {dueDate && (
              <div className="fb-datetime">
                <Calendar size={11} />
                <span>Due {dueDate}</span>
              </div>
            )}
            <div className="fb-total-row">
              <DollarSign size={11} />
              <span>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}

// â”€â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function FulfillmentBoardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [viewAnchorEl, setViewAnchorEl] = useState<HTMLElement | null>(null)

  const { data: serverColumns = [], isLoading } = useQuery<BoardColumn[]>({
    queryKey: ['fulfillment', 'board'],
    queryFn: () => api.get('/orders/board').then(r => r.data.data),
  })

  const [localColumns, setLocalColumns] = useState<BoardColumn[] | null>(null)
  const columns = localColumns ?? serverColumns

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/orders/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fulfillment', 'board'] })
      setLocalColumns(null)
    },
    onError: (err) => {
      toast.apiError(err)
      setLocalColumns(null)
    },
  })

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    const newStatus = destination.droppableId

    // Optimistic update
    setLocalColumns((prev) => {
      const cols = (prev ?? serverColumns).map(col => ({ ...col, orders: [...col.orders] }))
      const srcCol = cols.find(c => c.status === source.droppableId)!
      const dstCol = cols.find(c => c.status === destination.droppableId)!
      const [moved] = srcCol.orders.splice(source.index, 1)
      dstCol.orders.splice(destination.index, 0, { ...moved, status: newStatus })
      return cols
    })

    moveMutation.mutate({ id: draggableId, status: newStatus })
  }

  return (
    <div className="fb-page">

      {/* â”€â”€ HEADER â”€â”€ */}
      <div className="fb-header">
        <div className="fb-header-left">
          <h2 className="fb-title">Fulfillment Board</h2>
          <p className="fb-subtitle">Track and manage order fulfillment workflow</p>
        </div>

        <div className="fb-header-controls">
          <button className="lb-action-btn" onClick={(e) => setViewAnchorEl(e.currentTarget)}>
            <List size={14} />
            All Fulfillment Lists
            <ChevronDown size={13} />
          </button>

          <button className="lb-action-btn" style={{ opacity: 0.5, cursor: "not-allowed" }} title="Coming soon">
            <Settings2 size={14} />
            Board Settings
          </button>

          <button
            className="lb-action-btn lb-action-primary"
            onClick={() => navigate('/orders/new')}
          >
            <Plus size={14} />
            New Order
          </button>
        </div>
      </div>

      {/* â”€â”€ LOADING â”€â”€ */}
      {isLoading && (
        <div className="fb-loading">
          <Loader2 size={24} className="fb-spinner" />
          <span>Loading board...</span>
        </div>
      )}

      {/* â”€â”€ BOARD â”€â”€ */}
      {!isLoading && (
        <div className="fb-board-wrap">
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="fb-board">
              {columns.map((col) => {
                const meta = COLUMN_META[col.status] ?? { title: col.status, color: '#64748B', icon: <Package size={14} /> }
                return (
                  <div className="fb-column" key={col.status}>

                    <div className="fb-col-header">
                      <span className="fb-col-icon" style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                        {meta.icon}
                      </span>
                      <span className="fb-col-title">{meta.title}</span>
                      <span className="fb-col-count">{col.orders.length}</span>
                    </div>

                    <Droppable droppableId={col.status}>
                      {(provided, snapshot) => (
                        <div
                          className={cn('fb-cards', snapshot.isDraggingOver && 'fb-cards-hover')}
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                        >
                          {col.orders.map((order, index) => (
                            <FulfillCardItem key={order.id} order={order} index={index} />
                          ))}
                          {col.orders.length === 0 && !snapshot.isDraggingOver && (
                            <div className="fb-empty-col">No orders</div>
                          )}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>

                    <button className="fb-add-card" onClick={() => navigate('/orders/new')}>
                      <Plus size={12} />
                      New Order
                      <ExternalLink size={11} />
                    </button>

                  </div>
                )
              })}
            </div>
          </DragDropContext>
        </div>
      )}

      {/* â”€â”€ BOTTOM INFO BAR â”€â”€ */}
      <div className="lb-info-bar">
        <span className="lb-tip">
          <GripVertical size={14} className="lb-tip-icon" />
          Drag cards between columns to update order status
        </span>
        <span className="lb-tip">
          <Package size={14} className="lb-tip-icon" />
          Shows Confirmed â†’ Delivered orders
        </span>
        <span className="lb-tip">
          <CheckCircle2 size={14} className="lb-tip-icon" />
          Draft and Cancelled orders are not shown
        </span>
      </div>

    </div>
  )
}

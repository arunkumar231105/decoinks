import { Link } from 'react-router-dom'
import { Calendar, Package } from 'lucide-react'
import StatusBadge from './StatusBadge'
import { cn } from '../utils/cn'

interface Order {
  id: string
  order_number: string
  status: string
  order_type: string
  order_date: string
  due_date: string | null
  total: number
}

interface Props {
  order: Order
  className?: string
}

const TYPE_LABEL: Record<string, string> = {
  apparel:   'Custom T-Shirts',
  gangsheet: 'Gangsheet',
  dtf:       'DTF',
}

const fmt = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

export default function OrderCard({ order, className }: Props) {
  return (
    <Link
      to={`/orders/${order.id}`}
      className={cn(
        'block bg-white rounded-xl border border-gray-100 shadow-sm p-4',
        'hover:border-accent/40 hover:shadow-md transition-all',
        className,
      )}
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-accent">{order.order_number}</p>
          <p className="text-xs text-gray-500 mt-0.5">{TYPE_LABEL[order.order_type] ?? order.order_type}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {/* Dates */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Calendar size={11} />
          {fmt(order.order_date)}
        </span>
        {order.due_date && (
          <span className="flex items-center gap-1">
            <Package size={11} />
            Due {fmt(order.due_date)}
          </span>
        )}
      </div>

      {/* Total */}
      {order.total > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between">
          <span className="text-xs text-gray-400">Total</span>
          <span className="text-sm font-semibold text-gray-900">
            ${order.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        </div>
      )}
    </Link>
  )
}

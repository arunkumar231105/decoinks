import { cn } from '../utils/cn'

const STYLES: Record<string, string> = {
  // Order statuses
  Draft:           'bg-gray-100 text-gray-600',
  Confirmed:       'bg-emerald-50 text-emerald-700',
  'In Production': 'bg-blue-50 text-blue-700',
  'Ready to Ship': 'bg-yellow-50 text-yellow-700',
  Shipped:         'bg-orange-50 text-orange-700',
  Delivered:       'bg-teal-50 text-teal-700',
  Completed:       'bg-green-50 text-green-700',
  Cancelled:       'bg-red-50 text-red-700',
  'On Hold':       'bg-amber-50 text-amber-700',
  // Payment statuses
  Unpaid:          'bg-red-50 text-red-600',
  Partial:         'bg-yellow-50 text-yellow-700',
  Paid:            'bg-green-50 text-green-700',
  Refunded:        'bg-purple-50 text-purple-700',
  // PO statuses
  Sent:            'bg-blue-50 text-blue-700',
  Received:        'bg-green-50 text-green-700',
  // On-time
  'On Time':       'bg-green-50 text-green-700',
  Delayed:         'bg-red-50 text-red-600',
}

interface Props {
  status: string
  size?: 'sm' | 'md'
  className?: string
}

export default function StatusBadge({ status, size = 'sm', className }: Props) {
  const base = STYLES[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        base,
        className,
      )}
    >
      {status}
    </span>
  )
}

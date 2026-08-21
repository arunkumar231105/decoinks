// A sales order tracks two things separately:
//   Order Status   (order_stage)    — where the document is: Draft, Saved, Sent
//   Process Status (process_status) — where the job is: Pushed, In Production,
//                                     QC, Completed, Shipped, Delivered, Cancelled
//
// `status` is the older combined column and is still what the state machine
// drives, so rows written before the split have it and nothing else. These two
// readers derive the pair from it, using the same mapping the backend applies
// in orders.service.js — keep the two in step if either changes.

type OrderLike = {
  status?: string | null
  order_stage?: string | null
  process_status?: string | null
}

const PROCESS_FROM_STATUS: Record<string, string> = {
  Draft: '—',
  Confirmed: 'Pushed',
  'Ready to Ship': 'Completed',
}

export function orderStage(order: OrderLike): string {
  if (order.order_stage) return order.order_stage
  const status = String(order.status || '')
  if (!status) return '—'
  return status === 'Draft' ? 'Draft' : 'Sent'
}

export function processStatus(order: OrderLike): string {
  if (order.process_status) return order.process_status
  const status = String(order.status || '')
  return PROCESS_FROM_STATUS[status] || status || '—'
}

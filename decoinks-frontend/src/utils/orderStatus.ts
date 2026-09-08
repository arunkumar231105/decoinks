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
  export_process_status?: string | null
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
  // The server reads this off the chain itself on every request — no purchase
  // order means the job is waiting for one, a pushed PO means it is on the
  // factory floor, a parcel with a tracking number means it has left. Prefer
  // that over the stored process_status, which is whatever someone last typed
  // and goes stale the moment the next thing happens: an order in transit was
  // still being shown as "In Production" because this reader never asked.
  if (order.export_process_status) return order.export_process_status
  if (order.process_status) return order.process_status
  const status = String(order.status || '')
  return PROCESS_FROM_STATUS[status] || status || '—'
}

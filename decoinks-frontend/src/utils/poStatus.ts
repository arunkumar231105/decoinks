// A purchase order tracks two things, the way a sales order does:
//   PO Status      (po_stage)       — where the document is: Draft, Saved, Sent
//   Process Status (process status) — where the work is: PO Issued,
//                                     In Production, Shipped, Delivered
//
// The server works both out on every list request (export_po_stage,
// export_process_status in po.service.js). These readers prefer that and fall
// back to the combined `status` for a row that came from anywhere else.

type PoLike = {
  status?: string | null
  po_stage?: string | null
  export_po_stage?: string | null
  export_process_status?: string | null
  tracking_status?: string | null
  tracking_number?: string | null
  display_tracking_number?: string | null
}

const NOT_SENT = ['Draft', 'Pending Approval', 'Approved']

export function poStage(po: PoLike): string {
  if (po.export_po_stage) return po.export_po_stage
  const status = String(po.status || '')
  if (status && !NOT_SENT.includes(status)) return 'Sent'
  return po.po_stage || 'Draft'
}

export function poProcessStatus(po: PoLike): string {
  if (po.export_process_status) return po.export_process_status
  const status = String(po.status || '')
  const courier = String(po.tracking_status || '')
  if (status === 'Cancelled') return 'Cancelled'
  if (/deliver/i.test(courier) || ['Received', 'Partially Received', 'Closed'].includes(status)) return 'Delivered'
  if (po.display_tracking_number || po.tracking_number || status === 'Shipped') return 'Shipped'
  if (status === 'In Production') return 'In Production'
  if (poStage(po) === 'Sent') return 'PO Issued'
  return '—'
}

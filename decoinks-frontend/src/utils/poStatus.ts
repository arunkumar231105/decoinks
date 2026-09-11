// A purchase order tracks two things, the way a sales order does:
//   PO Status      (po_stage)       — where the document is: Draft, Saved, Sent
//   Process Status (process status) — where the work is: PO Issued,
//                                     In Production, Shipped, Pre Transit
//                                     (waiting for scan), In Transit, Delivered
//   Factory Status (factory_status)  — where it stands in the factory's system:
//                                     To be Pushed, Factory Audit, Anti Review,
//                                     Pushed
//
// The server works both out on every list request (export_po_stage,
// export_process_status in po.service.js). These readers prefer that and fall
// back to the combined `status` for a row that came from anywhere else.

type PoLike = {
  status?: string | null
  po_stage?: string | null
  export_po_stage?: string | null
  export_process_status?: string | null
  export_factory_status?: string | null
  factory_status?: string | null
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
  if (/transit|out_for_delivery|failure|returned/i.test(courier) && !/pre_transit/i.test(courier)) return 'In Transit'
  if (po.display_tracking_number || po.tracking_number) return 'Pre Transit'
  if (status === 'Shipped') return 'Shipped'
  if (status === 'In Production') return 'In Production'
  // A PO that exists has been issued; the server says the same.
  return 'PO Issued'
}

export function poFactoryStatus(po: PoLike): string {
  if (po.export_factory_status) return po.export_factory_status
  if (po.factory_status) return po.factory_status
  return String(po.status || '') === 'Cancelled' ? '—' : 'To be Pushed'
}

// Mirror of backend/src/utils/stateMachine.js — keep both in sync.

export type UserRole = 'Admin' | 'Manager' | 'Sales' | 'Production' | 'Viewer' | 'supplier'

type TransitionMap = Record<string, Record<string, UserRole[]>>

const ADMIN: UserRole      = 'Admin'
const MANAGER: UserRole    = 'Manager'
const SALES: UserRole      = 'Sales'
const PRODUCTION: UserRole = 'Production'
const SUPPLIER: UserRole   = 'supplier'

export const LEAD_TRANSITIONS: TransitionMap = {
  'New':          { 'Quotation': [SALES], 'Confirmed': [SALES] },
  'Quotation':    { 'Pending': [SALES], 'Confirmed': [SALES] },
  'Pending':      { 'Payment Sent': [SALES, MANAGER], 'Partial': [SALES, MANAGER] },
  'Payment Sent': { 'Confirmed': [SALES, MANAGER] },
  'Partial':      { 'Confirmed': [SALES, MANAGER] },
  'Confirmed':    {},
}

export const QUOTE_TRANSITIONS: TransitionMap = {
  'Draft':    { 'Sent': [SALES], 'Approved': [MANAGER], 'Rejected': [MANAGER], 'Expired': [MANAGER] },
  'Sent':     { 'Draft': [SALES], 'Approved': [MANAGER], 'Rejected': [MANAGER], 'Expired': [MANAGER] },
  'Approved': {},
  'Rejected': { 'Draft': [SALES] },
  'Expired':  { 'Draft': [SALES] },
}

export const INVOICE_TRANSITIONS: TransitionMap = {
  'Draft':          { 'Sent': [SALES, MANAGER], 'Void': [MANAGER] },
  'Sent':           { 'Paid': [MANAGER], 'Partially Paid': [MANAGER], 'Overdue': [MANAGER], 'Void': [MANAGER] },
  'Partially Paid': { 'Paid': [MANAGER], 'Overdue': [MANAGER], 'Void': [MANAGER] },
  'Overdue':        { 'Paid': [MANAGER], 'Partially Paid': [MANAGER], 'Void': [MANAGER] },
  'Paid':           {},
  'Void':           {},
}

export const ORDER_TRANSITIONS: TransitionMap = {
  'Draft':         { 'Confirmed': [SALES, MANAGER], 'Cancelled': [MANAGER] },
  'Confirmed':     { 'In Production': [PRODUCTION, MANAGER], 'Cancelled': [MANAGER] },
  'In Production': { 'QC': [PRODUCTION] },
  'QC':            { 'Ready to Ship': [PRODUCTION], 'In Production': [PRODUCTION] },
  'Ready to Ship': { 'Shipped': [PRODUCTION, MANAGER] },
  'Shipped':       { 'Delivered': [PRODUCTION, MANAGER] },
  'Delivered':     {},
  'Cancelled':     {},
}

export const PO_TRANSITIONS: TransitionMap = {
  'Draft':             { 'Pending Approval': [SALES, MANAGER], 'Sent': [MANAGER] },
  'Pending Approval':  { 'Approved': [MANAGER], 'Draft': [MANAGER] },
  'Approved':          { 'Sent': [MANAGER] },
  'Sent':              { 'Accepted': [MANAGER, SUPPLIER], 'Cancelled': [MANAGER] },
  'Accepted':          { 'In Production': [PRODUCTION, SUPPLIER], 'Cancelled': [MANAGER] },
  'In Production':     { 'Partially Received': [MANAGER, SUPPLIER], 'Shipped': [SUPPLIER] },
  'Partially Received':{ 'Received': [MANAGER] },
  'Shipped':           { 'Received': [MANAGER] },
  'Received':          { 'Closed': [MANAGER] },
  'Closed':            {},
  'Cancelled':         {},
}

export type EntityType = 'lead' | 'quotation' | 'invoice' | 'order' | 'po'

const ENTITY_MAPS: Record<EntityType, TransitionMap> = {
  lead:      LEAD_TRANSITIONS,
  quotation: QUOTE_TRANSITIONS,
  invoice:   INVOICE_TRANSITIONS,
  order:     ORDER_TRANSITIONS,
  po:        PO_TRANSITIONS,
}

/**
 * Returns the statuses the user can transition to from the current status.
 * Admin sees all valid edges; other roles see only their permitted edges.
 */
export function getValidTransitions(
  entityType: EntityType,
  current: string,
  userRole: UserRole
): string[] {
  const map = ENTITY_MAPS[entityType]
  if (!map || !map[current]) return []
  return Object.entries(map[current])
    .filter(([, roles]) => userRole === ADMIN || roles.includes(userRole))
    .map(([status]) => status)
}

/**
 * Returns true if the role may perform this transition.
 * Admin bypasses role checks but the edge must still exist.
 */
export function canTransition(
  entityType: EntityType,
  current: string,
  target: string,
  userRole: UserRole
): boolean {
  const map = ENTITY_MAPS[entityType]
  if (!map) return false
  const allowed = map[current]?.[target]
  if (allowed === undefined) return false
  if (userRole === ADMIN) return true
  return allowed.includes(userRole)
}

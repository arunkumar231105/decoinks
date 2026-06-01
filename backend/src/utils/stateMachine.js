'use strict'

// Role constants (match JWT payload values)
const ADMIN      = 'Admin'
const MANAGER    = 'Manager'
const SALES      = 'Sales'
const PRODUCTION = 'Production'
const SUPPLIER   = 'supplier'   // portal JWT role

// Transition map shape:
//   { [fromStatus]: { [toStatus]: string[] } }
// The string array lists roles that may perform this transition.
// Admin may always perform any transition (enforced in canTransition, not in the maps).

const LEAD_TRANSITIONS = {
  'New':          { 'Quotation': [SALES], 'Confirmed': [SALES] },
  'Quotation':    { 'Pending': [SALES], 'Confirmed': [SALES] },
  'Pending':      { 'Payment Sent': [SALES, MANAGER], 'Partial': [SALES, MANAGER] },
  'Payment Sent': { 'Confirmed': [SALES, MANAGER] },
  'Partial':      { 'Confirmed': [SALES, MANAGER] },
  'Confirmed':    {},
}

const QUOTE_TRANSITIONS = {
  'Draft':    { 'Sent': [SALES], 'Approved': [MANAGER], 'Rejected': [MANAGER], 'Expired': [MANAGER] },
  'Sent':     { 'Draft': [SALES], 'Approved': [MANAGER], 'Rejected': [MANAGER], 'Expired': [MANAGER] },
  'Approved': {},
  'Rejected': { 'Draft': [SALES] },
  'Expired':  { 'Draft': [SALES] },
}

const INVOICE_TRANSITIONS = {
  'Draft':          { 'Sent': [SALES, MANAGER], 'Void': [MANAGER] },
  'Sent':           { 'Paid': [MANAGER], 'Partially Paid': [MANAGER], 'Overdue': [MANAGER], 'Void': [MANAGER] },
  'Partially Paid': { 'Paid': [MANAGER], 'Overdue': [MANAGER], 'Void': [MANAGER] },
  'Overdue':        { 'Paid': [MANAGER], 'Partially Paid': [MANAGER], 'Void': [MANAGER] },
  'Paid':           {},
  'Void':           {},
}

const ORDER_TRANSITIONS = {
  'Draft':         { 'Confirmed': [SALES, MANAGER], 'Cancelled': [MANAGER] },
  'Confirmed':     { 'In Production': [PRODUCTION, MANAGER], 'Cancelled': [MANAGER] },
  'In Production': { 'QC': [PRODUCTION] },
  'QC':            { 'Ready to Ship': [PRODUCTION], 'In Production': [PRODUCTION] },
  'Ready to Ship': { 'Shipped': [PRODUCTION, MANAGER] },
  'Shipped':       { 'Delivered': [PRODUCTION, MANAGER] },
  'Delivered':     {},
  'Cancelled':     {},
}

const PO_TRANSITIONS = {
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

const ENTITY_MAPS = {
  lead:      LEAD_TRANSITIONS,
  quotation: QUOTE_TRANSITIONS,
  invoice:   INVOICE_TRANSITIONS,
  order:     ORDER_TRANSITIONS,
  po:        PO_TRANSITIONS,
}

/**
 * Returns true if the role may perform the transition.
 * Admin bypasses role restrictions but the edge must still exist in the map.
 */
function canTransition(entityType, current, target, userRole) {
  const map = ENTITY_MAPS[entityType]
  if (!map) return false
  const allowed = map[current]?.[target]
  if (allowed === undefined) return false   // edge doesn't exist — nobody can do it
  if (userRole === ADMIN) return true       // Admin bypasses role check, edge must exist
  return allowed.includes(userRole)
}

/**
 * Throws a structured error if the transition is not permitted.
 * Admin bypasses role restrictions but invalid edges still throw 422.
 * Pass user as { id, role }.
 */
function validateTransition(entityType, current, target, user) {
  const map = ENTITY_MAPS[entityType]
  if (!map) {
    const err = new Error(`Unknown entity type: ${entityType}`)
    err.status = 400
    throw err
  }

  const fromNode = map[current]
  if (!fromNode) {
    const err = new Error(`Unknown status '${current}' for ${entityType}`)
    err.status = 422
    throw err
  }

  const allowed = fromNode[target]
  if (allowed === undefined) {
    const err = new Error(`Invalid transition: ${current} → ${target}`)
    err.status = 422
    throw err
  }

  if (user.role !== ADMIN && !allowed.includes(user.role)) {
    const err = new Error(
      `Your role '${user.role}' is not permitted to change ${entityType} status from '${current}' to '${target}'`
    )
    err.status = 403
    throw err
  }
}

/**
 * Returns the list of statuses the user may transition to from the current status.
 */
function getValidTransitions(entityType, current, userRole) {
  const map = ENTITY_MAPS[entityType]
  if (!map || !map[current]) return []
  return Object.entries(map[current])
    .filter(([, roles]) => userRole === ADMIN || roles.includes(userRole))
    .map(([status]) => status)
}

module.exports = {
  canTransition,
  validateTransition,
  getValidTransitions,
  LEAD_TRANSITIONS,
  QUOTE_TRANSITIONS,
  INVOICE_TRANSITIONS,
  ORDER_TRANSITIONS,
  PO_TRANSITIONS,
}

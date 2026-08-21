/**
 * Locking for reconciled documents.
 *
 * A sales order or purchase order that has been reconciled against a source
 * sheet and signed off is sealed: its money, items, addresses and customer stop
 * being editable, so a later edit cannot silently undo the reconciliation.
 *
 * Locking is about the RECORD being final, not the job being finished, so it
 * deliberately does not block status transitions — an order locked today still
 * has to move In Production → Shipped → Delivered. Those go through
 * updateStatus() and the state machine, which this guard is not wired into.
 *
 * The check lives in the service layer because that is where every write
 * already passes; there is no database-level trigger, so a reviewed data script
 * can still correct a locked row deliberately.
 */

/**
 * Throw 423 Locked if the record is sealed.
 * @param {{locked_at?: Date|string|null}} record  the row as loaded by getById
 * @param {string} label                           what to call it in the message
 * @param {string} [reference]                     document number, for the message
 */
function assertNotLocked(record, label = 'record', reference = '') {
  if (!record || !record.locked_at) return
  const when = new Date(record.locked_at).toISOString().slice(0, 10)
  const name = reference ? `${label} ${reference}` : label
  throw Object.assign(
    new Error(`This ${name} was locked on ${when} and can no longer be edited. ` +
              `Unlock it first if the change is intended. Status changes are still allowed.`),
    { statusCode: 423 },
  )
}

const isLocked = record => Boolean(record && record.locked_at)

module.exports = { assertNotLocked, isLocked }

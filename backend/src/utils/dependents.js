/**
 * Deleting a document that something else was built from.
 *
 * A quote becomes an order becomes an invoice becomes a purchase order and a
 * shipment. Removing a link in that chain used to detach everything downstream
 * and destroy the row: the invoice survived but no longer knew which quote it
 * came from, and the quote itself was gone for good. Nothing said so.
 *
 * So: refuse, and say what is holding it. The caller decides what counts as a
 * dependent, because only the module knows which of its links are structural
 * and which are incidental.
 */

/** English, not a column list: "1 purchase order and 2 payments". */
function phrase(found) {
  const parts = found.map(({ label, count }) =>
    `${count} ${count === 1 ? label : label.endsWith('s') ? label : `${label}s`}`)
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Throws 409 naming everything that still points at this row.
 *
 * blockers: [{ table, column, label, softDeletes }] — softDeletes true when the
 * table has a deleted_at worth honouring, so an already-deleted dependent does
 * not block anything.
 */
async function assertNoDependents(client, id, blockers, { subject }) {
  const found = []
  for (const { table, column, label, softDeletes = true } of blockers) {
    const { rows } = await client.query(
      `SELECT count(*)::INT AS n FROM ${table}
        WHERE ${column} = $1 ${softDeletes ? 'AND deleted_at IS NULL' : ''}`, [id])
    if (rows[0].n > 0) found.push({ label, count: rows[0].n })
  }
  if (!found.length) return
  // "1 invoice still references it", but "2 invoices ... reference it".
  const one = found.length === 1 && found[0].count === 1
  throw Object.assign(
    new Error(`This ${subject} cannot be deleted — ${phrase(found)} still ` +
              `${one ? 'references' : 'reference'} it. ` +
              `Delete or detach ${one ? 'it' : 'those'} first.`),
    { statusCode: 409 })
}

/**
 * Marks the row deleted instead of destroying it. Returns false when there was
 * nothing live to delete, which the caller reports as 404 — so deleting twice
 * behaves the same as it always did.
 */
async function softDelete(client, table, id) {
  const { rows } = await client.query(
    `UPDATE ${table} SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id])
  return Boolean(rows[0])
}

module.exports = { assertNoDependents, softDelete }

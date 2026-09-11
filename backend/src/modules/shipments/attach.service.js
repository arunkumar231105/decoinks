'use strict'

const { getClient } = require('../../config/db')

/**
 * Put every loose parcel on the job it belongs to.
 *
 * A label is bought the day after the order as often as the same day, and the
 * courier's record arrives on its own schedule — so a shipment pulled from
 * Shippo frequently lands before anything can be matched to it, and used to
 * stay loose for ever because the only matching that existed ran once, at the
 * moment the row was created. This runs over every unattached shipment on
 * every sync instead, so a parcel joins its order as soon as both exist.
 *
 * The matching is deliberately timid. It attaches only when one order is the
 * obvious answer, and says why when it is not — a parcel on the wrong job is
 * worse than a parcel on none, because it moves someone else's tracking number
 * onto a customer's screen.
 */

// A parcel goes out after the order is raised, so the window is not symmetric.
// Measured against the 145 parcels already correctly attached: the median gap is
// the same day, 95% are within six days, and the furthest a shipment was ever
// recorded ahead of its order is seven — that happens when a label is entered
// before the paperwork catches up. Anything further back is a different job.
const DAYS_AFTER  = 21
const DAYS_BEFORE = 7

// Same normaliser on both sides of the comparison: accents folded, then every
// character that is not a letter or a digit removed — spaces included. A name
// reaches the shop as "Alhelí AR" on the order and "Alheli A.R." on the label,
// or "Mary-Jane" against "Mary Jane"; collapsing punctuation to a space would
// still leave those apart, so nothing but the letters is compared.
const NORMALISE = `
  regexp_replace(
    lower(translate($NAME$,
      'áàâäãéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
      'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
    '[^a-z0-9]', '', 'g')`

const normalised = expr => NORMALISE.replace('$NAME$', expr)

/**
 * @param {object} opts
 * @param {boolean} opts.apply  write the links (otherwise report only)
 * @param {string=} opts.shipmentId  restrict to one shipment
 * @returns {Promise<{attached: Array, skipped: Array}>}
 */
async function attachLooseShipments({ apply = false, shipmentId = null } = {}) {
  const client = await getClient()
  const attached = []
  const skipped = []
  try {
    await client.query('BEGIN')

    const { rows: loose } = await client.query(
      `SELECT id, shipment_number, tracking_number, carrier, ship_date,
              COALESCE(NULLIF(BTRIM(recipient_name), ''), NULLIF(BTRIM(customer_name), '')) AS who
         FROM shipments
        WHERE deleted_at IS NULL
          AND order_id IS NULL
          AND ($1::uuid IS NULL OR id = $1)
        ORDER BY ship_date NULLS LAST, shipment_number`,
      [shipmentId])

    for (const s of loose) {
      if (!s.who) { skipped.push({ ...s, why: 'no recipient name on the parcel' }); continue }
      if (!s.ship_date) { skipped.push({ ...s, why: 'no ship date to match against' }); continue }

      // Candidates: the same customer, an order raised near the ship date.
      // The customer's name is read from the customer record and from the
      // invoice, because an order carries no name of its own.
      const { rows: cand } = await client.query(
        `SELECT o.id, o.order_number, o.order_date,
                COALESCE(c.name, i.customer_name) AS customer,
                abs(o.order_date - $2::date) AS day_gap,
                EXISTS (SELECT 1 FROM shipments sh
                         WHERE sh.order_id = o.id AND sh.deleted_at IS NULL) AS already_shipped
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN invoices  i ON i.id = o.invoice_id
          WHERE o.deleted_at IS NULL
            AND o.order_date IS NOT NULL
            AND ($2::date - o.order_date) BETWEEN -($4::int) AND ($3::int)
            AND ${normalised('COALESCE(c.name, i.customer_name)')} = ${normalised('$1')}
          ORDER BY day_gap, o.order_number`,
        [s.who, s.ship_date, DAYS_AFTER, DAYS_BEFORE])

      if (!cand.length) {
        skipped.push({ ...s, why: `no order for "${s.who}" raised in the ${DAYS_BEFORE + DAYS_AFTER} days around this parcel` })
        continue
      }

      // An order that has no parcel yet is the better answer: a second parcel
      // on one order happens (a reprint, a short shipment made good), but a
      // waiting order is the far commoner case and the safer guess.
      const waiting = cand.filter(o => !o.already_shipped)
      const pool = waiting.length ? waiting : cand

      let chosen = null
      if (pool.length === 1) chosen = pool[0]
      else if (Number(pool[0].day_gap) < Number(pool[1].day_gap)) chosen = pool[0]

      if (!chosen) {
        skipped.push({ ...s, why: `${pool.length} orders fit equally well (${pool.slice(0, 3).map(o => o.order_number).join(', ')}) — needs a person` })
        continue
      }

      // The purchase orders this job was bought against are reported, not
      // written onto the parcel. chk_shipments_target_xor allows a shipment to
      // name an order or a purchase order, never both, and it is right to: a
      // PO shipment is the factory sending goods to the shop, an order shipment
      // is the shop sending them to the customer. They are different legs. The
      // PO screen reads its tracking through the order, which is why a parcel
      // attached here shows up on the purchase order as well.
      const { rows: pos } = await client.query(
        `SELECT po_number FROM purchase_orders
          WHERE order_id = $1 AND deleted_at IS NULL
          ORDER BY po_number`, [chosen.id])

      attached.push({
        shipment_number: s.shipment_number,
        tracking_number: s.tracking_number,
        carrier: s.carrier,
        ship_date: s.ship_date,
        who: s.who,
        order_number: chosen.order_number,
        day_gap: Number(chosen.day_gap),
        po_numbers: pos.map(p => p.po_number),
      })

      if (apply) {
        await client.query(
          `UPDATE shipments SET order_id = $2, updated_at = NOW() WHERE id = $1`,
          [s.id, chosen.id])
      }
    }

    if (apply) await client.query('COMMIT')
    else await client.query('ROLLBACK')
    return { attached, skipped }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { attachLooseShipments, DAYS_AFTER, DAYS_BEFORE }

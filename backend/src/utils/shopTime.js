/**
 * Shop time: the shop runs on Pakistan time.
 *
 * The server and the database clock run on UTC, five hours behind Pakistan.
 * Anything that decides "which day" something happened on — a payment's date,
 * a dashboard day — must use the Pakistan day, or everything between midnight
 * and 05:00 in Pakistan lands on the previous date (a Zelle at 10:00 on the
 * 16th was booked on the 15th; Stripe payments at 02:00–04:00 were a day early;
 * the dashboard's Daily leads read 11 where the CRM read 36).
 *
 * Use these helpers instead of toISOString().slice(0, 10) or CURRENT_DATE.
 * tests/unit/shop-time.test.js holds the rule in place.
 */

const SHOP_TZ = 'Asia/Karachi'   // UTC+5 all year — Pakistan has no daylight saving

/**
 * The calendar date (YYYY-MM-DD) in Pakistan at a given moment.
 * Accepts a Date, an ISO string or epoch ms; defaults to now. Returns null for
 * something that is not a moment.
 */
function shopDate(moment = new Date()) {
  const d = moment instanceof Date ? moment : new Date(moment)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-CA', { timeZone: SHOP_TZ })
}

/** SQL for "today in Pakistan", for queries that would otherwise say CURRENT_DATE. */
const SQL_SHOP_TODAY = `(NOW() AT TIME ZONE '${SHOP_TZ}')::date`

module.exports = { SHOP_TZ, shopDate, SQL_SHOP_TODAY }

/**
 * Server-to-server authentication for the CRM.
 *
 * The CRM's backend calls a handful of Printshop routes on an agent's behalf —
 * creating the customer and the quotation the agent filled in inside the chat.
 * The caller is a server, not a person with a staff login, so it cannot carry a
 * JWT. It proves itself with a shared secret instead.
 *
 * Deliberately NOT the SSO secret, which exists to prove a person signed in.
 * One credential granting two unrelated powers means rotating it for one reason
 * silently breaks the other. This is the same secret and the same header the
 * payment-link service routes already use, so the CRM needs one credential for
 * everything it asks of Printshop.
 */
function serviceAuth(req, res, next) {
  const expected = (process.env.SERVICE_API_SECRET || '').trim()
  if (!expected) return res.status(503).json({ error: 'Service access is not configured.' })
  const given = req.get('x-decoinks-sso-secret') || ''
  // Compare lengths first, then the whole string, so a wrong secret cannot be
  // narrowed down by timing the response.
  if (given.length !== expected.length || given !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

module.exports = { serviceAuth }

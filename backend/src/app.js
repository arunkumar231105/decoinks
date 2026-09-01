const express      = require('express')
const cors         = require('cors')
const helmet       = require('helmet')
const pinoHttp     = require('pino-http')
const cookieParser = require('cookie-parser')
const logger       = require('./utils/logger')
const errorHandler = require('./middleware/errorHandler')

const authRoutes    = require('./modules/auth/auth.routes')
const usersRoutes       = require('./modules/users/users.routes')
const permissionsRoutes = require('./modules/users/permissions.routes')
const supplierRoutes= require('./modules/suppliers/suppliers.routes')
const leadRoutes    = require('./modules/leads/leads.routes')
const quoteRoutes   = require('./modules/quotations/quotations.routes')
const orderRoutes   = require('./modules/orders/orders.routes')
const invoiceRoutes = require('./modules/invoices/invoices.routes')
const poRoutes      = require('./modules/purchase-orders/po.routes')
const shipRoutes    = require('./modules/shipments/shipments.routes')
const claimRoutes   = require('./modules/claims/claims.routes')
const refundRoutes  = require('./modules/refunds/refunds.routes')
const paymentRoutes = require('./modules/payments/payments.routes')
const productRoutes = require('./modules/products/products.routes')
const artworkRoutes = require('./modules/artworks/artworks.routes')
const dashRoutes    = require('./modules/dashboard/dashboard.routes')
const supplierPortalRoutes = require('./modules/supplier-portal/portal.routes')
const customerPortalRoutes = require('./modules/customer-portal/portal.routes')
const uploadRoutes         = require('./modules/upload/upload.routes')
const settingsRoutes       = require('./modules/settings/settings.routes')
const customerRoutes       = require('./modules/customers/customers.routes')
const searchRoutes         = require('./modules/search/search.routes')
const importRoutes         = require('./modules/import/import.routes')
const nextcloudRoutes      = require('./modules/nextcloud/nextcloud.routes')
const gdriveRoutes         = require('./modules/gdrive/gdrive.routes')
const stripeWebhookRoutes  = require('./modules/stripe/webhook.routes')
const payRoutes            = require('./modules/stripe/pay.routes')
const payLinkAdminRoutes   = require('./modules/stripe/paylinks.admin.routes')
const paypalRoutes         = require('./modules/paypal/paypal.routes')

const app = express()

// Behind nginx — trust one hop so req.ip is the real client IP (used for
// rate-limits, audit logs, and refresh_tokens.ip_address).
app.set('trust proxy', 1)

app.use(helmet())
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean)

/**
 * Is this request allowed to carry credentials?
 *
 * The same-origin case is the one that matters here and is easy to miss.
 * Browsers attach an `Origin` header to every POST, including a POST a page
 * makes to its own host — and each suite front-end proxies `/api/` to this
 * server under its own domain, so those requests are same-origin yet still
 * arrive with an Origin to be judged. When that domain is not in CORS_ORIGIN
 * the login is refused, which is exactly what happened to the Customer Portal
 * the moment it moved from http://<ip>:3002 (listed) to
 * https://customer.decoinkssuite.com (not listed): every sign-in failed, and
 * the screen reported it as "Invalid username or password".
 *
 * Comparing the origin's host to the request's own Host settles it properly,
 * without needing a new domain added to configuration each time one is
 * published.
 */
function originAllowed(origin, req) {
  if (!origin) return true                                     // curl / server-to-server
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true
  if (allowedOrigins.includes(origin)) return true
  try {
    // Same-origin: the page is asking its own host, so CORS is not in play.
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

// The delegate form, because the decision needs the request's Host. A refusal
// now simply withholds the header and lets the browser enforce it, rather than
// throwing — the thrown Error used to surface as a 500 "Unhandled error",
// which told nobody anything useful.
app.use(cors((req, cb) => cb(null, {
  origin: originAllowed(req.headers.origin, req),
  credentials: true,
})))
app.use(cookieParser())

// Ahead of the JSON parser on purpose. Stripe signs the exact bytes it sends,
// so a parsed body cannot be verified — every webhook would be rejected. This
// router applies express.raw() to itself; everything below still gets JSON.
app.use('/api/stripe/webhook', stripeWebhookRoutes)

app.use(express.json({ limit: '10mb' }))
app.use(pinoHttp({ logger }))
app.use('/uploads', express.static('uploads'))

app.use('/api/auth',           authRoutes)
app.use('/api/users',          usersRoutes)
app.use('/api/permissions',    permissionsRoutes)
app.use('/api/suppliers',      supplierRoutes)
app.use('/api/leads',          leadRoutes)
app.use('/api/quotations',     quoteRoutes)
app.use('/api/orders',         orderRoutes)
app.use('/api/invoices',       invoiceRoutes)
app.use('/api/purchase-orders',poRoutes)
app.use('/api/shipments',      shipRoutes)
app.use('/api/claims',         claimRoutes)
app.use('/api/refunds',        refundRoutes)
app.use('/api/payments',       paymentRoutes)
app.use('/api/products',       productRoutes)
app.use('/api/artworks',       artworkRoutes)
app.use('/api/dashboard',      dashRoutes)
app.use('/api/supplier',       supplierPortalRoutes)
app.use('/api/portal',         customerPortalRoutes)
app.use('/api/upload',       uploadRoutes)
app.use('/api/settings',     settingsRoutes)
app.use('/api/customers',    customerRoutes)
app.use('/api/search',       searchRoutes)
app.use('/api/import',       importRoutes)
app.use('/api/nextcloud',    nextcloudRoutes)
app.use('/api/drive',        gdriveRoutes)
app.use('/api/pay',          payRoutes)
app.use('/api/payment-links', payLinkAdminRoutes)
app.use('/api/paypal',       paypalRoutes)

// An unmatched /api route used to fall through to Express's own handler, which
// answers with an HTML page. The client reads HTML where JSON belongs as the
// single-sign-on wall — the only other thing that returns it — so a missing
// route told the user their session had ended and signed them out. Answer in
// JSON, as every other API response does, and it reads as the 404 it is.
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `No such endpoint: ${req.method} ${req.baseUrl}${req.path}`,
  })
})

app.use(errorHandler)

module.exports = app

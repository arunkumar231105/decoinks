const { Router } = require('express')
const { z } = require('zod')
const { verifyToken } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const controller = require('./payments.controller')
const { manualPaymentRules } = require('./payments.rules')

const router = Router()
router.use(verifyToken)

const STATUS = ['Completed', 'Pending', 'Failed', 'Refunded']

const paymentFields = {
  payment_date:   z.string().optional().nullable(),
  // Total money in from the customer. Shipping cost lives on the shipment now.
  amount:         z.coerce.number().positive('Amount must be greater than zero').optional(),
  // What the processor kept; net_amount is derived by the database.
  fee_amount:     z.coerce.number().min(0, 'Fee cannot be negative').optional(),
  transaction_id: z.string().max(64).optional().nullable(),
  payment_method: z.string().max(50).optional().nullable(),
  reference_no:   z.string().max(100).optional().nullable(),
  notes:          z.string().optional().nullable(),
  // Read whatever the case (35 older payments say "completed"); saved as the list spells it.
  status:         z.preprocess(
    v => (typeof v === 'string' ? STATUS.find(s => s.toLowerCase() === v.trim().toLowerCase()) ?? v : v),
    z.enum(STATUS, { errorMap: () => ({ message: 'Choose a status from the list' }) })).optional(),
  customer_id:    z.string().uuid().optional().nullable(),
  order_id:       z.string().uuid().optional().nullable(),
  invoice_id:     z.string().uuid().optional().nullable(),
  customer_name:  z.string().max(255).optional().nullable(),
  received_from_name:       z.string().max(160).optional().nullable(),
  received_into_account_id: z.string().uuid().optional().nullable(),
  sender_bank_name:         z.string().max(120).optional().nullable(),
  sender_account_name:      z.string().max(160).optional().nullable(),
  sender_account_last4:     z.string().regex(/^[0-9]{1,4}$/, 'Last 4 digits only').optional().nullable(),
  sender_reference:         z.string().max(120).optional().nullable(),
  // A payment may cover several orders — e.g. combined billing.
  allocations: z.array(z.object({
    order_id:         z.string().uuid().optional().nullable(),
    invoice_id:       z.string().uuid().optional().nullable(),
    allocated_amount: z.coerce.number().positive('Allocated amount must be greater than zero'),
    notes:            z.string().optional().nullable(),
  })).optional(),
}

const createSchema = z.object(paymentFields)
const updateSchema = z.object({
  ...Object.fromEntries(Object.entries(paymentFields).map(([k, v]) => [k, v.optional()])),
})

router.get('/',        controller.list)
router.get('/stats',   controller.stats)
router.get('/filters', controller.filters)
router.get('/export',  controller.exportCsv)
router.get('/:id',     controller.getOne)

// The payment form's own rules (payments.rules.js). Payments the system records
// itself — Stripe, PayPal, an invoice's Record Payment — do not come this way.
router.post('/',       validate(createSchema), manualPaymentRules(), controller.create)
router.put('/:id',     validate(updateSchema), manualPaymentRules(), controller.update)
router.delete('/:id',  controller.remove)
router.post('/bulk-delete', validate(z.object({ ids: z.array(z.string().uuid()).min(1) })), controller.bulkRemove)

module.exports = router

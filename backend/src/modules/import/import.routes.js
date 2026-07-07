const { Router } = require('express')
const multer = require('multer')
const os = require('os')
const fs = require('fs')
const { verifyToken } = require('../../middleware/auth')
const { success } = require('../../utils/response')
const { aiClassifyCsv } = require('../../utils/aiCsv')

const uploadCsv = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, os.tmpdir()),
    filename: (_r, file, cb) => cb(null, `import_${Date.now()}_${file.originalname}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_r, file, cb) => {
    const ok = file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.csv')
    ok ? cb(null, true) : cb(new Error('Only .csv files are allowed'), false)
  },
})

const router = Router()
router.use(verifyToken)

// Which modules currently have a working bulk importer.
const SUPPORTED = { quote: true, order: true, purchase_order: false, invoice: false }
const ROUTE_FOR = { quote: '/quotes', order: '/orders' }

// POST /api/import/analyze — AI looks at the file and says what it is.
router.post('/analyze', uploadCsv, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded' })
    const text = fs.readFileSync(req.file.path, 'utf8')
    fs.unlink(req.file.path, () => {})

    const { target, order_type, reason } = await aiClassifyCsv(text)
    return success(res, {
      target,
      order_type,
      reason,
      supported: !!SUPPORTED[target],
      // Where the client should send the file for the actual AI import.
      import_path: target === 'order' ? '/orders/bulk-upload' : '/quotations/bulk-upload',
      module_route: ROUTE_FOR[target] || '/quotes',
    })
  } catch (err) { next(err) }
})

module.exports = router

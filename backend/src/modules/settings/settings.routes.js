const { Router } = require('express')
const { verifyToken, requireRole } = require('../../middleware/auth')
const db = require('../../config/db')

const router = Router()
router.use(verifyToken)

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT key, value FROM settings ORDER BY key')
    const obj = {}
    rows.forEach(r => { obj[r.key] = r.value })
    res.json({ settings: obj })
  } catch (err) { next(err) }
})

router.put('/', requireRole('Admin', 'Manager'), async (req, res, next) => {
  try {
    const updates = req.body
    for (const [key, value] of Object.entries(updates)) {
      await db.query(
        `INSERT INTO settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
        [key, value === null ? null : String(value), req.user.id]
      )
    }
    const { rows } = await db.query('SELECT key, value FROM settings ORDER BY key')
    const obj = {}
    rows.forEach(r => { obj[r.key] = r.value })
    res.json({ success: true, settings: obj })
  } catch (err) { next(err) }
})

module.exports = router

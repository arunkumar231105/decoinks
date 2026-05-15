'use strict'

const { Router } = require('express')
const { z } = require('zod')
const { verifyToken, requireRole } = require('../../middleware/auth')
const { validate } = require('../../middleware/validate')
const { query } = require('../../config/db')
const { success } = require('../../utils/response')

const router = Router()
router.use(verifyToken)

const ROLES   = ['Admin', 'Manager', 'Sales', 'Production', 'Viewer']
const MODULES = ['Dashboard', 'Leads', 'Quotes', 'Orders', 'Design Board', 'Fulfillment', 'Finance', 'Reports', 'Settings']
const ACCESS  = ['Full', 'Edit', 'View', 'None']

// Default permissions (fallback when DB has no entry)
const DEFAULTS = {
  Admin:      ['Full','Full','Full','Full','Full', 'Full', 'Full','Full','Full'],
  Manager:    ['Full','Full','Full','Full','Edit', 'Full', 'View','Full','View'],
  Sales:      ['View','Full','Full','Edit','View', 'View', 'None','View','None'],
  Production: ['View','View','View','View','Full', 'Full', 'None','View','None'],
  Viewer:     ['View','None','View','View','View', 'View', 'None','View','None'],
}

// GET /api/permissions  — returns all role permissions
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT role, module, access FROM role_permissions`)

    // Build map from DB
    const map = {}
    for (const row of rows) {
      if (!map[row.role]) map[row.role] = {}
      map[row.role][row.module] = row.access
    }

    // Merge with defaults for any missing entries
    const result = {}
    for (const role of ROLES) {
      result[role] = MODULES.map((mod, i) => {
        return map[role]?.[mod] ?? DEFAULTS[role][i]
      })
    }

    return success(res, { roles: ROLES, modules: MODULES, permissions: result })
  } catch (err) { next(err) }
})

// PUT /api/permissions  — Admin saves full permission matrix
router.put('/', requireRole('Admin'), validate(z.object({
  permissions: z.record(z.string(), z.array(z.enum(['Full','Edit','View','None']))),
})), async (req, res, next) => {
  try {
    const { permissions } = req.body
    const values = []
    const params = []

    for (const role of ROLES) {
      if (!permissions[role]) continue
      for (let i = 0; i < MODULES.length; i++) {
        const access = permissions[role][i]
        if (!access || !ACCESS.includes(access)) continue
        params.push(role, MODULES[i], access)
        values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`)
      }
    }

    if (values.length) {
      await query(`
        INSERT INTO role_permissions (role, module, access)
        VALUES ${values.join(', ')}
        ON CONFLICT (role, module) DO UPDATE SET access = EXCLUDED.access, updated_at = NOW()
      `, params)
    }

    return success(res, null, 'Permissions saved')
  } catch (err) { next(err) }
})

module.exports = router

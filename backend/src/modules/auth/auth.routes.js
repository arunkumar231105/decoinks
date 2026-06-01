const { Router } = require('express')
const { z }      = require('zod')
const { validate }    = require('../../middleware/validate')
const { verifyToken } = require('../../middleware/auth')
const controller      = require('./auth.controller')

const router = Router()

const loginSchema = z.object({
  email:    z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
})

const setupSchema = z.object({
  name:     z.string().min(2, 'Name must be at least 2 characters'),
  email:    z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password:     z.string().min(8, 'New password must be at least 8 characters'),
})

router.get ('/setup-status',                                                   controller.setupStatus)
router.post('/setup',            validate(setupSchema),                        controller.setup)
router.post('/login',            validate(loginSchema),                        controller.login)
router.post('/refresh',                                                        controller.refresh)   // reads httpOnly cookie
router.get ('/me',               verifyToken,                                  controller.getMe)
router.post('/logout',                                                         controller.logout)    // cookie-based, no token needed
router.post('/logout-everywhere',verifyToken,                                  controller.logoutEverywhere)
router.post('/change-password',  verifyToken, validate(changePasswordSchema),  controller.changePassword)

module.exports = router

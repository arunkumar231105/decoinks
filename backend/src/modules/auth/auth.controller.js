const authService = require('./auth.service')
const { success } = require('../../utils/response')

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

function setRefreshCookie(res, token) {
  res.cookie(authService.COOKIE_NAME, token, {
    httpOnly: true,
    // Use Secure flag only when explicitly enabled via env var.
    // Do NOT tie to NODE_ENV=production — many production deployments run
    // behind an HTTP reverse proxy and setting Secure on HTTP breaks refresh.
    secure:   process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge:   COOKIE_MAX_AGE_MS,
    path:     '/',   // send on ALL requests so new-tab print pages can refresh
  })
}

function clearRefreshCookie(res) {
  res.clearCookie(authService.COOKIE_NAME, { path: '/' })
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body
    const result = await authService.login(email, password, req.ip, req.headers['user-agent'])
    setRefreshCookie(res, result.refreshToken)
    return success(res, { token: result.accessToken, user: result.user }, 'Login successful')
  } catch (err) {
    next(err)
  }
}

async function getMe(req, res, next) {
  try {
    const user = await authService.getMe(req.user.id)
    return success(res, user)
  } catch (err) {
    next(err)
  }
}

async function refresh(req, res, next) {
  try {
    const rawToken = req.cookies?.[authService.COOKIE_NAME]
    const result = await authService.refresh(rawToken, req.ip, req.headers['user-agent'])
    setRefreshCookie(res, result.refreshToken)
    return success(res, { token: result.accessToken, user: result.user }, 'Token refreshed')
  } catch (err) {
    // Clear cookie on any refresh failure so the client stops retrying with a bad token
    clearRefreshCookie(res)
    next(err)
  }
}

async function logout(req, res, next) {
  try {
    const rawToken = req.cookies?.[authService.COOKIE_NAME]
    await authService.logout(rawToken)
    clearRefreshCookie(res)
    return success(res, null, 'Logged out successfully')
  } catch (err) {
    next(err)
  }
}

async function logoutEverywhere(req, res, next) {
  try {
    await authService.revokeAll(req.user.id)
    clearRefreshCookie(res)
    return success(res, null, 'Logged out from all devices')
  } catch (err) {
    next(err)
  }
}

async function setupStatus(req, res, next) {
  try {
    const status = await authService.setupStatus()
    return success(res, status)
  } catch (err) {
    next(err)
  }
}

async function setup(req, res, next) {
  try {
    const result = await authService.setup(req.body)
    setRefreshCookie(res, result.refreshToken)
    return success(res, { token: result.accessToken, user: result.user }, 'Admin account created', 201)
  } catch (err) {
    next(err)
  }
}

async function changePassword(req, res, next) {
  try {
    const { current_password, new_password } = req.body
    await authService.changePassword(req.user.id, current_password, new_password)
    // Revoke all refresh tokens on password change — force re-login everywhere
    await authService.revokeAll(req.user.id)
    clearRefreshCookie(res)
    return success(res, null, 'Password changed successfully. Please log in again.')
  } catch (err) {
    next(err)
  }
}

module.exports = { login, refresh, logout, logoutEverywhere, getMe, setupStatus, setup, changePassword }

const authService = require('./auth.service')
const { success, error } = require('../../utils/response')

async function login(req, res, next) {
  try {
    const { email, password } = req.body
    const result = await authService.login(email, password)
    return success(res, result, 'Login successful')
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
    const result = await authService.refresh(req.body.token)
    return success(res, result, 'Token refreshed')
  } catch (err) {
    next(err)
  }
}

async function logout(req, res) {
  return success(res, null, 'Logged out successfully')
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
    return success(res, result, 'Admin account created', 201)
  } catch (err) {
    next(err)
  }
}

async function changePassword(req, res, next) {
  try {
    const { current_password, new_password } = req.body
    await authService.changePassword(req.user.id, current_password, new_password)
    return success(res, null, 'Password changed successfully')
  } catch (err) {
    next(err)
  }
}

module.exports = { login, refresh, getMe, logout, setupStatus, setup, changePassword }

const router       = require('express').Router();
const supplierAuth = require('../../middleware/supplierAuth');
const ctrl         = require('./portal.controller');

// ── Public routes (no auth) ───────────────────────────────────────────────────
router.post('/auth/login',   ctrl.login);
router.post('/auth/refresh', ctrl.refreshToken);

// ── Protected routes (supplier JWT required) ──────────────────────────────────
router.use(supplierAuth);

router.get('/me',                       ctrl.getProfile);
router.patch('/me/password',            ctrl.changePassword);

router.get('/dashboard',                ctrl.getDashboard);

router.get('/orders',                   ctrl.getOrders);
router.get('/orders/:id',               ctrl.getOrderDetail);
router.post('/orders/:id/status-updates', ctrl.submitStatusUpdate);
router.get('/orders/:id/status-updates',  ctrl.getStatusUpdates);

router.get('/purchase-orders',              ctrl.getPurchaseOrders);
router.get('/purchase-orders/:id',          ctrl.getPODetail);
router.patch('/purchase-orders/:id/status', ctrl.updatePOStatus);
router.post('/purchase-orders/:id/tracking',ctrl.addTracking);

router.get('/artworks',                 ctrl.getArtworks);

router.get('/notifications',            ctrl.getNotifications);
router.patch('/notifications/:id/read', ctrl.markRead);

module.exports = router;

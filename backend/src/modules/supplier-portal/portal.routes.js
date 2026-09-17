const router       = require('express').Router();
const supplierAuth = require('../../middleware/supplierAuth');
const ctrl         = require('./portal.controller');
const fulfillment  = require('./portal.fulfillment.controller');
const { scopeId }  = require('./portal.scope');

// Which supplier a login speaks for — or null for the company login, which sees
// every supplier's purchase orders (portal.scope.js). Services read req.scopeId.
const withScope = (req, res, next) => {
  try { req.scopeId = scopeId(req); next(); }
  catch (e) { res.status(e.status || 403).json({ error: e.message }); }
};

// ── Public routes (no auth) ───────────────────────────────────────────────────
router.post('/auth/login',   ctrl.login);
router.post('/auth/refresh', ctrl.refreshToken);

// ── Vault artwork bytes ───────────────────────────────────────────────────────
// An <img> cannot send an Authorization header, so these accept the same token
// as ?t= — verified by the same supplierAuth, and the file is scoped to the
// supplier's shared customers in the service.
const tokenFromQuery = (req, _res, next) => {
  if (!req.headers.authorization && typeof req.query.t === 'string') {
    req.headers.authorization = `Bearer ${req.query.t}`;
  }
  next();
};
router.get('/vault/:id/preview', tokenFromQuery, supplierAuth, withScope, ctrl.vaultAsset('preview'));
router.get('/vault/:id/file',    tokenFromQuery, supplierAuth, withScope, ctrl.vaultAsset('file'));

// ── Protected routes (supplier JWT required) ──────────────────────────────────
router.use(supplierAuth);
router.use(withScope);

router.get('/me',                       ctrl.getProfile);
router.patch('/me/password',            ctrl.changePassword);

router.get('/dashboard',                ctrl.getDashboard);

router.get('/orders',                   ctrl.getOrders);
router.get('/orders/:id',               ctrl.getOrderDetail);
router.post('/orders/:id/status-updates', ctrl.submitStatusUpdate);
router.get('/orders/:id/status-updates',  ctrl.getStatusUpdates);

// Supplier Order Management grid, stages and factories (portal.fulfillment.js).
// Declared before /purchase-orders/:id so "order-grid" is never read as an id.
router.get('/purchase-orders/order-grid',    fulfillment.getOrderGrid);
router.get('/purchase-orders/:id/stage',     fulfillment.getOrderRow);
router.patch('/purchase-orders/:id/stage',   fulfillment.updateOrderStage);
router.get('/products',                      fulfillment.getProducts);
router.get('/factories',                     fulfillment.listFactories);
router.post('/factories',                    fulfillment.createFactory);
router.patch('/factories/:id',               fulfillment.updateFactory);

router.get('/purchase-orders',              ctrl.getPurchaseOrders);
router.get('/purchase-orders/:id',          ctrl.getPODetail);
router.patch('/purchase-orders/:id/status', ctrl.updatePOStatus);
router.post('/purchase-orders/:id/tracking',ctrl.addTracking);

router.get('/artworks',                 ctrl.getArtworks);

router.get('/notifications',            ctrl.getNotifications);
router.patch('/notifications/:id/read', ctrl.markRead);

module.exports = router;

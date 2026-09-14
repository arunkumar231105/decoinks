const svc = require('./portal.service');

// ── Auth ──────────────────────────────────────────────────────────────────────

exports.refreshToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'supplier') return res.status(403).json({ error: 'Not a supplier token' });
    const newToken = jwt.sign(
      { supplierId: decoded.supplierId, portalUserId: decoded.portalUserId,
        username: decoded.username, role: 'supplier' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_SUPPLIER_EXPIRY || '7d' }
    );
    res.json({ token: newToken });
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    const loginId = String(username ?? '').trim();
    if (!loginId || !password)
      return res.status(400).json({ error: 'Username and password are required' });
    const result = await svc.loginSupplier(loginId, password);
    res.json(result);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
  try {
    const data = await svc.getDashboard(req.supplier.supplierId);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ── Orders ────────────────────────────────────────────────────────────────────

exports.getOrders = async (req, res) => {
  try {
    const result = await svc.getSupplierOrders(req.supplier.supplierId, req.query);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getOrderDetail = async (req, res) => {
  try {
    const order = await svc.getSupplierOrderDetail(req.supplier.supplierId, req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found or not shared with you' });
    res.json({ order });
  } catch (e) {
    if (e.status === 403) return res.status(403).json({ error: 'Access denied' });
    res.status(500).json({ error: e.message });
  }
};

// ── Purchase Orders ───────────────────────────────────────────────────────────

exports.getPurchaseOrders = async (req, res) => {
  try {
    const result = await svc.getSupplierPOs(req.supplier.supplierId, req.query);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getPODetail = async (req, res) => {
  try {
    const po = await svc.getSupplierPODetail(req.supplier.supplierId, req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase order not found or not shared with you' });
    res.json({ po });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ── Artworks ──────────────────────────────────────────────────────────────────

exports.getArtworks = async (req, res) => {
  try {
    const artworks = await svc.getSupplierArtworks(req.supplier.supplierId);
    res.json({ artworks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ── Vault artwork bytes ───────────────────────────────────────────────────────

/**
 * A vault image, proxied from Nextcloud. The path is never taken from the
 * request — only an asset id, looked up against the supplier's shared customers.
 * Previews are shrunk here so a gallery costs kilobytes; Nextcloud being slow or
 * down is a 502 the portal shows as a placeholder, never a broken page.
 */
exports.vaultAsset = (kind) => async (req, res) => {
  try {
    const asset = await svc.getVaultAssetForSupplier(req.supplier.supplierId, req.params.id);
    if (!asset) return res.status(404).json({ error: 'Artwork not found' });

    const nc = require('../nextcloud/nextcloud.service');
    const ncRes = kind === 'preview'
      ? await nc.getPreview(asset.path, { width: 600, height: 600 })
      : await nc.downloadFile(asset.path);
    if (ncRes && ncRes.ok === false) {
      return res.status(502).json({ error: 'The artwork store did not return this file' });
    }
    const raw = Buffer.from(await ncRes.arrayBuffer());

    if (kind === 'file') {
      const name = String(asset.file_name || 'artwork').replace(/["\r\n]/g, '');
      res.setHeader('Content-Type', ncRes.headers.get('content-type') || asset.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${name}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.send(raw);
    }

    const size = Math.min(Math.max(Number(req.query.w) || 480, 64), 1600);
    try {
      const thumb = await require('sharp')(raw)
        .rotate()
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.send(thumb);
    } catch {
      res.setHeader('Content-Type', ncRes.headers.get('content-type') || asset.mime_type || 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.send(raw);
    }
  } catch (e) {
    console.error('[portal] vault artwork could not be served:', e.message);
    res.status(502).json({ error: 'Artwork could not be loaded right now' });
  }
};

// ── Notifications ─────────────────────────────────────────────────────────────

exports.getNotifications = async (req, res) => {
  try {
    const notifications = await svc.getNotifications(req.supplier.supplierId);
    res.json({ notifications });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.markRead = async (req, res) => {
  try {
    await svc.markNotificationRead(req.supplier.supplierId, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ── Profile ───────────────────────────────────────────────────────────────────

exports.getProfile = async (req, res) => {
  try {
    const supplier = await svc.getProfile(req.supplier.supplierId);
    res.json({ supplier });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    if (newPassword.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    await svc.changePassword(req.supplier.portalUserId, currentPassword, newPassword);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// ── PO Status Update ─────────────────────────────────────────────────────────

exports.updatePOStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    const result = await svc.updatePOStatus(req.supplier.supplierId, req.params.id, status);
    res.json({ success: true, ...result });
  } catch (e) {
    const code = e.status === 403 ? 403 : e.status === 404 ? 404 : e.status === 422 ? 422 : 500;
    res.status(code).json({ error: e.message });
  }
};

exports.addTracking = async (req, res) => {
  try {
    const { tracking_number, carrier, tracking_notes } = req.body;
    if (!tracking_number) return res.status(400).json({ error: 'tracking_number is required' });
    const result = await svc.addTracking(req.supplier.supplierId, req.params.id, { tracking_number, carrier, tracking_notes });
    res.json({ success: true, ...result });
  } catch (e) {
    const code = e.status === 403 ? 403 : e.status === 404 ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
};

// ── Status Updates ────────────────────────────────────────────────────────────

exports.submitStatusUpdate = async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    const update = await svc.submitStatusUpdate(req.supplier.supplierId, req.params.id, { status, notes });
    res.json({ update });
  } catch (e) {
    if (e.status === 403) return res.status(403).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
};

exports.getStatusUpdates = async (req, res) => {
  try {
    const updates = await svc.getStatusUpdates(req.supplier.supplierId, req.params.id);
    res.json({ updates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

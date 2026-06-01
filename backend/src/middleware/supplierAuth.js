const jwt = require('jsonwebtoken');

function supplierAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'supplier') {
      return res.status(403).json({ error: 'Not a supplier token' });
    }
    req.supplier = decoded; // { supplierId, portalUserId, username, role }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = supplierAuth;

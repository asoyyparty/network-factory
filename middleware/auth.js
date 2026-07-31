const jwt = require('jsonwebtoken');

/**
 * Middleware autentikasi JWT.
 * Membaca header Authorization: Bearer <token>
 * dan menyuntikkan req.user jika token valid.
 */
module.exports = function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Token tidak ditemukan' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, role, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: Token sudah kadaluarsa, silakan login ulang' });
    }
    return res.status(401).json({ error: 'Unauthorized: Token tidak valid' });
  }
};

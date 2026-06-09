const prisma = require('../utils/db');
const { SESSION_COOKIE, parseCookies, hashToken } = require('../utils/security');

async function optionalAuth(req, _res, next) {
  try {
    const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
    if (!token) return next();
    const authSession = await prisma.authSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { settings: true } } }
    });
    if (authSession && authSession.expiresAt > new Date() && authSession.user.isActive) {
      req.user = authSession.user;
      req.authSession = authSession;
    }
  } catch {
    // Requests without a valid session remain anonymous.
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Akses superadmin diperlukan' });
  }
  next();
}

module.exports = { optionalAuth, requireAuth, requireSuperAdmin };

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const prisma = require('./utils/db');
const logger = require('./utils/logger');
const { router: webhookRouter } = require('./routes/webhook');
const { startScheduler } = require('./services/scheduler');
const { optionalAuth, requireAuth, requireSuperAdmin } = require('./middleware/auth');
const {
  hashPassword, verifyPassword, randomToken, hashToken, sessionCookie, clearSessionCookie,
  encryptSecret, maskSecret, SESSION_DAYS
} = require('./utils/security');
const { getRuntimeSettings } = require('./utils/settings');
const starsender = require('./services/starsender');
const gemini = require('./services/gemini');
const knowledge = require('./services/knowledge');
const { getAllSessions, setHumanMode, addOutgoingLog } = require('./utils/session');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const groupCache = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ limit: '8mb', extended: true }));
app.use(optionalAuth);
app.use('/webhook', webhookRouter);
app.use(express.static(PUBLIC_DIR, {
  maxAge: 0,
  etag: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate')
}));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function publicSettings(settings, req) {
  const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return {
    storeName: settings.storeName,
    botName: settings.botName,
    geminiModel: settings.geminiModel,
    adminNotificationPhone: settings.adminNotificationPhone || '',
    operationalStart: settings.operationalStart,
    operationalEnd: settings.operationalEnd,
    timezone: settings.timezone,
    aiEnabled: settings.aiEnabled,
    autoReplyEnabled: settings.autoReplyEnabled,
    starsenderConfigured: Boolean(settings.starsenderApiKey),
    geminiConfigured: Boolean(settings.geminiApiKey),
    starsenderApiKeyMasked: maskSecret(settings.starsenderApiKey ? require('./utils/security').decryptSecret(settings.starsenderApiKey) : ''),
    geminiApiKeyMasked: maskSecret(settings.geminiApiKey ? require('./utils/security').decryptSecret(settings.geminiApiKey) : ''),
    webhookUrl: `${baseUrl}/webhook/${settings.webhookToken}`
  };
}

async function ensureAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email || !password) return;
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: process.env.ADMIN_NAME || 'Ruank Admin',
        role: 'superadmin',
        passwordHash: hashPassword(password)
      }
    });
  }
  await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      storeName: process.env.STORE_NAME || 'Ruank WhatsApp',
      botName: process.env.BOT_NAME || 'Ruank Assistant',
      webhookToken: randomToken(20),
      starsenderApiKey: process.env.STARSENDER_API_KEY ? encryptSecret(process.env.STARSENDER_API_KEY) : null,
      geminiApiKey: process.env.GEMINI_API_KEY ? encryptSecret(process.env.GEMINI_API_KEY) : null,
      operationalStart: process.env.ADMIN_OPERATIONAL_START || '08:00',
      operationalEnd: process.env.ADMIN_OPERATIONAL_END || '22:00'
    }
  });
  return user;
}

app.get('/health', asyncRoute(async (_req, res) => {
  await prisma.user.count();
  res.json({ status: 'online', service: 'ruank-wa-automation', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  const user = await prisma.user.findUnique({ where: { email }, include: { settings: true } });
  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email atau password salah' });
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await prisma.authSession.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } });
  res.setHeader('Set-Cookie', sessionCookie(token, expiresAt));
  res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}));

app.post('/api/auth/logout', requireAuth, asyncRoute(async (req, res) => {
  await prisma.authSession.delete({ where: { id: req.authSession.id } }).catch(() => {});
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ success: true });
}));

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role } });
});

app.get('/api/users', requireSuperAdmin, asyncRoute(async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json({ users });
}));

app.post('/api/users', requireSuperAdmin, asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const name = cleanText(req.body.name, 100);
  const password = String(req.body.password || '');
  if (!email.includes('@') || name.length < 2 || password.length < 8) {
    return res.status(400).json({ error: 'Nama, email valid, dan password minimal 8 karakter wajib diisi' });
  }
  const user = await prisma.user.create({
    data: {
      email, name, passwordHash: hashPassword(password), role: req.body.role === 'superadmin' ? 'superadmin' : 'admin',
      settings: { create: { webhookToken: randomToken(20), storeName: `${name} Workspace`, botName: `${name} Assistant` } }
    },
    select: { id: true, email: true, name: true, role: true, isActive: true }
  });
  res.status(201).json({ user });
}));

app.patch('/api/users/:id', requireSuperAdmin, asyncRoute(async (req, res) => {
  const data = {};
  if (typeof req.body.isActive === 'boolean') data.isActive = req.body.isActive;
  if (req.body.password) {
    if (String(req.body.password).length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter' });
    data.passwordHash = hashPassword(String(req.body.password));
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: { id: true, email: true, name: true, role: true, isActive: true }
  });
  res.json({ user });
}));

app.get('/api/settings', requireAuth, (req, res) => res.json({ settings: publicSettings(req.user.settings, req) }));

app.put('/api/settings', requireAuth, asyncRoute(async (req, res) => {
  const current = req.user.settings;
  const update = {
    storeName: cleanText(req.body.storeName, 100) || current.storeName,
    botName: cleanText(req.body.botName, 100) || current.botName,
    geminiModel: cleanText(req.body.geminiModel, 100) || current.geminiModel,
    adminNotificationPhone: cleanText(req.body.adminNotificationPhone, 30) || null,
    operationalStart: /^\d{2}:\d{2}$/.test(req.body.operationalStart) ? req.body.operationalStart : current.operationalStart,
    operationalEnd: /^\d{2}:\d{2}$/.test(req.body.operationalEnd) ? req.body.operationalEnd : current.operationalEnd,
    timezone: cleanText(req.body.timezone, 80) || current.timezone,
    aiEnabled: typeof req.body.aiEnabled === 'boolean' ? req.body.aiEnabled : current.aiEnabled,
    autoReplyEnabled: typeof req.body.autoReplyEnabled === 'boolean'
      ? req.body.autoReplyEnabled
      : current.autoReplyEnabled
  };
  if (req.body.starsenderApiKey) update.starsenderApiKey = encryptSecret(cleanText(req.body.starsenderApiKey, 500));
  if (req.body.geminiApiKey) update.geminiApiKey = encryptSecret(cleanText(req.body.geminiApiKey, 500));
  const settings = await prisma.userSettings.update({ where: { userId: req.user.id }, data: update });
  res.json({ success: true, settings: publicSettings(settings, req) });
}));

app.post('/api/settings/rotate-webhook', requireAuth, asyncRoute(async (req, res) => {
  const settings = await prisma.userSettings.update({
    where: { userId: req.user.id },
    data: { webhookToken: randomToken(20) }
  });
  res.json({ settings: publicSettings(settings, req) });
}));

app.post('/api/settings/test', requireAuth, asyncRoute(async (req, res) => {
  const settings = await getRuntimeSettings(req.user.id);
  const [wa, ai] = await Promise.all([
    settings.starsenderApiKey ? starsender.testConnection(settings.starsenderApiKey).catch((error) => ({ ok: false, message: error.message })) : { ok: false, message: 'API key belum diisi' },
    settings.geminiApiKey ? gemini.testConnection(settings.geminiApiKey, settings.geminiModel) : { ok: false, message: 'API key belum diisi' }
  ]);
  res.json({ database: { ok: true }, starsender: wa, gemini: ai });
}));

app.get('/api/dashboard', requireAuth, asyncRoute(async (req, res) => {
  const userId = req.user.id;
  const [sessions, messagesToday, waitingAdmin, broadcasts, recent] = await Promise.all([
    prisma.session.count({ where: { userId, archived: false } }),
    prisma.message.count({ where: { userId, timestamp: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    prisma.message.count({ where: { userId, status: 'waiting_admin' } }),
    prisma.broadcast.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
    prisma.message.findMany({ where: { userId }, orderBy: { timestamp: 'desc' }, take: 8 })
  ]);
  res.json({ sessions, messagesToday, waitingAdmin, broadcasts, recent });
}));

app.get('/api/conversations', requireAuth, asyncRoute(async (req, res) => {
  const sessions = await getAllSessions(req.user.id, {
    archived: req.query.archived === 'true',
    search: cleanText(req.query.search, 100)
  });
  res.json({ sessions });
}));

app.get('/api/conversations/:phone/messages', requireAuth, asyncRoute(async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { userId: req.user.id, fromPhone: req.params.phone },
    orderBy: { timestamp: 'asc' },
    take: 300
  });
  await prisma.session.updateMany({
    where: { userId: req.user.id, phoneNumber: req.params.phone },
    data: { unreadCount: 0 }
  });
  res.json({ messages });
}));

app.post('/api/conversations/:phone/send', requireAuth, asyncRoute(async (req, res) => {
  const message = cleanText(req.body.message, 4000);
  if (!message) return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
  const settings = await getRuntimeSettings(req.user.id);
  await starsender.sendMessage(settings.starsenderApiKey, req.params.phone, message);
  const saved = await addOutgoingLog(req.user.id, req.params.phone, message, true);
  await setHumanMode(req.user.id, req.params.phone, true);
  res.json({ success: true, message: saved });
}));

app.post('/api/conversations/:phone/mode', requireAuth, asyncRoute(async (req, res) => {
  const humanMode = Boolean(req.body.humanMode);
  await setHumanMode(req.user.id, req.params.phone, humanMode);
  res.json({ success: true, humanMode });
}));

app.patch('/api/conversations/:phone', requireAuth, asyncRoute(async (req, res) => {
  const session = await prisma.session.update({
    where: { userId_phoneNumber: { userId: req.user.id, phoneNumber: req.params.phone } },
    data: {
      ...(typeof req.body.archived === 'boolean' ? { archived: req.body.archived } : {}),
      ...(req.body.displayName !== undefined ? { displayName: cleanText(req.body.displayName, 100) || null } : {})
    }
  });
  res.json({ session });
}));

app.get('/api/groups', requireAuth, asyncRoute(async (req, res) => {
  const cached = groupCache.get(req.user.id);
  if (cached && Date.now() - cached.at < 30000 && req.query.refresh !== 'true') return res.json({ groups: cached.groups, cached: true });
  const settings = await getRuntimeSettings(req.user.id);
  const groups = await starsender.getGroups(settings.starsenderApiKey);
  groupCache.set(req.user.id, { groups, at: Date.now() });
  res.json({ groups, cached: false });
}));

app.post('/api/groups/:groupId/send', requireAuth, asyncRoute(async (req, res) => {
  const message = cleanText(req.body.message, 4000);
  if (!message) return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
  const settings = await getRuntimeSettings(req.user.id);
  await starsender.sendMessage(settings.starsenderApiKey, req.params.groupId, message);
  await addOutgoingLog(req.user.id, req.params.groupId, message, true);
  res.json({ success: true });
}));

app.get('/api/knowledge', requireAuth, asyncRoute(async (req, res) => {
  res.json({ items: await knowledge.getKnowledge(req.user.id, req.query.type) });
}));

app.post('/api/knowledge', requireAuth, asyncRoute(async (req, res) => {
  if (!cleanText(req.body.title, 200) || !cleanText(req.body.content, 10000)) return res.status(400).json({ error: 'Judul dan isi wajib diisi' });
  res.status(201).json({ item: await knowledge.addKnowledge(req.user.id, req.body) });
}));

app.put('/api/knowledge/:id', requireAuth, asyncRoute(async (req, res) => {
  const item = await knowledge.updateKnowledge(req.user.id, req.params.id, req.body);
  if (!item) return res.status(404).json({ error: 'Data tidak ditemukan' });
  res.json({ item });
}));

app.delete('/api/knowledge/:id', requireAuth, asyncRoute(async (req, res) => {
  const deleted = await knowledge.deleteKnowledge(req.user.id, req.params.id);
  res.status(deleted ? 200 : 404).json({ success: deleted });
}));

app.post('/api/uploads', requireAuth, asyncRoute(async (req, res) => {
  const match = String(req.body.filedata || '').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(400).json({ error: 'Hanya gambar PNG, JPEG, WEBP, atau GIF yang diperbolehkan' });
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Ukuran gambar maksimal 5 MB' });
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[match[1]];
  const userDir = path.join(UPLOAD_DIR, req.user.id);
  fs.mkdirSync(userDir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(userDir, filename), buffer, { flag: 'wx' });
  const origin = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${origin}/uploads/${req.user.id}/${filename}` });
}));

app.get('/api/broadcasts', requireAuth, asyncRoute(async (req, res) => {
  const broadcasts = await prisma.broadcast.findMany({
    where: { userId: req.user.id },
    include: { recipients: true },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  res.json({ broadcasts });
}));

app.post('/api/broadcasts', requireAuth, asyncRoute(async (req, res) => {
  const title = cleanText(req.body.title, 200);
  const message = cleanText(req.body.message, 5000);
  const recipients = Array.isArray(req.body.recipients) ? req.body.recipients.slice(0, 500) : [];
  if (!title || (!message && !req.body.imageUrl) || !recipients.length) {
    return res.status(400).json({ error: 'Judul, pesan/media, dan minimal satu grup wajib diisi' });
  }
  const unique = [...new Map(recipients.map((item) => [cleanText(item.groupId, 200), item])).values()].filter((item) => item.groupId);
  const broadcast = await prisma.broadcast.create({
    data: {
      userId: req.user.id,
      title,
      message: message || null,
      imageUrl: cleanText(req.body.imageUrl, 1000) || null,
      status: 'draft',
      timezone: req.user.settings.timezone,
      recipients: {
        create: unique.map((item) => ({ groupId: cleanText(item.groupId, 200), groupName: cleanText(item.groupName, 200) || item.groupId }))
      }
    },
    include: { recipients: true }
  });
  res.status(201).json({ broadcast });
}));

app.post('/api/broadcasts/:id/schedule', requireAuth, asyncRoute(async (req, res) => {
  const scheduledAt = new Date(req.body.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt < new Date(Date.now() - 60000)) {
    return res.status(400).json({ error: 'Jadwal pengiriman tidak valid atau sudah lewat' });
  }
  const existing = await prisma.broadcast.findFirst({ where: { id: req.params.id, userId: req.user.id, status: 'draft' } });
  if (!existing) return res.status(404).json({ error: 'Draft tidak ditemukan' });
  const broadcast = await prisma.broadcast.update({
    where: { id: existing.id },
    data: { status: 'scheduled', scheduledAt, approvedAt: new Date() },
    include: { recipients: true }
  });
  res.json({ broadcast });
}));

app.post('/api/broadcasts/test', requireAuth, asyncRoute(async (req, res) => {
  const groupId = cleanText(req.body.groupId, 200);
  const message = cleanText(req.body.message, 5000);
  const imageUrl = cleanText(req.body.imageUrl, 2000);
  if (!groupId || !message) return res.status(400).json({ error: 'Grup dan pesan test wajib diisi' });
  const settings = await getRuntimeSettings(req.user.id);
  if (imageUrl) {
    await starsender.sendMedia(settings.starsenderApiKey, groupId, imageUrl, `[TEST BROADCAST]\n${message}`);
  } else {
    await starsender.sendMessage(settings.starsenderApiKey, groupId, `[TEST BROADCAST]\n${message}`);
  }
  res.json({ success: true });
}));

app.post('/api/broadcasts/:id/cancel', requireAuth, asyncRoute(async (req, res) => {
  const result = await prisma.broadcast.updateMany({
    where: { id: req.params.id, userId: req.user.id, status: { in: ['draft', 'scheduled'] } },
    data: { status: 'cancelled', completedAt: new Date() }
  });
  res.status(result.count ? 200 : 409).json({ success: Boolean(result.count) });
}));

app.post('/api/broadcasts/:id/retry', requireAuth, asyncRoute(async (req, res) => {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: req.params.id, userId: req.user.id, status: { in: ['failed', 'partial'] } } });
  if (!broadcast) return res.status(404).json({ error: 'Broadcast gagal tidak ditemukan' });
  await prisma.$transaction([
    prisma.broadcastRecipient.updateMany({ where: { broadcastId: broadcast.id, status: 'failed' }, data: { status: 'pending', errorMessage: null } }),
    prisma.broadcast.update({ where: { id: broadcast.id }, data: { status: 'scheduled', scheduledAt: new Date(), completedAt: null } })
  ]);
  res.json({ success: true });
}));

app.delete('/api/broadcasts/:id', requireAuth, asyncRoute(async (req, res) => {
  const existing = await prisma.broadcast.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!existing) return res.status(404).json({ error: 'Broadcast tidak ditemukan' });
  if (existing.status === 'processing') return res.status(409).json({ error: 'Broadcast yang sedang diproses tidak dapat dihapus' });
  await prisma.broadcast.delete({ where: { id: existing.id } });
  res.json({ success: true });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.use((error, _req, res, _next) => {
  logger.error('Request error:', error.message);
  if (error.code === 'P2002') return res.status(409).json({ error: 'Data sudah digunakan' });
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Terjadi kesalahan pada server' : error.message });
});

async function start() {
  await ensureAdmin();
  await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  startScheduler();
  app.listen(PORT, () => logger.success(`Ruank WA Automation berjalan di http://localhost:${PORT}`));
}

start().catch((error) => {
  logger.error('Server gagal dimulai:', error);
  process.exit(1);
});

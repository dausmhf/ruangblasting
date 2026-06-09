require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const prisma = require('../src/utils/db');
const { hashPassword, randomToken, encryptSecret } = require('../src/utils/security');

const legacyPath = path.resolve(process.cwd(), 'dev.db');

async function main() {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = String(process.env.ADMIN_PASSWORD || '');
  if (!adminEmail || !adminPassword) throw new Error('ADMIN_EMAIL dan ADMIN_PASSWORD wajib diatur untuk migrasi');
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: process.env.ADMIN_NAME || 'Ruank Admin',
        role: 'superadmin',
        passwordHash: hashPassword(adminPassword),
        settings: {
          create: {
            storeName: process.env.STORE_NAME || 'Ruank WhatsApp',
            botName: process.env.BOT_NAME || 'Ruank Assistant',
            webhookToken: randomToken(20),
            starsenderApiKey: process.env.STARSENDER_API_KEY ? encryptSecret(process.env.STARSENDER_API_KEY) : null,
            geminiApiKey: process.env.GEMINI_API_KEY ? encryptSecret(process.env.GEMINI_API_KEY) : null,
            operationalStart: process.env.ADMIN_OPERATIONAL_START || '08:00',
            operationalEnd: process.env.ADMIN_OPERATIONAL_END || '22:00'
          }
        }
      }
    });
  }

  if (!fs.existsSync(legacyPath)) {
    console.log('Legacy dev.db tidak ditemukan; seed admin selesai.');
    return;
  }
  const legacy = new Database(legacyPath, { readonly: true });
  const alreadyImported = await prisma.message.count({ where: { userId: admin.id } });
  if (alreadyImported) {
    console.log('Data admin sudah tersedia; import legacy dilewati.');
    legacy.close();
    return;
  }

  const knowledge = legacy.prepare('SELECT * FROM Knowledge').all();
  const sessions = legacy.prepare('SELECT * FROM Session').all();
  const messages = legacy.prepare('SELECT * FROM Message').all();
  const memories = legacy.prepare('SELECT * FROM UserMemory').all();
  const broadcasts = legacy.prepare('SELECT * FROM Broadcast').all();
  const recipients = legacy.prepare('SELECT * FROM BroadcastRecipient').all();

  for (const item of knowledge) {
    await prisma.knowledge.create({ data: { ...item, userId: admin.id, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) } });
  }
  for (const item of sessions) {
    await prisma.session.create({
      data: {
        userId: admin.id,
        phoneNumber: item.phoneNumber,
        orderState: item.orderState,
        currentOrder: item.currentOrder,
        humanMode: Boolean(item.humanMode),
        createdAt: new Date(item.createdAt),
        lastActivity: new Date(item.lastActivity)
      }
    });
  }
  for (const item of messages) {
    await prisma.message.create({
      data: {
        ...item,
        userId: admin.id,
        humanMode: Boolean(item.humanMode),
        timestamp: new Date(item.timestamp)
      }
    });
  }
  for (const item of memories) {
    await prisma.userMemory.create({
      data: {
        userId: admin.id,
        phoneNumber: item.phoneNumber,
        name: item.name,
        memoryText: item.memoryText,
        updatedAt: new Date(item.updatedAt)
      }
    });
  }
  for (const item of broadcasts) {
    const statusMap = { pending: 'scheduled', processing: 'processing', completed: 'completed', failed: 'failed' };
    await prisma.broadcast.create({
      data: {
        id: item.id,
        userId: admin.id,
        title: item.title,
        message: item.message,
        imageUrl: item.imageUrl,
        scheduledAt: item.scheduledAt ? new Date(item.scheduledAt) : null,
        approvedAt: item.status === 'pending' ? new Date(item.createdAt) : null,
        status: statusMap[item.status] || 'completed',
        createdAt: new Date(item.createdAt)
      }
    });
  }
  for (const item of recipients) {
    await prisma.broadcastRecipient.create({
      data: {
        ...item,
        sentAt: item.sentAt ? new Date(item.sentAt) : null,
        attempts: item.status === 'sent' || item.status === 'failed' ? 1 : 0
      }
    });
  }
  legacy.close();
  console.log(`Import selesai: ${knowledge.length} knowledge, ${sessions.length} session, ${messages.length} pesan, ${broadcasts.length} broadcast.`);
}

main().finally(() => prisma.$disconnect());

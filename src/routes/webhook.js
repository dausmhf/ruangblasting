const express = require('express');
const prisma = require('../utils/db');
const logger = require('../utils/logger');
const { getSession, setHumanMode, addOutgoingLog } = require('../utils/session');
const { generateResponse } = require('../services/gemini');
const { sendMessage } = require('../services/starsender');
const { getRuntimeSettings } = require('../utils/settings');

const router = express.Router();
const HUMAN_KEYWORDS = ['bicara admin', 'hubungi admin', 'mau admin', 'minta admin', 'cs manusia', 'operator', 'komplain'];
const FALLBACK_REPLY = 'Halo Kak, pesan sudah kami terima. Saat ini asisten AI sedang tidak tersedia, tetapi admin akan segera menindaklanjuti pesan Kakak.';

function isRequestingHuman(message) {
  const lower = String(message || '').toLowerCase();
  return HUMAN_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isOperational(settings) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timezone || 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const current = formatter.format(new Date());
  return settings.operationalStart <= settings.operationalEnd
    ? current >= settings.operationalStart && current <= settings.operationalEnd
    : current >= settings.operationalStart || current <= settings.operationalEnd;
}

async function resolveWebhook(req, res, next) {
  const settings = await prisma.userSettings.findUnique({
    where: { webhookToken: req.params.token },
    include: { user: true }
  });
  if (!settings || !settings.user.isActive) return res.status(404).json({ error: 'Webhook tidak ditemukan' });
  req.webhookUser = settings.user;
  req.webhookSettings = settings;
  next();
}

router.post('/:token', resolveWebhook, async (req, res) => {
  const payload = req.body?.data || req.body || {};
  const message = payload.message || payload.text || payload.body || payload.caption;
  const from = payload.from || payload.phone || payload.remoteJid || payload.chatId || payload.senderId;
  const sender = payload.senderName || payload.pushName || payload.name || payload.sender;
  if (!message || !from) return res.status(400).json({ error: 'message dan from wajib diisi' });
  const userId = req.webhookUser.id;
  const isGroup = String(from).includes('@g.us');
  const incoming = await prisma.message.create({
    data: {
      userId,
      fromPhone: from,
      message: isGroup && sender ? `[${sender}]: ${message}` : message,
      status: isGroup ? 'group' : 'processing',
      type: 'incoming',
      humanMode: isGroup
    }
  });
  await prisma.session.upsert({
    where: { userId_phoneNumber: { userId, phoneNumber: from } },
    update: { lastActivity: new Date(), unreadCount: { increment: 1 }, ...(isGroup ? { humanMode: true } : {}) },
    create: { userId, phoneNumber: from, displayName: sender || null, humanMode: isGroup, unreadCount: 1 }
  });
  res.json({ success: true });
  if (!isGroup) processIncoming(userId, from, message, incoming.id).catch((error) => logger.error('Webhook background:', error.message));
});

async function processIncoming(userId, from, message, messageId) {
  const settings = await getRuntimeSettings(userId);
  if (!settings.starsenderApiKey) throw new Error('Starsender belum dikonfigurasi');
  const session = await getSession(userId, from);

  if (isRequestingHuman(message)) {
    if (!isOperational(settings)) {
      const reply = `Admin sedang di luar jam operasional ${settings.operationalStart}-${settings.operationalEnd}. Pesan Kakak sudah tercatat dan akan dibalas saat admin aktif.`;
      await sendMessage(settings.starsenderApiKey, from, reply);
      await addOutgoingLog(userId, from, reply, false);
      await prisma.message.update({ where: { id: messageId }, data: { status: 'sent', response: reply } });
      return;
    }
    await setHumanMode(userId, from, true);
    const reply = 'Baik, percakapan sudah diteruskan ke admin. Mohon tunggu sebentar.';
    await sendMessage(settings.starsenderApiKey, from, reply);
    await addOutgoingLog(userId, from, reply, true);
    await prisma.message.update({ where: { id: messageId }, data: { status: 'handover', response: reply, humanMode: true } });
    if (settings.adminNotificationPhone) {
      await sendMessage(settings.starsenderApiKey, settings.adminNotificationPhone, `Ada permintaan admin dari wa.me/${String(from).replace(/\D/g, '')}\nPesan: ${message}`).catch(() => {});
    }
    return;
  }

  if (session.humanMode || !settings.autoReplyEnabled) {
    await prisma.message.update({ where: { id: messageId }, data: { status: 'waiting_admin', humanMode: true } });
    return;
  }
  if (!settings.aiEnabled || !settings.geminiApiKey) {
    await prisma.message.update({ where: { id: messageId }, data: { status: 'waiting_admin' } });
    return;
  }

  try {
    const reply = await generateResponse({
      userId,
      apiKey: settings.geminiApiKey,
      model: settings.geminiModel,
      phoneNumber: from,
      userMessage: message,
      chatHistory: session.chatHistory
    });
    await sendMessage(settings.starsenderApiKey, from, reply);
    await prisma.$transaction([
      prisma.message.update({ where: { id: messageId }, data: { status: 'sent', response: reply } }),
      prisma.message.create({ data: { userId, fromPhone: from, response: reply, type: 'outgoing', status: 'sent' } })
    ]);
  } catch (error) {
    logger.error(`Auto reply ${from} gagal:`, error.message);
    try {
      await sendMessage(settings.starsenderApiKey, from, FALLBACK_REPLY);
      await prisma.$transaction([
        prisma.message.update({ where: { id: messageId }, data: { status: 'sent', response: FALLBACK_REPLY } }),
        prisma.message.create({ data: { userId, fromPhone: from, response: FALLBACK_REPLY, type: 'outgoing', status: 'sent' } })
      ]);
    } catch (fallbackError) {
      await prisma.message.update({ where: { id: messageId }, data: { status: 'error' } });
      logger.error(`Fallback reply ${from} gagal:`, fallbackError.message);
    }
  }
}

module.exports = { router };

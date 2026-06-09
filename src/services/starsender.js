const axios = require('axios');
const logger = require('../utils/logger');

const SEND_URL = 'https://api.starsender.online/api/send';
const GROUPS_URL = 'https://api.starsender.online/api/whatsapp/groups';
const messageTimes = new Map();

function normalizePhoneNumber(phone) {
  if (!phone) return phone;
  if (phone.includes('@g.us')) return phone;
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = `62${cleaned.slice(1)}`;
  return cleaned;
}

async function waitForRateLimit(key) {
  const last = messageTimes.get(key) || 0;
  const wait = Math.max(0, 1100 - (Date.now() - last));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  messageTimes.set(key, Date.now());
}

function requireApiKey(apiKey) {
  if (!apiKey) throw new Error('Starsender API key belum dikonfigurasi');
}

async function sendMessage(apiKey, to, body) {
  requireApiKey(apiKey);
  const normalizedTo = normalizePhoneNumber(to);
  await waitForRateLimit(`${apiKey.slice(-6)}:${normalizedTo}`);
  const response = await axios.post(SEND_URL, {
    messageType: 'text',
    to: normalizedTo,
    body: String(body || '')
  }, {
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    timeout: 30000
  });
  if (response.data?.success === false) throw new Error(response.data?.message || 'Starsender menolak pengiriman');
  logger.success(`Pesan terkirim ke ${normalizedTo}`);
  return response.data;
}

async function sendMedia(apiKey, to, fileUrl, caption = '') {
  requireApiKey(apiKey);
  const normalizedTo = normalizePhoneNumber(to);
  await waitForRateLimit(`${apiKey.slice(-6)}:${normalizedTo}`);
  const response = await axios.post(SEND_URL, {
    messageType: 'media',
    to: normalizedTo,
    body: caption,
    file: fileUrl
  }, {
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    timeout: 30000
  });
  if (response.data?.success === false) throw new Error(response.data?.message || 'Starsender menolak pengiriman media');
  logger.success(`Media terkirim ke ${normalizedTo}`);
  return response.data;
}

async function getGroups(apiKey) {
  requireApiKey(apiKey);
  const response = await axios.get(GROUPS_URL, {
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    timeout: 15000
  });
  return response.data?.data?.groups || response.data?.groups || [];
}

async function testConnection(apiKey) {
  const groups = await getGroups(apiKey);
  return { ok: true, groupCount: groups.length };
}

module.exports = { sendMessage, sendMedia, getGroups, testConnection, normalizePhoneNumber };

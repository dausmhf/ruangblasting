const prisma = require('./db');

const SESSION_TIMEOUT = (parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) || 1440) * 60 * 1000;

async function getSession(userId, phoneNumber) {
  const now = new Date();
  let session = await prisma.session.findUnique({ where: { userId_phoneNumber: { userId, phoneNumber } } });
  if (!session) {
    session = await prisma.session.create({ data: { userId, phoneNumber, lastActivity: now } });
  } else if (now - session.lastActivity > SESSION_TIMEOUT) {
    session = await prisma.session.update({
      where: { id: session.id },
      data: { orderState: 'idle', currentOrder: null, humanMode: false, lastActivity: now }
    });
  } else {
    session = await prisma.session.update({ where: { id: session.id }, data: { lastActivity: now } });
  }
  const messages = await prisma.message.findMany({
    where: { userId, fromPhone: phoneNumber },
    orderBy: { timestamp: 'desc' },
    take: 6
  });
  return {
    ...session,
    chatHistory: messages.reverse().flatMap((message) => {
      const text = message.type === 'incoming' ? message.message : message.response;
      return text ? [{ role: message.type === 'incoming' ? 'user' : 'model', parts: [{ text }] }] : [];
    })
  };
}

async function getAllSessions(userId, { archived = false, search = '' } = {}) {
  const sessions = await prisma.session.findMany({
    where: {
      userId,
      archived,
      ...(search ? { OR: [{ phoneNumber: { contains: search } }, { displayName: { contains: search } }] } : {})
    },
    orderBy: { lastActivity: 'desc' }
  });
  const phones = sessions.map((item) => item.phoneNumber);
  const latestMessages = phones.length ? await prisma.message.findMany({
    where: { userId, fromPhone: { in: phones } },
    orderBy: { timestamp: 'desc' }
  }) : [];
  const latestByPhone = new Map();
  for (const message of latestMessages) if (!latestByPhone.has(message.fromPhone)) latestByPhone.set(message.fromPhone, message);
  return sessions.map((session) => ({ ...session, latestMessage: latestByPhone.get(session.phoneNumber) || null }));
}

async function setHumanMode(userId, phoneNumber, enabled) {
  return prisma.session.upsert({
    where: { userId_phoneNumber: { userId, phoneNumber } },
    update: { humanMode: enabled, lastActivity: new Date() },
    create: { userId, phoneNumber, humanMode: enabled }
  });
}

async function addOutgoingLog(userId, phoneNumber, response, humanMode = true) {
  return prisma.message.create({
    data: { userId, fromPhone: phoneNumber, response, type: 'outgoing', status: 'sent', humanMode }
  });
}

module.exports = { getSession, getAllSessions, setHumanMode, addOutgoingLog };

const prisma = require('../utils/db');
const { sendMessage, sendMedia } = require('./starsender');
const { getRuntimeSettings } = require('../utils/settings');
const logger = require('../utils/logger');

let timer = null;
let checking = false;

async function processBroadcast(broadcast) {
  const claimed = await prisma.broadcast.updateMany({
    where: { id: broadcast.id, status: 'scheduled' },
    data: { status: 'processing', startedAt: new Date() }
  });
  if (!claimed.count) return;

  const settings = await getRuntimeSettings(broadcast.userId);
  if (!settings.starsenderApiKey) {
    await prisma.broadcast.update({ where: { id: broadcast.id }, data: { status: 'failed', completedAt: new Date() } });
    return;
  }

  const recipients = await prisma.broadcastRecipient.findMany({
    where: { broadcastId: broadcast.id, status: { in: ['pending', 'failed'] } }
  });
  for (const recipient of recipients) {
    try {
      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: 'sending', attempts: { increment: 1 }, errorMessage: null }
      });
      if (broadcast.imageUrl) {
        await sendMedia(settings.starsenderApiKey, recipient.groupId, broadcast.imageUrl, broadcast.message || '');
      } else {
        await sendMessage(settings.starsenderApiKey, recipient.groupId, broadcast.message || '');
      }
      await prisma.$transaction([
        prisma.broadcastRecipient.update({
          where: { id: recipient.id },
          data: { status: 'sent', sentAt: new Date(), errorMessage: null }
        }),
        prisma.message.create({
          data: {
            userId: broadcast.userId,
            fromPhone: recipient.groupId,
            response: broadcast.imageUrl ? `[BLAST MEDIA] ${broadcast.message || ''}` : `[BLAST] ${broadcast.message || ''}`,
            type: 'outgoing',
            status: 'sent',
            humanMode: true
          }
        })
      ]);
    } catch (error) {
      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: 'failed', errorMessage: String(error.message || 'Pengiriman gagal').slice(0, 500) }
      });
    }
  }

  const counts = await prisma.broadcastRecipient.groupBy({
    by: ['status'],
    where: { broadcastId: broadcast.id },
    _count: { _all: true }
  });
  const sent = counts.find((item) => item.status === 'sent')?._count._all || 0;
  const failed = counts.find((item) => item.status === 'failed')?._count._all || 0;
  const status = failed === 0 ? 'completed' : sent > 0 ? 'partial' : 'failed';
  await prisma.broadcast.update({ where: { id: broadcast.id }, data: { status, completedAt: new Date() } });
}

async function checkAndSendBroadcasts() {
  if (checking) return;
  checking = true;
  try {
    const due = await prisma.broadcast.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: 10
    });
    for (const broadcast of due) await processBroadcast(broadcast);
  } catch (error) {
    logger.error('Scheduler broadcast gagal:', error.message);
  } finally {
    checking = false;
  }
}

function startScheduler() {
  if (timer) return;
  checkAndSendBroadcasts();
  timer = setInterval(checkAndSendBroadcasts, 10000);
  logger.info('Scheduler broadcast aktif');
}

module.exports = { startScheduler, checkAndSendBroadcasts };

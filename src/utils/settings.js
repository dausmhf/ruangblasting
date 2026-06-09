const prisma = require('./db');
const { decryptSecret } = require('./security');

async function getRuntimeSettings(userId) {
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (!settings) throw new Error('Pengaturan user belum tersedia');
  return {
    ...settings,
    starsenderApiKey: decryptSecret(settings.starsenderApiKey),
    geminiApiKey: decryptSecret(settings.geminiApiKey)
  };
}

module.exports = { getRuntimeSettings };

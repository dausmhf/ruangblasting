const prisma = require('../utils/db');

function serialize(item) {
  return { ...item, tags: item.tags ? item.tags.split(',').filter(Boolean) : [] };
}

function normalizeTags(tags) {
  const values = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return values.map((tag) => tag.trim().toLowerCase()).filter(Boolean).join(',');
}

async function getKnowledge(userId, type) {
  const rows = await prisma.knowledge.findMany({
    where: { userId, ...(type ? { type } : {}) },
    orderBy: { updatedAt: 'desc' }
  });
  return rows.map(serialize);
}

async function addKnowledge(userId, data) {
  const item = await prisma.knowledge.create({
    data: {
      userId,
      title: String(data.title || '').trim(),
      tags: normalizeTags(data.tags),
      content: String(data.content || '').trim(),
      type: data.type === 'product' ? 'product' : 'general',
      productName: data.productName?.trim() || null,
      productLink: data.productLink?.trim() || null
    }
  });
  return serialize(item);
}

async function updateKnowledge(userId, id, data) {
  const existing = await prisma.knowledge.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const item = await prisma.knowledge.update({
    where: { id },
    data: {
      title: String(data.title || '').trim(),
      tags: normalizeTags(data.tags),
      content: String(data.content || '').trim(),
      type: data.type === 'product' ? 'product' : 'general',
      productName: data.productName?.trim() || null,
      productLink: data.productLink?.trim() || null
    }
  });
  return serialize(item);
}

async function deleteKnowledge(userId, id) {
  const existing = await prisma.knowledge.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await prisma.knowledge.delete({ where: { id } });
  return true;
}

async function searchKnowledge(userId, query, limit = 4) {
  const words = String(query || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((word) => word.length > 2);
  if (!words.length) return [];
  const list = await getKnowledge(userId);
  return list.map((item) => {
    const title = item.title.toLowerCase();
    const content = item.content.toLowerCase();
    const score = words.reduce((sum, word) => sum
      + (item.tags.some((tag) => tag.includes(word)) ? 5 : 0)
      + (title.includes(word) ? 2 : 0)
      + (content.includes(word) ? 0.5 : 0), 0);
    return { ...item, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { getKnowledge, addKnowledge, updateKnowledge, deleteKnowledge, searchKnowledge };

const { GoogleGenAI } = require('@google/genai');
const logger = require('../utils/logger');
const { getSystemPrompt } = require('../data/prompts');
const { searchKnowledge } = require('./knowledge');

const MAX_HISTORY_CHARS = 1800;
const MAX_KNOWLEDGE_CHARS = 1200;

function createClient(apiKey, vertexai = false) {
  return new GoogleGenAI(vertexai ? { vertexai: true, apiKey } : { apiKey });
}

function shouldUseVertex(error) {
  const message = String(error?.message || '');
  return message.includes('API_KEY_SERVICE_BLOCKED')
    || message.includes('generativelanguage.googleapis.com');
}

async function generateContent(apiKey, request) {
  try {
    return await createClient(apiKey).models.generateContent(request);
  } catch (error) {
    if (!shouldUseVertex(error)) throw error;
    return createClient(apiKey, true).models.generateContent(request);
  }
}

function compactHistory(chatHistory, userMessage) {
  const normalizedMessage = String(userMessage || '').trim();
  const result = [];
  let usedChars = 0;

  for (const item of chatHistory.slice().reverse()) {
    const text = String(item?.parts?.[0]?.text || '').trim();
    if (!text || (result.length === 0 && item.role === 'user' && text === normalizedMessage)) continue;
    const clipped = text.slice(0, 600);
    if (usedChars + clipped.length > MAX_HISTORY_CHARS) break;
    result.unshift({ role: item.role, parts: [{ text: clipped }] });
    usedChars += clipped.length;
  }

  return [...result, { role: 'user', parts: [{ text: normalizedMessage.slice(0, 1200) }] }];
}

function formatKnowledge(items) {
  let usedChars = 0;
  return items.map((item) => {
    const product = item.productName ? `Produk: ${item.productName}\n` : '';
    const link = item.productLink ? `Link: ${item.productLink}\n` : '';
    const text = `${item.title}\n${product}${link}${item.content}`.trim();
    const remaining = MAX_KNOWLEDGE_CHARS - usedChars;
    if (remaining <= 0) return '';
    const clipped = text.slice(0, remaining);
    usedChars += clipped.length;
    return clipped;
  }).filter(Boolean).join('\n---\n');
}

async function generateResponse({
  userId, apiKey, model, phoneNumber, userMessage, chatHistory = [], storeName, botName
}) {
  if (!apiKey) throw new Error('Gemini API key belum dikonfigurasi');
  const relevantKnowledge = await searchKnowledge(userId, userMessage);
  let systemPrompt = getSystemPrompt({ storeName, botName });
  if (relevantKnowledge.length) {
    systemPrompt += `\n\nKONTEKS:\n${formatKnowledge(relevantKnowledge)}`;
  }
  const contents = compactHistory(chatHistory, userMessage);
  const response = await generateContent(apiKey, {
    model: model || 'gemini-2.5-flash',
    contents,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 320,
      thinkingConfig: { thinkingBudget: 0 }
    }
  });
  if (!response.text) throw new Error('Gemini mengembalikan respons kosong');
  const usage = response.usageMetadata || {};
  logger.success(
    `Gemini merespons ${phoneNumber} (${response.text.length} karakter, input ${usage.promptTokenCount || '?'} token, output ${usage.candidatesTokenCount || '?'} token)`
  );
  return response.text;
}

async function testConnection(apiKey, model = 'gemini-2.5-flash') {
  if (!apiKey) return { ok: false, message: 'API key belum diisi' };
  try {
    const response = await generateContent(apiKey, { model, contents: 'Balas OK.' });
    return { ok: Boolean(response.text), message: 'Gemini / Vertex AI terhubung' };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

module.exports = { generateResponse, testConnection, compactHistory, formatKnowledge };

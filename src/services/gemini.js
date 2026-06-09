const { GoogleGenAI } = require('@google/genai');
const logger = require('../utils/logger');
const { getSystemPrompt } = require('../data/prompts');
const { searchKnowledge } = require('./knowledge');

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

async function generateResponse({ userId, apiKey, model, phoneNumber, userMessage, chatHistory = [] }) {
  if (!apiKey) throw new Error('Gemini API key belum dikonfigurasi');
  const relevantKnowledge = await searchKnowledge(userId, userMessage);
  let systemPrompt = getSystemPrompt();
  if (relevantKnowledge.length) {
    systemPrompt += `\n\nKONTEKS TOKO:\n${relevantKnowledge.map((item) => `${item.title}\n${item.content}`).join('\n\n')}`;
  }
  const contents = [
    ...chatHistory,
    { role: 'user', parts: [{ text: userMessage }] }
  ];
  const response = await generateContent(apiKey, {
    model: model || 'gemini-2.5-flash',
    contents,
    config: { systemInstruction: systemPrompt, temperature: 0.6, topP: 0.9, maxOutputTokens: 1024 }
  });
  if (!response.text) throw new Error('Gemini mengembalikan respons kosong');
  logger.success(`Gemini merespons ${phoneNumber} (${response.text.length} karakter)`);
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

module.exports = { generateResponse, testConnection };

// ============================================
// AI Memory Service (User Profiling)
// Ekstraksi & penyimpanan profil/preferensi customer secara dinamis
// ============================================

const { GoogleGenAI } = require('@google/genai');
const prisma = require('../utils/db');
const logger = require('../utils/logger');

// Inisialisasi Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = 'gemini-2.5-flash';

/**
 * Mengambil memori/profil customer berdasarkan nomor telepon
 * @param {string} phone 
 * @returns {Promise<object|null>}
 */
async function getUserMemory(phone) {
  try {
    const memory = await prisma.userMemory.findUnique({
      where: { phoneNumber: phone }
    });
    return memory;
  } catch (error) {
    logger.error(`Gagal mengambil memori user ${phone}:`, error.message);
    return null;
  }
}

/**
 * Mengekstrak informasi baru tentang customer di background secara asinkron
 * @param {string} phone 
 */
async function learnUserMemory(phone) {
  try {
    // 1. Ambil 6 pesan terakhir untuk dianalisis
    const messages = await prisma.message.findMany({
      where: { fromPhone: phone },
      orderBy: { timestamp: 'desc' },
      take: 6
    });

    if (messages.length === 0) return;

    // Balik urutan agar kronologis (dari terlama ke terbaru)
    messages.reverse();

    // 2. Ambil memori yang sudah ada
    const existingMemory = await getUserMemory(phone);
    const existingMemoryText = existingMemory?.memoryText || 'Belum ada memori tercatat.';

    // 3. Bangun transkrip chat untuk dianalisis AI
    let chatTranscript = '';
    for (const msg of messages) {
      const sender = msg.type === 'incoming' ? 'Customer' : 'CS/Bot';
      const text = msg.type === 'incoming' ? msg.message : (msg.response || msg.message);
      if (text) {
        chatTranscript += `${sender}: ${text}\n`;
      }
    }

    // 4. Buat prompt instruksi pembelajaran
    const prompt = `Anda adalah asisten AI yang bertugas menyaring fakta penting tentang customer berdasarkan percakapan terbaru untuk disimpan dalam memori jangka panjang.
    
Percakapan terbaru:
${chatTranscript}

Memori saat ini tentang customer:
"${existingMemoryText}"

Tugas Anda:
1. Analisis percakapan terbaru di atas untuk mengekstrak informasi baru yang penting dan stabil tentang customer.
   Contoh fakta penting: Nama panggilan customer (jika mereka menyebutkan nama mereka), preferensi produk (game/voucher yang sering dibeli), nomor tujuan/ID game favorit, metode pembayaran yang biasa dipilih, atau kendala/masalah spesifik yang dialami.
2. Gabungkan fakta baru tersebut dengan memori saat ini menjadi satu rangkuman memori yang ringkas dan padat.
3. JANGAN mencatat hal-hal kasual atau dinamis (seperti sapaan halo, obrolan basa-basi, detail pesanan sekali pakai yang tidak permanen).
4. Jika tidak ada informasi baru yang penting dari percakapan terbaru, cukup kembalikan memori saat ini secara persis tanpa ada perubahan.
5. Tanggapan Anda HARUS hanya berupa rangkuman memori dalam Bahasa Indonesia (tanpa kalimat pembuka/penutup, tanpa penjelasan tambahan). Maksimal 300 karakter.
6. Cobalah untuk menyimpulkan nama customer jika mereka memperkenalkannya. Format output harus rapi, misalnya:
   - Nama panggilan: [Nama]
   - Preferensi: [Detail game/voucher]
   - Catatan: [Masalah/info lain]`;

    logger.info(`AI mulai menganalisis memori untuk customer ${phone}...`);

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        temperature: 0.3, // Rendah agar lebih konsisten dan tidak berhalusinasi
        maxOutputTokens: 200,
      }
    });

    const newMemoryText = response.text?.trim();

    if (newMemoryText && newMemoryText !== existingMemoryText) {
      // Ekstrak nama jika ada format "Nama panggilan: Budi"
      let name = existingMemory?.name || null;
      const nameMatch = newMemoryText.match(/(?:Nama panggilan|Nama)\s*[:\-]?\s*([^\n\r\-|]+)/i);
      if (nameMatch) {
        name = nameMatch[1].trim();
      }

      // Simpan/update di database
      await prisma.userMemory.upsert({
        where: { phoneNumber: phone },
        update: {
          memoryText: newMemoryText,
          name: name,
        },
        create: {
          phoneNumber: phone,
          memoryText: newMemoryText,
          name: name,
        }
      });

      logger.success(`Memori diperbarui untuk customer ${phone}: "${newMemoryText.replace(/\n/g, ' | ')}"`);
    } else {
      logger.info(`Tidak ada perubahan memori untuk customer ${phone}`);
    }
  } catch (error) {
    logger.error(`Gagal melakukan background learning memori untuk ${phone}:`, error.message);
  }
}

module.exports = {
  getUserMemory,
  learnUserMemory,
};

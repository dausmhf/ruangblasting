// ============================================
// Database Utility (Prisma Client Singleton)
// ============================================

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const logger = require('./logger');

let prisma;

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';

if (dbUrl.startsWith('postgresql:') || dbUrl.startsWith('postgres:')) {
  // Konfigurasi VPS / PostgreSQL
  // Untuk PostgreSQL di VPS, Anda perlu menginstal: npm install pg @prisma/adapter-pg
  // Lalu uncomment kode berikut dan sesuaikan.
  /*
  const { Pool } = require('pg');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
  logger.success('Prisma Client terhubung ke PostgreSQL (VPS)');
  */
  
  // Sementara fallback ke native client jika pg adapter belum di-setup
  prisma = new PrismaClient();
  logger.info('Prisma Client diinisialisasi untuk PostgreSQL (VPS/Native)');
} else {
  // Default: SQLite untuk development lokal
  try {
    const adapter = new PrismaBetterSqlite3({ url: dbUrl });
    prisma = new PrismaClient({ adapter });
    logger.success('Prisma Client terhubung ke SQLite (Lokal)');
  } catch (error) {
    logger.error('Gagal memuat SQLite adapter:', error.message);
    prisma = new PrismaClient();
  }
}

module.exports = prisma;

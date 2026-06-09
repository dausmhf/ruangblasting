-- CreateTable
CREATE TABLE "Knowledge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'general',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "phoneNumber" TEXT NOT NULL PRIMARY KEY,
    "orderState" TEXT NOT NULL DEFAULT 'idle',
    "currentOrder" TEXT,
    "humanMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivity" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromPhone" TEXT NOT NULL,
    "message" TEXT,
    "response" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "type" TEXT NOT NULL DEFAULT 'incoming',
    "humanMode" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UserMemory" (
    "phoneNumber" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "memoryText" TEXT DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

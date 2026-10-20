/*
  Warnings:

  - You are about to drop the column `commentReply` on the `InstagramRule` table. All the data in the column will be lost.
  - You are about to drop the column `keyword` on the `InstagramRule` table. All the data in the column will be lost.
  - You are about to drop the column `matchDms` on the `InstagramRule` table. All the data in the column will be lost.
  - Made the column `mediaId` on table `InstagramRule` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
-- Reel-specific DMs only: rules for every post are gone.
DELETE FROM "InstagramRule" WHERE "mediaId" IS NULL;
CREATE TABLE "new_InstagramAccount" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'me',
    "igUserId" TEXT,
    "username" TEXT,
    "accessToken" TEXT,
    "tokenExpiresAt" DATETIME,
    "autoReply" BOOLEAN NOT NULL DEFAULT true,
    "keyword" TEXT NOT NULL DEFAULT 'LINK',
    "commentReply" TEXT,
    "poll" BOOLEAN NOT NULL DEFAULT true,
    "lastWebhookAt" DATETIME,
    "lastPollAt" DATETIME,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_InstagramAccount" ("accessToken", "autoReply", "id", "igUserId", "lastError", "lastPollAt", "lastWebhookAt", "poll", "tokenExpiresAt", "updatedAt", "username") SELECT "accessToken", "autoReply", "id", "igUserId", "lastError", "lastPollAt", "lastWebhookAt", "poll", "tokenExpiresAt", "updatedAt", "username" FROM "InstagramAccount";
DROP TABLE "InstagramAccount";
ALTER TABLE "new_InstagramAccount" RENAME TO "InstagramAccount";
CREATE TABLE "new_InstagramRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "dmText" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_InstagramRule" ("createdAt", "dmText", "enabled", "id", "mediaId", "projectId", "updatedAt") SELECT "createdAt", "dmText", "enabled", "id", "mediaId", "projectId", "updatedAt" FROM "InstagramRule";
DROP TABLE "InstagramRule";
ALTER TABLE "new_InstagramRule" RENAME TO "InstagramRule";
CREATE UNIQUE INDEX "InstagramRule_mediaId_key" ON "InstagramRule"("mediaId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "InstagramAccount" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'me',
    "igUserId" TEXT,
    "username" TEXT,
    "accessToken" TEXT,
    "tokenExpiresAt" DATETIME,
    "autoReply" BOOLEAN NOT NULL DEFAULT true,
    "poll" BOOLEAN NOT NULL DEFAULT true,
    "lastWebhookAt" DATETIME,
    "lastPollAt" DATETIME,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InstagramRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyword" TEXT NOT NULL,
    "dmText" TEXT NOT NULL,
    "commentReply" TEXT,
    "mediaId" TEXT,
    "matchDms" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InstagramPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "renderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "firstComment" TEXT,
    "containerId" TEXT,
    "mediaId" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "InstagramReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "mediaId" TEXT,
    "fromId" TEXT NOT NULL,
    "fromUsername" TEXT,
    "text" TEXT NOT NULL,
    "ruleId" TEXT,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "InstagramRule_mediaId_idx" ON "InstagramRule"("mediaId");

-- CreateIndex
CREATE INDEX "InstagramPost_projectId_idx" ON "InstagramPost"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramReply_sourceId_key" ON "InstagramReply"("sourceId");

-- CreateIndex
CREATE INDEX "InstagramReply_fromId_ruleId_idx" ON "InstagramReply"("fromId", "ruleId");

-- CreateIndex
CREATE INDEX "InstagramReply_createdAt_idx" ON "InstagramReply"("createdAt");

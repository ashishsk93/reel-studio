-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Influencer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "identityBlock" TEXT NOT NULL,
    "shortIdentity" TEXT NOT NULL,
    "voiceNotes" TEXT NOT NULL,
    "exampleLines" JSONB NOT NULL,
    "personality" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "hashtag" TEXT NOT NULL,
    "signatureDetails" JSONB NOT NULL,
    "forbiddenFeatures" JSONB NOT NULL,
    "conditionalFeatures" JSONB NOT NULL,
    "defaultStyling" TEXT NOT NULL,
    "homeOutfit" TEXT NOT NULL,
    "homeSetting" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "creatorBrief" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReferenceImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "influencerId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "tags" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "creatorTaskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferenceImage_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReferenceImage_creatorTaskId_fkey" FOREIGN KEY ("creatorTaskId") REFERENCES "CreatorTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreatorTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "influencerId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "tag" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "imageModel" TEXT NOT NULL,
    "modelReason" TEXT NOT NULL,
    "attachments" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'locked',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreatorTask_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logoPath" TEXT,
    "priceMode" TEXT NOT NULL,
    "disclosureLines" JSONB NOT NULL,
    "linkNotes" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "influencerId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "priceInr" INTEGER NOT NULL,
    "priceModeOverride" TEXT,
    "productUrl" TEXT,
    "affiliateLink" TEXT,
    "occasion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "furthestStatus" TEXT NOT NULL DEFAULT 'draft',
    "videoMode" TEXT NOT NULL DEFAULT 'multi_shot',
    "postedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "ProductImage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductSpec" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "mustMatch" JSONB NOT NULL,
    "unknowns" JSONB NOT NULL,
    "garmentParagraph" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductSpec_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "onScreenText" TEXT NOT NULL,
    "targetDurationSec" REAL NOT NULL,
    "setting" TEXT NOT NULL,
    "outfitState" TEXT NOT NULL,
    "showsProduct" BOOLEAN NOT NULL DEFAULT true,
    "imagePrompt" TEXT NOT NULL,
    "imageModel" TEXT NOT NULL,
    "imageModelReason" TEXT NOT NULL,
    "attachments" JSONB NOT NULL,
    "motion" TEXT NOT NULL,
    "approvedAssetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Scene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Scene_approvedAssetId_fkey" FOREIGN KEY ("approvedAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "sceneId" TEXT,
    "videoJobId" TEXT,
    "creatorTaskId" TEXT,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "normalizedPath" TEXT,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "durationSec" REAL,
    "probe" JSONB,
    "detectedCuts" JSONB,
    "shotBounds" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "sourcePrompt" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_videoJobId_fkey" FOREIGN KEY ("videoJobId") REFERENCES "VideoJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_creatorTaskId_fkey" FOREIGN KEY ("creatorTaskId") REFERENCES "CreatorTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "fixPrompts" JSONB NOT NULL,
    "shots" JSONB,
    "model" TEXT NOT NULL,
    "llmCallId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "prompt" TEXT NOT NULL,
    "startAssetId" TEXT NOT NULL,
    "extraRefs" JSONB NOT NULL,
    "expectedShots" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "creditEstimate" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "inSec" REAL NOT NULL,
    "outSec" REAL NOT NULL,
    "suggestedInSec" REAL,
    "suggestedOutSec" REAL,
    "onScreenText" TEXT NOT NULL,
    "textBox" JSONB,
    "detections" JSONB,
    "badgeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "badgePlacement" JSONB,
    "placementWarning" TEXT,
    CONSTRAINT "Segment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Segment_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Segment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Composition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "cta" JSONB NOT NULL,
    "cover" JSONB NOT NULL,
    "music" JSONB,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Composition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaptionPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "hashtags" JSONB NOT NULL,
    "firstComment" TEXT,
    "dmTemplate" TEXT NOT NULL,
    "coverTitles" JSONB NOT NULL,
    "sceneTexts" JSONB NOT NULL,
    "checklist" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CaptionPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Render" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "outputDir" TEXT NOT NULL,
    "probe" JSONB,
    "qa" JSONB,
    "warnings" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "Render_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT,
    "sceneId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "output" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantMessage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssistantMessage_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "projectId" TEXT,
    "influencerId" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LlmCall_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "idempotencyKey" TEXT,
    "projectId" TEXT,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "progress" REAL NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Influencer_slug_key" ON "Influencer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceImage_creatorTaskId_key" ON "ReferenceImage"("creatorTaskId");

-- CreateIndex
CREATE INDEX "ReferenceImage_influencerId_idx" ON "ReferenceImage"("influencerId");

-- CreateIndex
CREATE INDEX "CreatorTask_influencerId_order_idx" ON "CreatorTask"("influencerId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE INDEX "ProductImage_projectId_order_idx" ON "ProductImage"("projectId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSpec_projectId_key" ON "ProductSpec"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_approvedAssetId_key" ON "Scene"("approvedAssetId");

-- CreateIndex
CREATE INDEX "Scene_projectId_order_idx" ON "Scene"("projectId", "order");

-- CreateIndex
CREATE INDEX "Asset_sceneId_idx" ON "Asset"("sceneId");

-- CreateIndex
CREATE INDEX "Asset_videoJobId_idx" ON "Asset"("videoJobId");

-- CreateIndex
CREATE INDEX "Asset_creatorTaskId_idx" ON "Asset"("creatorTaskId");

-- CreateIndex
CREATE INDEX "Review_assetId_idx" ON "Review"("assetId");

-- CreateIndex
CREATE INDEX "VideoJob_projectId_mode_order_idx" ON "VideoJob"("projectId", "mode", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_sceneId_key" ON "Segment"("sceneId");

-- CreateIndex
CREATE INDEX "Segment_projectId_order_idx" ON "Segment"("projectId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Composition_projectId_key" ON "Composition"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptionPackage_projectId_key" ON "CaptionPackage"("projectId");

-- CreateIndex
CREATE INDEX "AssistantMessage_assetId_idx" ON "AssistantMessage"("assetId");

-- CreateIndex
CREATE INDEX "AssistantMessage_sceneId_idx" ON "AssistantMessage"("sceneId");

-- CreateIndex
CREATE INDEX "LlmCall_projectId_idx" ON "LlmCall"("projectId");

-- CreateIndex
CREATE INDEX "LlmCall_createdAt_idx" ON "LlmCall"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_projectId_idx" ON "Job"("projectId");

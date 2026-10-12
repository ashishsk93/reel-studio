-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CreatorTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "influencerId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "tag" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "promptOverride" BOOLEAN NOT NULL DEFAULT false,
    "imageModel" TEXT NOT NULL,
    "modelReason" TEXT NOT NULL,
    "attachments" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'locked',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreatorTask_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CreatorTask" ("attachments", "createdAt", "id", "imageModel", "influencerId", "modelReason", "order", "prompt", "purpose", "status", "tag", "updatedAt") SELECT "attachments", "createdAt", "id", "imageModel", "influencerId", "modelReason", "order", "prompt", "purpose", "status", "tag", "updatedAt" FROM "CreatorTask";
DROP TABLE "CreatorTask";
ALTER TABLE "new_CreatorTask" RENAME TO "CreatorTask";
CREATE INDEX "CreatorTask_influencerId_order_idx" ON "CreatorTask"("influencerId", "order");
CREATE TABLE "new_Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "checklist" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "fixPrompts" JSONB NOT NULL,
    "shots" JSONB,
    "model" TEXT NOT NULL,
    "llmCallId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Review" ("assetId", "checklist", "createdAt", "fixPrompts", "id", "issues", "llmCallId", "model", "shots", "verdict") SELECT "assetId", "checklist", "createdAt", "fixPrompts", "id", "issues", "llmCallId", "model", "shots", "verdict" FROM "Review";
DROP TABLE "Review";
ALTER TABLE "new_Review" RENAME TO "Review";
CREATE INDEX "Review_assetId_idx" ON "Review"("assetId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

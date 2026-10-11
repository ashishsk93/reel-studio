-- AlterTable
ALTER TABLE "Project" ADD COLUMN "storyboardNotes" JSONB;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Scene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "onScreenText" TEXT NOT NULL,
    "targetDurationSec" REAL NOT NULL,
    "setting" TEXT NOT NULL,
    "outfitState" TEXT NOT NULL,
    "shotKind" TEXT NOT NULL DEFAULT 'medium',
    "description" TEXT NOT NULL DEFAULT '',
    "productRoles" JSONB,
    "promptOverride" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_Scene" ("approvedAssetId", "attachments", "createdAt", "id", "imageModel", "imageModelReason", "imagePrompt", "motion", "onScreenText", "order", "outfitState", "projectId", "purpose", "setting", "showsProduct", "targetDurationSec", "type", "updatedAt") SELECT "approvedAssetId", "attachments", "createdAt", "id", "imageModel", "imageModelReason", "imagePrompt", "motion", "onScreenText", "order", "outfitState", "projectId", "purpose", "setting", "showsProduct", "targetDurationSec", "type", "updatedAt" FROM "Scene";
DROP TABLE "Scene";
ALTER TABLE "new_Scene" RENAME TO "Scene";
CREATE UNIQUE INDEX "Scene_approvedAssetId_key" ON "Scene"("approvedAssetId");
CREATE INDEX "Scene_projectId_order_idx" ON "Scene"("projectId", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

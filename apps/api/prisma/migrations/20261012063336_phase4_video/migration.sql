-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "frames" JSONB;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VideoJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'main',
    "order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "prompt" TEXT NOT NULL,
    "promptOverride" BOOLEAN NOT NULL DEFAULT false,
    "startAssetId" TEXT NOT NULL,
    "extraRefs" JSONB NOT NULL,
    "expectedShots" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "creditEstimate" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VideoJob" ("active", "createdAt", "creditEstimate", "expectedShots", "extraRefs", "id", "mode", "order", "projectId", "prompt", "settings", "startAssetId", "updatedAt") SELECT "active", "createdAt", "creditEstimate", "expectedShots", "extraRefs", "id", "mode", "order", "projectId", "prompt", "settings", "startAssetId", "updatedAt" FROM "VideoJob";
DROP TABLE "VideoJob";
ALTER TABLE "new_VideoJob" RENAME TO "VideoJob";
CREATE INDEX "VideoJob_projectId_mode_order_idx" ON "VideoJob"("projectId", "mode", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

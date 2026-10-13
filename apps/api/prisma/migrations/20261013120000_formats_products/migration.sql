-- AlterTable
ALTER TABLE "VideoJob" ADD COLUMN "endAssetId" TEXT;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "priceInr" INTEGER NOT NULL,
    "priceModeOverride" TEXT,
    "productUrl" TEXT,
    "affiliateLink" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Product_projectId_order_idx" ON "Product"("projectId", "order");

-- Data: every existing project becomes a classic project with one product carrying its old fields.
INSERT INTO "Product" ("id", "projectId", "order", "title", "sourceId", "priceInr", "priceModeOverride", "productUrl", "affiliateLink", "note", "createdAt", "updatedAt")
SELECT 'prd_' || "id", "id", 0, "productTitle", "sourceId", "priceInr", "priceModeOverride", "productUrl", "affiliateLink", '', "createdAt", "updatedAt" FROM "Project";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "influencerId" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'classic',
    "title" TEXT NOT NULL,
    "occasion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "furthestStatus" TEXT NOT NULL DEFAULT 'draft',
    "videoMode" TEXT NOT NULL DEFAULT 'multi_shot',
    "storyboardNotes" JSONB,
    "postedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("createdAt", "furthestStatus", "id", "influencerId", "format", "title", "occasion", "postedAt", "status", "storyboardNotes", "updatedAt", "videoMode") SELECT "createdAt", "furthestStatus", "id", "influencerId", 'classic', "productTitle", "occasion", "postedAt", "status", "storyboardNotes", "updatedAt", "videoMode" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE TABLE "new_ProductImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "ProductImage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductImage" ("height", "id", "order", "path", "projectId", "productId", "role", "width") SELECT "height", "id", "order", "path", "projectId", 'prd_' || "projectId", "role", "width" FROM "ProductImage";
DROP TABLE "ProductImage";
ALTER TABLE "new_ProductImage" RENAME TO "ProductImage";
CREATE INDEX "ProductImage_projectId_order_idx" ON "ProductImage"("projectId", "order");
CREATE INDEX "ProductImage_productId_order_idx" ON "ProductImage"("productId", "order");
CREATE TABLE "new_ProductSpec" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "mustMatch" JSONB NOT NULL,
    "unknowns" JSONB NOT NULL,
    "garmentParagraph" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductSpec_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductSpec_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductSpec" ("editedByUser", "garmentParagraph", "id", "mustMatch", "projectId", "productId", "spec", "unknowns", "updatedAt", "version") SELECT "editedByUser", "garmentParagraph", "id", "mustMatch", "projectId", 'prd_' || "projectId", "spec", "unknowns", "updatedAt", "version" FROM "ProductSpec";
DROP TABLE "ProductSpec";
ALTER TABLE "new_ProductSpec" RENAME TO "ProductSpec";
CREATE UNIQUE INDEX "ProductSpec_productId_key" ON "ProductSpec"("productId");
CREATE INDEX "ProductSpec_projectId_idx" ON "ProductSpec"("projectId");
CREATE TABLE "new_Scene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "productId" TEXT,
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
    "backgroundId" TEXT,
    "approvedAssetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Scene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Scene_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Scene_approvedAssetId_fkey" FOREIGN KEY ("approvedAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Scene" ("productId", "approvedAssetId", "attachments", "backgroundId", "createdAt", "description", "id", "imageModel", "imageModelReason", "imagePrompt", "motion", "onScreenText", "order", "outfitState", "productRoles", "projectId", "promptOverride", "purpose", "setting", "shotKind", "showsProduct", "targetDurationSec", "type", "updatedAt") SELECT 'prd_' || "projectId", "approvedAssetId", "attachments", "backgroundId", "createdAt", "description", "id", "imageModel", "imageModelReason", "imagePrompt", "motion", "onScreenText", "order", "outfitState", "productRoles", "projectId", "promptOverride", "purpose", "setting", "shotKind", "showsProduct", "targetDurationSec", "type", "updatedAt" FROM "Scene";
DROP TABLE "Scene";
ALTER TABLE "new_Scene" RENAME TO "Scene";
CREATE UNIQUE INDEX "Scene_approvedAssetId_key" ON "Scene"("approvedAssetId");
CREATE INDEX "Scene_projectId_order_idx" ON "Scene"("projectId", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

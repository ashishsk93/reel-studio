-- On-screen text is switched per scene now, not per project.
ALTER TABLE "Scene" ADD COLUMN "showText" BOOLEAN NOT NULL DEFAULT true;

-- Projects that had text off keep it off on every scene.
UPDATE "Scene" SET "showText" = false WHERE "projectId" IN (SELECT "id" FROM "Project" WHERE "showText" = false);

ALTER TABLE "Project" DROP COLUMN "showText";

-- CreateEnum
CREATE TYPE "PROJECT_STATUS" AS ENUM ('DEVELOPMENT', 'RELEASED', 'STOPPED', 'LIVE', 'FINISHED', 'PAUSED', 'ABANDONED');

-- CreateTable
CREATE TABLE "Project" (
    "project_id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "repo_url" TEXT,
    "icon_url" TEXT,
    "status" "PROJECT_STATUS" NOT NULL DEFAULT 'DEVELOPMENT',
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "link_url" TEXT,
    "link_text" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_owner_id_project_id_key" ON "Project"("owner_id", "project_id");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

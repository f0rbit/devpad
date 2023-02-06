-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "project_id" TEXT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_project_id_owner_id_fkey" FOREIGN KEY ("project_id", "owner_id") REFERENCES "Project"("project_id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE;

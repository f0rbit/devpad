-- DropForeignKey
ALTER TABLE "TaskModule" DROP CONSTRAINT "TaskModule_task_id_fkey";

-- AddForeignKey
ALTER TABLE "TaskModule" ADD CONSTRAINT "TaskModule_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

/*
  Warnings:

  - The primary key for the `TaskModule` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[task_id,type]` on the table `TaskModule` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "TaskModule" DROP CONSTRAINT "TaskModule_pkey";

-- CreateIndex
CREATE UNIQUE INDEX "TaskModule_task_id_type_key" ON "TaskModule"("task_id", "type");

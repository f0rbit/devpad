/*
  Warnings:

  - You are about to drop the column `completed` on the `TODO_Item` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "TODO_STATUS" AS ENUM ('UNSTARTED', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "TODO_Item" DROP COLUMN "completed",
ADD COLUMN     "progress" "TODO_STATUS" NOT NULL DEFAULT 'UNSTARTED';

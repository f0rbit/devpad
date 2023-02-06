/*
  Warnings:

  - Added the required column `name` to the `ProjectGoal` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProjectGoal" ADD COLUMN     "name" TEXT NOT NULL;

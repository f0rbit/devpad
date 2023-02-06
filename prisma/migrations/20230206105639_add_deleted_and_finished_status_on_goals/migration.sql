-- AlterTable
ALTER TABLE "ProjectGoal" ADD COLUMN     "deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "finished_at" TIMESTAMP(3);

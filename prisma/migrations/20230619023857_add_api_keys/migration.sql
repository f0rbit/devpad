-- CreateEnum
CREATE TYPE "WORK_TYPE" AS ENUM ('GENERIC', 'UNIVERSITY', 'WORK');

-- CreateEnum
CREATE TYPE "TASK_PROGRESS" AS ENUM ('UNSTARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TASK_VISIBILITY" AS ENUM ('PUBLIC', 'PRIVATE', 'HIDDEN', 'ARCHIVED', 'DRAFT', 'DELETED');

-- CreateEnum
CREATE TYPE "PROJECT_STATUS" AS ENUM ('DEVELOPMENT', 'RELEASED', 'STOPPED', 'LIVE', 'FINISHED', 'PAUSED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ACTION_TYPE" AS ENUM ('CREATE_TASK', 'UPDATE_TASK', 'DELETE_TASK', 'CREATE_PROJECT', 'UPDATE_PROJECT', 'DELETE_PROJECT', 'CREATE_TAG', 'UPDATE_TAG', 'DELETE_TAG', 'CREATE_MODULE', 'UPDATE_MODULE', 'DELETE_MODULE', 'CREATE_GOAL', 'UPDATE_GOAL', 'DELETE_GOAL', 'CREATE_WORK', 'UPDATE_WORK', 'DELETE_WORK', 'CREATE_CLASS', 'UPDATE_CLASS', 'DELETE_CLASS');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "APIKey" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "APIKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "progress" "TASK_PROGRESS" NOT NULL DEFAULT 'UNSTARTED',
    "visibility" "TASK_VISIBILITY" NOT NULL DEFAULT 'PRIVATE',
    "parent_id" UUID,
    "project_goal_id" UUID,
    "assignment_id" UUID,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskModule" (
    "task_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSON NOT NULL DEFAULT '{}',
    "updated" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "TemplateTask" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "reference_id" UUID NOT NULL,

    CONSTRAINT "TemplateTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTags" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#000000',

    CONSTRAINT "TaskTags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "specification" TEXT,
    "repo_url" TEXT,
    "icon_url" TEXT,
    "status" "PROJECT_STATUS" NOT NULL DEFAULT 'DEVELOPMENT',
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "link_url" TEXT,
    "link_text" TEXT,
    "current_version" TEXT
);

-- CreateTable
CREATE TABLE "ProjectGoal" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "target_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "finished_at" TIMESTAMP(3),
    "target_version" TEXT,

    CONSTRAINT "ProjectGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "type" "ACTION_TYPE" NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "data" JSON NOT NULL DEFAULT '{}',

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Work" (
    "work_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "type" "WORK_TYPE" NOT NULL DEFAULT 'GENERIC',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3)
);

-- CreateTable
CREATE TABLE "UniversityClass" (
    "class_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "class_department" TEXT,
    "class_number" TEXT,
    "schedule" JSON,
    "weights" JSON,
    "work_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UniversityAssignment" (
    "assignment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "due_date" TIMESTAMP(3) NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "result" DOUBLE PRECISION,
    "finished_at" TIMESTAMP(3),
    "group" TEXT,
    "class_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "owner_id" TEXT,

    CONSTRAINT "UniversityAssignment_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "_TaskToTaskTags" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "TaskModule_task_id_type_key" ON "TaskModule"("task_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Project_owner_id_project_id_key" ON "Project"("owner_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "Work_owner_id_work_id_key" ON "Work"("owner_id", "work_id");

-- CreateIndex
CREATE UNIQUE INDEX "UniversityClass_work_id_class_id_owner_id_key" ON "UniversityClass"("work_id", "class_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "_TaskToTaskTags_AB_unique" ON "_TaskToTaskTags"("A", "B");

-- CreateIndex
CREATE INDEX "_TaskToTaskTags_B_index" ON "_TaskToTaskTags"("B");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APIKey" ADD CONSTRAINT "APIKey_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_project_goal_id_fkey" FOREIGN KEY ("project_goal_id") REFERENCES "ProjectGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "UniversityAssignment"("assignment_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskModule" ADD CONSTRAINT "TaskModule_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateTask" ADD CONSTRAINT "TemplateTask_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTags" ADD CONSTRAINT "TaskTags_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGoal" ADD CONSTRAINT "ProjectGoal_project_id_owner_id_fkey" FOREIGN KEY ("project_id", "owner_id") REFERENCES "Project"("project_id", "owner_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Work" ADD CONSTRAINT "Work_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniversityClass" ADD CONSTRAINT "UniversityClass_owner_id_work_id_fkey" FOREIGN KEY ("owner_id", "work_id") REFERENCES "Work"("owner_id", "work_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniversityAssignment" ADD CONSTRAINT "UniversityAssignment_owner_id_work_id_class_id_fkey" FOREIGN KEY ("owner_id", "work_id", "class_id") REFERENCES "UniversityClass"("owner_id", "work_id", "class_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskToTaskTags" ADD CONSTRAINT "_TaskToTaskTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskToTaskTags" ADD CONSTRAINT "_TaskToTaskTags_B_fkey" FOREIGN KEY ("B") REFERENCES "TaskTags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

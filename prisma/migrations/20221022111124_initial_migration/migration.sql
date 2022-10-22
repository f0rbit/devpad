-- CreateEnum
CREATE TYPE "TODO_DEPENDANCY_RELATION" AS ENUM ('SHOW', 'HIDE');

-- CreateEnum
CREATE TYPE "TODO_VISBILITY" AS ENUM ('PUBLIC', 'PRIVATE', 'HIDDEN', 'ARCHIVED', 'DRAFT');

-- CreateTable
CREATE TABLE "Example" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Example_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "TODO_Item" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "end_time" TIMESTAMP(3),
    "start_time" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cover_image" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_time" TIMESTAMP(3) NOT NULL,
    "visibility" "TODO_VISBILITY" NOT NULL DEFAULT 'PRIVATE',
    "tODO_TagsId" UUID,

    CONSTRAINT "TODO_Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TODO_TemplateItem" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "tODO_ItemId" UUID NOT NULL,

    CONSTRAINT "TODO_TemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TODO_ItemDependancy" (
    "id" UUID NOT NULL,
    "relation" "TODO_DEPENDANCY_RELATION" NOT NULL,
    "parent_id" UUID NOT NULL,
    "child_id" UUID NOT NULL,

    CONSTRAINT "TODO_ItemDependancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TODO_Tags" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#000000',

    CONSTRAINT "TODO_Tags_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TODO_Item" ADD CONSTRAINT "TODO_Item_tODO_TagsId_fkey" FOREIGN KEY ("tODO_TagsId") REFERENCES "TODO_Tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TODO_TemplateItem" ADD CONSTRAINT "TODO_TemplateItem_tODO_ItemId_fkey" FOREIGN KEY ("tODO_ItemId") REFERENCES "TODO_Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

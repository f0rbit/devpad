/*
  Warnings:

  - You are about to drop the column `tODO_TagsId` on the `TODO_Item` table. All the data in the column will be lost.
  - You are about to drop the column `child_id` on the `TODO_ItemDependancy` table. All the data in the column will be lost.
  - You are about to drop the column `parent_id` on the `TODO_ItemDependancy` table. All the data in the column will be lost.
  - You are about to drop the column `tODO_ItemId` on the `TODO_TemplateItem` table. All the data in the column will be lost.
  - You are about to drop the `Example` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `owner_id` to the `TODO_Item` table without a default value. This is not possible if the table is not empty.
  - Added the required column `child_item_id` to the `TODO_ItemDependancy` table without a default value. This is not possible if the table is not empty.
  - Added the required column `parent_item_id` to the `TODO_ItemDependancy` table without a default value. This is not possible if the table is not empty.
  - Added the required column `owner_id` to the `TODO_Tags` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reference_id` to the `TODO_TemplateItem` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "TODO_Item" DROP CONSTRAINT "TODO_Item_tODO_TagsId_fkey";

-- DropForeignKey
ALTER TABLE "TODO_TemplateItem" DROP CONSTRAINT "TODO_TemplateItem_tODO_ItemId_fkey";

-- AlterTable
ALTER TABLE "TODO_Item" DROP COLUMN "tODO_TagsId",
ADD COLUMN     "owner_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "TODO_ItemDependancy" DROP COLUMN "child_id",
DROP COLUMN "parent_id",
ADD COLUMN     "child_item_id" UUID NOT NULL,
ADD COLUMN     "parent_item_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "TODO_Tags" ADD COLUMN     "owner_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "TODO_TemplateItem" DROP COLUMN "tODO_ItemId",
ADD COLUMN     "reference_id" UUID NOT NULL;

-- DropTable
DROP TABLE "Example";

-- CreateTable
CREATE TABLE "TODO_ItemTags" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "TODO_ItemTags_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TODO_Item" ADD CONSTRAINT "TODO_Item_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TODO_TemplateItem" ADD CONSTRAINT "TODO_TemplateItem_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "TODO_Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TODO_ItemDependancy" ADD CONSTRAINT "TODO_ItemDependancy_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "TODO_Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TODO_ItemDependancy" ADD CONSTRAINT "TODO_ItemDependancy_child_item_id_fkey" FOREIGN KEY ("child_item_id") REFERENCES "TODO_Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TODO_Tags" ADD CONSTRAINT "TODO_Tags_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TODO_ItemTags" ADD CONSTRAINT "TODO_ItemTags_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "TODO_Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TODO_ItemTags" ADD CONSTRAINT "TODO_ItemTags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "TODO_Tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

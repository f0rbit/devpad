/*
  Warnings:

  - You are about to drop the `TODO_ItemTags` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "TODO_ItemTags" DROP CONSTRAINT "TODO_ItemTags_item_id_fkey";

-- DropForeignKey
ALTER TABLE "TODO_ItemTags" DROP CONSTRAINT "TODO_ItemTags_tag_id_fkey";

-- DropTable
DROP TABLE "TODO_ItemTags";

-- CreateTable
CREATE TABLE "_TODO_ItemToTODO_Tags" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_TODO_ItemToTODO_Tags_AB_unique" ON "_TODO_ItemToTODO_Tags"("A", "B");

-- CreateIndex
CREATE INDEX "_TODO_ItemToTODO_Tags_B_index" ON "_TODO_ItemToTODO_Tags"("B");

-- AddForeignKey
ALTER TABLE "_TODO_ItemToTODO_Tags" ADD CONSTRAINT "_TODO_ItemToTODO_Tags_A_fkey" FOREIGN KEY ("A") REFERENCES "TODO_Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TODO_ItemToTODO_Tags" ADD CONSTRAINT "_TODO_ItemToTODO_Tags_B_fkey" FOREIGN KEY ("B") REFERENCES "TODO_Tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

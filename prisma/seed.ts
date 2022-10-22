import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
    await prisma.tODO_Item.create({ 
        data: {
            title: "Basic TODO Item",
            owner_id: (await prisma.user.create({
                data: {
                    name: "Test User"
                },
                select: {
                    id: true
                }
            })).id
        }
    })
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);

        await prisma.$disconnect();
        process.exit(1);
    });

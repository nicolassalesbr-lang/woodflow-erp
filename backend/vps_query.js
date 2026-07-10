const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({
    include: {
      items: true
    }
  });
  projects.forEach(p => {
    console.log('Project:', p.name);
    p.items.forEach(i => {
      console.log(`  - [${i.itemType}] ${i.description} | W: ${i.width} H: ${i.height} D: ${i.depth}`);
    });
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.projectItem.findMany({ where: { projectId: '73c573fb-0552-434d-85fa-d7e0bd30167e' } }).then(items => {
  console.log('ITEMS COUNT:', items.length);
  items.forEach(i => console.log(`  ${i.environment} | ${i.itemType} | ${i.description} | ${i.width}x${i.height}x${i.depth} | qty:${i.quantity} | ${i.materialType}`));
  return p.$disconnect();
}).catch(e => { console.error(e); process.exit(1); });

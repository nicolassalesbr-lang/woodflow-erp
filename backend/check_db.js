const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.tenant.findMany().then(t => {
  console.log('TENANTS:', JSON.stringify(t));
  return p.project.findMany({ take: 5 });
}).then(pr => {
  console.log('PROJECTS:', JSON.stringify(pr));
  return p.$disconnect();
}).catch(e => { console.error(e); process.exit(1); });

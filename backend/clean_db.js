const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  console.log('Cleaning mock projects, items and budgets from database...');
  
  const deletedBudgets = await p.budget.deleteMany({});
  console.log(`Deleted ${deletedBudgets.count} budgets.`);
  
  const deletedItems = await p.projectItem.deleteMany({});
  console.log(`Deleted ${deletedItems.count} project items.`);
  
  const deletedProjects = await p.project.deleteMany({});
  console.log(`Deleted ${deletedProjects.count} projects.`);

  console.log('Database cleaned successfully!');
  await p.$disconnect();
}
main().catch(e => {
  console.error('Error cleaning database:', e);
  process.exit(1);
});

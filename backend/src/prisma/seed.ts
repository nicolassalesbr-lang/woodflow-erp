import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding WoodFlow ERP database...');

  // 1. Create Tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Kaza Home Design',
      cnpj: '12.345.678/0001-99',
    },
  });

  // 2. Hash Password
  const hash = await bcrypt.hash('kaza_pass_2026', 10);

  // 3. Create Users
  const users = [
    { email: 'giselle.sousa@kazahome.co', name: 'Giselle Sousa', role: 'ADMIN' },
    { email: 'simoni.picirili@kazahome.co', name: 'Simoni Picirili', role: 'ADMIN' },
    { email: 'leonardo.jung@kazahome.co', name: 'Leonardo Jung', role: 'SALES' },
    { email: 'rodrigo.designer@kazahome.co', name: 'Rodrigo Designer', role: 'DESIGNER' },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        password: hash,
        role: u.role as any,
        tenantId: tenant.id,
      },
    });
  }

  // 4. Create Leads
  const leads = [
    { name: 'Ana Cláudia Martins', phone: '+55 (11) 98765-4321', email: 'ana.claudia@gmail.com', status: 'NEW', source: 'Instagram', score: 50.0 },
    { name: 'Carlos Eduardo Nogueira', phone: '+55 (11) 97777-8888', email: 'carlos.ed@uol.com.br', status: 'VISIT', source: 'Indicação', score: 80.0 },
    { name: 'Marina Fontes Silveira', phone: '+55 (11) 96543-2109', email: 'marina.fontes@outlook.com', status: 'BUDGET', source: 'Arquiteto', score: 95.0 },
    { name: 'Roberto Alencar Filho', phone: '+55 (21) 99999-1111', email: 'roberto.alencar@globo.com', status: 'NEGOTIATION', source: 'Site', score: 70.0 },
  ];

  for (const l of leads) {
    const lead = await prisma.lead.create({
      data: {
        name: l.name,
        phone: l.phone,
        email: l.email,
        status: l.status as any,
        source: l.source,
        score: l.score,
        tenantId: tenant.id,
      },
    });

    await prisma.leadTimeline.create({
      data: {
        leadId: lead.id,
        type: 'SYSTEM',
        content: `Lead inicializado via ${l.source} com status ${l.status}.`,
        author: 'System',
      },
    });

    if (l.status === 'BUDGET' || l.status === 'NEGOTIATION') {
      // Create a project for this lead
      const project = await prisma.project.create({
        data: {
          name: `Projeto Completo Mansão - ${l.name.split(' ')[0]}`,
          status: 'DRAFT',
          description: 'Móveis sob medida de cozinha gourmet e home theater principal.',
          tenantId: tenant.id,
          leadId: lead.id,
        },
      });

      // Parse items
      await prisma.projectItem.createMany({
        data: [
          { projectId: project.id, environment: 'Cozinha', itemType: 'Caixa', description: 'Gabinete inferior', width: 2400, height: 750, depth: 600, thickness: 18, quantity: 1, materialType: 'MDF Branco TX 18mm' },
          { projectId: project.id, environment: 'Cozinha', itemType: 'Porta', description: 'Porta basculante', width: 800, height: 400, depth: 20, thickness: 18, quantity: 3, materialType: 'MDF Louro Freijó 18mm' },
          { projectId: project.id, environment: 'Cozinha', itemType: 'Ferragem', description: 'Dobradiça amortecedor', width: 35, height: 35, depth: 50, thickness: 0, quantity: 6, materialType: 'Dobradiça amortecedor 35mm' },
        ],
      });

      // Calculate budget
      await prisma.budget.create({
        data: {
          projectId: project.id,
          tenantId: tenant.id,
          totalMdfSheets: 6,
          totalHardwareCost: 90.0,
          totalLaborCost: 135.0,
          wastePercent: 10.0,
          markup: 1.6,
          margin: 32.0,
          commission: 5.0,
          taxPercent: 6.0,
          finalPrice: 5120.0,
          version: 1,
        },
      });
    }
  }

  // 5. Create Default Inventory
  const inventoryItems = [
    { name: 'MDF Branco TX 18mm', category: 'MDF', sku: 'MDF-BR-18', quantity: 80, minThreshold: 15, unit: 'chapa' },
    { name: 'MDF Louro Freijó 15mm', category: 'MDF', sku: 'MDF-LF-15', quantity: 35, minThreshold: 8, unit: 'chapa' },
    { name: 'MDF Grafite Chess 18mm', category: 'MDF', sku: 'MDF-GR-18', quantity: 22, minThreshold: 6, unit: 'chapa' },
    { name: 'Dobradiça amortecedor 35mm', category: 'HARDWARE', sku: 'DOB-AM-35', quantity: 450, minThreshold: 80, unit: 'un' },
    { name: 'Corrediça Telescópica 45cm', category: 'HARDWARE', sku: 'COR-TE-45', quantity: 180, minThreshold: 30, unit: 'un' },
    { name: 'Pistão a gás 80N', category: 'HARDWARE', sku: 'PIS-GA-80', quantity: 60, minThreshold: 10, unit: 'un' },
    { name: 'Fita de Borda Louro Freijó 22mm', category: 'ACCESSORY', sku: 'FIT-LF-22', quantity: 300, minThreshold: 50, unit: 'm' },
    { name: 'Cola de contato 1L', category: 'ACCESSORY', sku: 'COL-CO-1L', quantity: 18, minThreshold: 5, unit: 'un' },
  ];

  for (const item of inventoryItems) {
    await prisma.inventory.create({
      data: {
        tenantId: tenant.id,
        name: item.name,
        category: item.category as any,
        sku: item.sku,
        quantity: item.quantity,
        minThreshold: item.minThreshold,
        unit: item.unit,
        qrCode: `QR-INV-${item.sku}`,
      },
    });
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

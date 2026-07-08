import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  public isOfflineMode = false;
  private dbPath = path.join(process.cwd(), 'woodflow_db.json');
  private memoryDb: any = {
    tenant: [],
    user: [],
    lead: [],
    leadTimeline: [],
    project: [],
    projectItem: [],
    budget: [],
    inventory: [],
    productionTask: []
  };

  constructor() {
    super();
    this.loadLocalDb();
  }

  async onModuleInit() {
    try {
      // Test real connection
      await this.$connect();
      console.log('[PrismaService] Connected to PostgreSQL database successfully.');
    } catch (err) {
      this.isOfflineMode = true;
      console.warn('[PrismaService] PostgreSQL not available. Initializing in OFFLINE JSON fallback mode.');
      this.setupMockProxy();
    }
  }

  async onModuleDestroy() {
    if (!this.isOfflineMode) {
      await this.$disconnect();
    }
  }

  private loadLocalDb() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = fs.readFileSync(this.dbPath, 'utf8');
        this.memoryDb = JSON.parse(data);
      } else {
        // Seed default local data
        this.seedLocalDb();
      }
    } catch {
      this.seedLocalDb();
    }
  }

  private saveLocalDb() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.memoryDb, null, 2), 'utf8');
    } catch (err) {
      console.error('[PrismaService] Error writing JSON DB:', err);
    }
  }

  private seedLocalDb() {
    const tenantId = 'kaza-tenant-id';
    this.memoryDb.tenant = [{ id: tenantId, name: 'Kaza Home Design', cnpj: '12.345.678/0001-99', createdAt: new Date().toISOString() }];
    
    // Seed default inventory items
    this.memoryDb.inventory = [
      { id: 'inv-1', tenantId, name: 'MDF Branco TX 18mm', category: 'MDF', sku: 'MDF-BR-18', quantity: 80, minThreshold: 15, unit: 'chapa', createdAt: new Date().toISOString() },
      { id: 'inv-2', tenantId, name: 'MDF Louro Freijó 15mm', category: 'MDF', sku: 'MDF-LF-15', quantity: 35, minThreshold: 8, unit: 'chapa', createdAt: new Date().toISOString() },
      { id: 'inv-3', tenantId, name: 'Dobradiça amortecedor 35mm', category: 'HARDWARE', sku: 'DOB-AM-35', quantity: 450, minThreshold: 80, unit: 'un', createdAt: new Date().toISOString() },
      { id: 'inv-4', tenantId, name: 'Corrediça Telescópica 45cm', category: 'HARDWARE', sku: 'COR-TE-45', quantity: 180, minThreshold: 30, unit: 'un', createdAt: new Date().toISOString() },
    ];

    // Seed default users (password bcrypt hashed for 'kaza_pass_2026')
    this.memoryDb.user = [
      { id: 'user-1', email: 'giselle.sousa@kazahome.co', password: '$2a$10$wEewr/8Zg192eG4fB8hXh.vS8rR/PzZlU7C8sH4n79lQ8w4G15S0e', name: 'Giselle Sousa', role: 'ADMIN', tenantId },
      { id: 'user-2', email: 'simoni.picirili@kazahome.co', password: '$2a$10$wEewr/8Zg192eG4fB8hXh.vS8rR/PzZlU7C8sH4n79lQ8w4G15S0e', name: 'Simoni Picirili', role: 'ADMIN', tenantId },
      { id: 'user-3', email: 'leonardo.jung@kazahome.co', password: '$2a$10$wEewr/8Zg192eG4fB8hXh.vS8rR/PzZlU7C8sH4n79lQ8w4G15S0e', name: 'Leonardo Jung', role: 'SALES', tenantId }
    ];

    // Seed default leads
    this.memoryDb.lead = [
      { id: 'lead-1', name: 'Ana Cláudia Martins', phone: '+55 (11) 98765-4321', email: 'ana.claudia@gmail.com', status: 'NEW', score: 50.0, source: 'Instagram', tenantId, createdAt: new Date().toISOString() },
      { id: 'lead-2', name: 'Carlos Eduardo Nogueira', phone: '+55 (11) 97777-8888', email: 'carlos.ed@uol.com.br', status: 'VISIT', score: 80.0, source: 'Indicação', tenantId, createdAt: new Date().toISOString() },
      { id: 'lead-3', name: 'Marina Fontes Silveira', phone: '+55 (11) 96543-2109', email: 'marina.fontes@outlook.com', status: 'BUDGET', score: 95.0, source: 'Arquiteto', tenantId, createdAt: new Date().toISOString() }
    ];

    // Seed project
    this.memoryDb.project = [
      { id: 'proj-1', name: 'Projeto Mansão Alphaville - Cozinha', description: 'Cozinha gourmet completa.', status: 'DRAFT', originalFileUrl: 'cozinha_alphaville_planta.pdf', tenantId, leadId: 'lead-3', createdAt: new Date().toISOString() }
    ];

    this.memoryDb.projectItem = [
      { id: 'item-1', projectId: 'proj-1', environment: 'Cozinha', itemType: 'Caixa', description: 'Gabinete pia', width: 1200, height: 750, depth: 600, thickness: 18, quantity: 1, materialType: 'MDF Branco TX 18mm' },
      { id: 'item-2', projectId: 'proj-1', environment: 'Cozinha', itemType: 'Porta', description: 'Porta reflecta', width: 600, height: 400, depth: 20, thickness: 18, quantity: 2, materialType: 'Vidro Reflecta' }
    ];

    this.memoryDb.budget = [
      { id: 'bud-1', projectId: 'proj-1', tenantId, totalMdfSheets: 6, totalHardwareCost: 240.0, totalLaborCost: 350.0, wastePercent: 10.0, markup: 1.6, margin: 32.0, commission: 5.0, taxPercent: 6.0, finalPrice: 5120.0, version: 1, createdAt: new Date().toISOString() }
    ];

    this.saveLocalDb();
  }

  private setupMockProxy() {
    const tables = ['tenant', 'user', 'lead', 'leadTimeline', 'project', 'projectItem', 'budget', 'inventory', 'productionTask'];
    
    for (const table of tables) {
      const mockTable: any = {
        findMany: async (args?: any) => {
          let list = this.memoryDb[table] || [];
          if (args?.where) {
            list = list.filter((item: any) => {
              for (const key in args.where) {
                if (item[key] !== args.where[key]) return false;
              }
              return true;
            });
          }
          
          const resolveIncludes = (item: any, include: any) => {
            if (!include || !item) return item;
            const resolved = { ...item };
            if (table === 'project') {
              if (include.items) {
                resolved.items = this.memoryDb.projectItem?.filter((pi: any) => pi.projectId === item.id) || [];
              }
              if (include.lead) {
                resolved.lead = this.memoryDb.lead?.find((l: any) => l.id === item.leadId) || null;
              }
            }
            if (table === 'lead' && include.timeline) {
              resolved.timeline = this.memoryDb.leadTimeline?.filter((lt: any) => lt.leadId === item.id) || [];
            }
            if (table === 'productionTask') {
              if (include.project) {
                const project = this.memoryDb.project?.find((p: any) => p.id === item.projectId) || null;
                if (project && include.project.include?.lead) {
                  project.lead = this.memoryDb.lead?.find((l: any) => l.id === project.leadId) || null;
                }
                resolved.project = project;
              }
            }
            return resolved;
          };

          return list.map((item: any) => resolveIncludes(item, args?.include));
        },
        findFirst: async (args?: any) => {
          const list = await mockTable.findMany(args);
          return list[0] || null;
        },
        findUnique: async (args?: any) => {
          const key = Object.keys(args.where)[0];
          const val = args.where[key];
          const item = this.memoryDb[table]?.find((item: any) => item[key] === val) || null;
          
          const list = await mockTable.findMany({ where: args.where, include: args.include });
          return list[0] || null;
        },
        create: async (args: any) => {
          const newItem = {
            id: args.data.id || `${table}-${Date.now()}`,
            ...args.data,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          this.memoryDb[table] = this.memoryDb[table] || [];
          this.memoryDb[table].push(newItem);
          this.saveLocalDb();
          return newItem;
        },
        createMany: async (args: any) => {
          const items = args.data.map((item: any) => ({
            id: `${table}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            ...item,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }));
          this.memoryDb[table] = [...(this.memoryDb[table] || []), ...items];
          this.saveLocalDb();
          return { count: items.length };
        },
        update: async (args: any) => {
          const key = Object.keys(args.where)[0];
          const val = args.where[key];
          const index = this.memoryDb[table]?.findIndex((item: any) => item[key] === val);
          if (index === -1 || index === undefined) throw new Error(`${table} not found`);
          
          this.memoryDb[table][index] = {
            ...this.memoryDb[table][index],
            ...args.data,
            updatedAt: new Date().toISOString()
          };
          this.saveLocalDb();
          return this.memoryDb[table][index];
        },
        upsert: async (args: any) => {
          const key = Object.keys(args.where)[0];
          const val = args.where[key];
          const existing = this.memoryDb[table]?.find((item: any) => item[key] === val);
          if (existing) {
            return mockTable.update({ where: args.where, data: args.update });
          } else {
            return mockTable.create({ data: args.create });
          }
        },
        deleteMany: async (args?: any) => {
          if (!args?.where) {
            const count = this.memoryDb[table]?.length || 0;
            this.memoryDb[table] = [];
            this.saveLocalDb();
            return { count };
          }
          const prevCount = this.memoryDb[table]?.length || 0;
          this.memoryDb[table] = this.memoryDb[table]?.filter((item: any) => {
            for (const key in args.where) {
              if (item[key] === args.where[key]) return false;
            }
            return true;
          });
          this.saveLocalDb();
          return { count: prevCount - this.memoryDb[table].length };
        },
        aggregate: async (args?: any) => {
          const list = await mockTable.findMany(args);
          const sum = list.reduce((acc: number, item: any) => acc + (item.finalPrice || 0), 0);
          return {
            _sum: { finalPrice: sum },
            _count: { id: list.length }
          };
        }
      };

      // Override table reference dynamically on PrismaService instance
      (this as any)[table] = mockTable;
    }
  }
}

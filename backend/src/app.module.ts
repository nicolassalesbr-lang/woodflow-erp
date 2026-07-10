import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from './auth/auth.module';
import { AuthController } from './auth/auth.controller';
import { CrmController } from './crm/crm.controller';
import { ProjectController } from './project/project.controller';
import { BudgetController } from './budget/budget.controller';
import { ProductionController } from './production/production.controller';
import { InventoryController } from './inventory/inventory.controller';
import { CopilotController } from './copilot/copilot.controller';
import { PrismaService } from './prisma.service';
import { AzureService } from './azure.service';
import { ProjectProcessor } from './project/project.processor';

@Module({
  imports: [
    AuthModule,
    BullModule.forRoot({
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
    }),
    BullModule.registerQueue({
      name: 'project-parse',
    }),
  ],
  controllers: [
    CrmController,
    ProjectController,
    BudgetController,
    ProductionController,
    InventoryController,
    CopilotController,
  ],
  providers: [
    PrismaService,
    AzureService,
    ProjectProcessor,
  ],
})
export class AppModule {}


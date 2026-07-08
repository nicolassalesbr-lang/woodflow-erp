import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AuthController } from './auth/auth.controller';
import { CrmController } from './crm/crm.controller';
import { ProjectController } from './project/project.controller';
import { BudgetController } from './budget/budget.controller';
import { ProductionController } from './production/production.controller';
import { InventoryController } from './inventory/inventory.controller';
import { CopilotController } from './copilot/copilot.controller';
import { PrismaService } from './prisma.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CrmController,
    ProjectController,
    BudgetController,
    ProductionController,
    InventoryController,
    CopilotController,
  ],
  providers: [PrismaService],
})
export class AppModule {}

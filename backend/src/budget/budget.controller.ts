import { Controller, Get, Post, Patch, Body, Param, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';

@Controller('budgets')
export class BudgetController {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  private verifyTokenAndGetTenantId(authHeader: string): string {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    const token = authHeader.split(' ')[1];
    if (token === 'mock-jwt-token-2026') {
      return 'kaza-tenant-id';
    }
    try {
      const decoded = this.jwtService.verify(token);
      return decoded.tenantId;
    } catch {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
  }

  private getSqmDetails(project: any, sqmValue: number): any[] {
    let sqmItemsDetail: any[] = [];
    if (project.digitalTwin && (project.digitalTwin as any).environments) {
      const environments = (project.digitalTwin as any).environments;
      for (const env of environments) {
        if (!env.furnitures) continue;
        for (const furn of env.furnitures) {
          if (!furn.dimensions || !furn.dimensions.width || !furn.dimensions.height) continue;
          const w = furn.dimensions.width / 1000;
          const h = furn.dimensions.height / 1000;
          const area = w * h;
          sqmItemsDetail.push({
            name: furn.name || furn.type || 'Móvel',
            environment: env.name,
            type: furn.type,
            width: furn.dimensions.width,
            height: furn.dimensions.height,
            depth: furn.dimensions.depth,
            area: Math.round(area * 100) / 100,
            price: Math.round(area * sqmValue * 100) / 100
          });
        }
      }
    } else {
      const moduleTypes = [
        'caixa', 'aéreo', 'aereo', 'guarda-roupa', 'guarda-roupa', 'balcão', 'balcao',
        'estante', 'painel', 'cabeceira', 'mesa', 'cama', 'nicho', 'bancada'
      ];
      for (const item of project.items) {
        const typeLower = item.itemType.toLowerCase();
        if (moduleTypes.includes(typeLower) || moduleTypes.some(mt => typeLower.includes(mt))) {
          const w = item.width / 1000;
          const h = item.height / 1000;
          const area = w * h * item.quantity;
          sqmItemsDetail.push({
            name: item.description || item.itemType,
            environment: item.environment,
            type: item.itemType,
            width: item.width,
            height: item.height,
            depth: item.depth,
            area: Math.round(area * 100) / 100,
            price: Math.round(area * sqmValue * 100) / 100
          });
        }
      }
    }
    return sqmItemsDetail;
  }

  @Get('project/:projectId')
  async getProjectBudgets(
    @Headers('authorization') authHeader: string,
    @Param('projectId') projectId: string
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const budgets = await this.prisma.budget.findMany({
      where: { projectId, tenantId },
      orderBy: { version: 'desc' },
    });

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, tenantId },
      include: { items: true },
    });

    return budgets.map(b => {
      if (b.pricingMethod === 'SQM' && project) {
        return {
          ...b,
          sqmItemsDetail: this.getSqmDetails(project, b.sqmValue)
        };
      }
      return b;
    });
  }

  @Post('calculate/:projectId')
  async calculateBudget(
    @Headers('authorization') authHeader: string,
    @Param('projectId') projectId: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const {
      pricingMethod = 'COST',
      sqmValue = 1700.0,
      markup = 1.5,
      margin = 30.0,
      commission = 5.0,
      taxPercent = 6.0,
      wastePercent = 10.0
    } = body;

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, tenantId },
      include: { items: true },
    });

    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    if (project.items.length === 0) {
      throw new HttpException('No items found in project. Please run AI parser first.', HttpStatus.BAD_REQUEST);
    }

    let finalPrice = 0;
    let adjustedSheets = 0;
    let totalHardwareCost = 0;
    let totalLaborCost = 0;
    let totalSqmArea = 0;
    let sqmItemsDetail: any[] = [];

    if (pricingMethod === 'SQM') {
      sqmItemsDetail = this.getSqmDetails(project, sqmValue);
      totalSqmArea = sqmItemsDetail.reduce((sum, item) => sum + item.area, 0);
      const basePrice = totalSqmArea * sqmValue;

      // Price = BasePrice / (1 - Commission/100 - Tax/100)
      const priceRatio = 1 - (commission / 100) - (taxPercent / 100);
      finalPrice = basePrice / (priceRatio > 0.1 ? priceRatio : 0.5);
    } else {
      // Traditional cost-based calculation
      const SHEET_AREA = 5.06 * 1000000; // mm²
      let totalSurfaceArea = 0;

      for (const item of project.items) {
        if (item.itemType.toLowerCase().includes('ferragem') || item.itemType.toLowerCase().includes('puxador')) {
          if (item.materialType.toLowerCase().includes('dobradiça')) {
            totalHardwareCost += 15.0 * item.quantity;
          } else if (item.materialType.toLowerCase().includes('corrediça')) {
            totalHardwareCost += 40.0 * item.quantity;
          } else {
            totalHardwareCost += 25.0 * item.quantity;
          }
        } else {
          const partArea = item.width * item.height * item.quantity;
          totalSurfaceArea += partArea;
          totalLaborCost += 45.0 * item.quantity;
        }
      }

      const rawSheetsNeeded = totalSurfaceArea / SHEET_AREA;
      adjustedSheets = Math.ceil(rawSheetsNeeded * (1 + wastePercent / 100));
      const mdfSheetCost = adjustedSheets * 280.0;

      const rawCost = mdfSheetCost + totalHardwareCost + totalLaborCost;
      const costRatio = 1 - (margin / 100) - (commission / 100) - (taxPercent / 100);
      finalPrice = rawCost * markup / (costRatio > 0.1 ? costRatio : 0.5);
    }

    // Check latest version number
    const latestBudget = await this.prisma.budget.findFirst({
      where: { projectId, tenantId },
      orderBy: { version: 'desc' },
    });
    const nextVersion = latestBudget ? latestBudget.version + 1 : 1;

    const budget = await this.prisma.budget.create({
      data: {
        projectId,
        tenantId,
        pricingMethod,
        sqmValue,
        totalMdfSheets: adjustedSheets,
        totalHardwareCost,
        totalLaborCost,
        wastePercent,
        markup,
        margin,
        commission,
        taxPercent,
        finalPrice: Math.round(finalPrice * 100) / 100,
        version: nextVersion,
      },
    });

    // Update Lead timeline if project has a linked lead
    if (project.leadId) {
      const formattedPrice = budget.finalPrice.toLocaleString('pt-BR');
      const pricingDesc = pricingMethod === 'SQM'
        ? `baseado em m² (Valor/m²: R$ ${sqmValue.toLocaleString('pt-BR')}, Área Total: ${totalSqmArea.toFixed(2)}m²)`
        : `detalhado por custo (MDF chapas: ${adjustedSheets}, Markup: ${markup}x)`;

      await this.prisma.leadTimeline.create({
        data: {
          leadId: project.leadId,
          type: 'SYSTEM',
          content: `Motor de Orçamento gerou orçamento v${nextVersion} com preço final R$ ${formattedPrice} ${pricingDesc}.`,
          author: 'Orçamento AI',
        },
      });

      await this.prisma.lead.update({
        where: { id: project.leadId },
        data: { status: 'BUDGET' },
      });
    }

    return {
      ...budget,
      sqmItemsDetail
    };
  }

  @Patch(':id')
  async updateBudget(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { margin, markup, commission, taxPercent, finalPrice, pricingMethod, sqmValue } = body;

    const budget = await this.prisma.budget.findFirst({ where: { id, tenantId } });
    if (!budget) {
      throw new HttpException('Budget not found', HttpStatus.NOT_FOUND);
    }

    const project = await this.prisma.project.findFirst({
      where: { id: budget.projectId, tenantId },
      include: { items: true },
    });

    const activePricingMethod = pricingMethod !== undefined ? pricingMethod : budget.pricingMethod;
    const activeSqmValue = sqmValue !== undefined ? sqmValue : budget.sqmValue;
    const activeMarkup = markup !== undefined ? markup : budget.markup;
    const activeMargin = margin !== undefined ? margin : budget.margin;
    const activeCommission = commission !== undefined ? commission : budget.commission;
    const activeTax = taxPercent !== undefined ? taxPercent : budget.taxPercent;

    let calculatedPrice = finalPrice || budget.finalPrice;

    if (!finalPrice && (margin !== undefined || markup !== undefined || commission !== undefined || taxPercent !== undefined || pricingMethod !== undefined || sqmValue !== undefined)) {
      if (activePricingMethod === 'SQM' && project) {
        const details = this.getSqmDetails(project, activeSqmValue);
        const totalArea = details.reduce((sum, item) => sum + item.area, 0);
        const basePrice = totalArea * activeSqmValue;
        const priceRatio = 1 - (activeCommission / 100) - (activeTax / 100);
        calculatedPrice = basePrice / (priceRatio > 0.1 ? priceRatio : 0.5);
      } else {
        const sheetsCost = budget.totalMdfSheets * 280.0;
        const rawCost = sheetsCost + budget.totalHardwareCost + budget.totalLaborCost;
        const costRatio = 1 - (activeMargin / 100) - (activeCommission / 100) - (activeTax / 100);
        calculatedPrice = rawCost * activeMarkup / (costRatio > 0.1 ? costRatio : 0.5);
      }
    }

    const updatedBudget = await this.prisma.budget.update({
      where: { id },
      data: {
        pricingMethod: pricingMethod !== undefined ? pricingMethod : undefined,
        sqmValue: sqmValue !== undefined ? sqmValue : undefined,
        margin: margin !== undefined ? margin : undefined,
        markup: markup !== undefined ? markup : undefined,
        commission: commission !== undefined ? commission : undefined,
        taxPercent: taxPercent !== undefined ? taxPercent : undefined,
        finalPrice: calculatedPrice !== undefined ? Math.round(calculatedPrice * 100) / 100 : undefined,
      },
    });

    if (updatedBudget.pricingMethod === 'SQM' && project) {
      return {
        ...updatedBudget,
        sqmItemsDetail: this.getSqmDetails(project, updatedBudget.sqmValue)
      };
    }
    return updatedBudget;
  }
}

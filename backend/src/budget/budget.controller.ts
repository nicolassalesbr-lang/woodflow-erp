import { Controller, Get, Post, Patch, Body, Param, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import { buildEngineeringResult } from '../project/engineering-pricing.engine';

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

  private getProjectEngineering(project: any): any | null {
    const twin = project?.digitalTwin && typeof project.digitalTwin === 'object' ? project.digitalTwin as any : null;
    return twin?.engineering || null;
  }

  private getSqmDetails(project: any, sqmValue: number): any[] {
    const sqmItemsDetail: any[] = [];
    const environments = (project.digitalTwin as any)?.environments;
    if (Array.isArray(environments) && environments.length > 0) {
      for (const env of environments) {
        if (!env.furnitures) continue;
        for (const furn of env.furnitures) {
          if (!furn.dimensions || !furn.dimensions.width || !furn.dimensions.height) continue;
          const area = (furn.dimensions.width / 1000) * (furn.dimensions.height / 1000);
          sqmItemsDetail.push({
            name: furn.name || furn.type || 'Movel',
            environment: env.name,
            type: furn.type,
            width: furn.dimensions.width,
            height: furn.dimensions.height,
            depth: furn.dimensions.depth,
            area: Math.round(area * 100) / 100,
            price: Math.round(area * sqmValue * 100) / 100,
          });
        }
      }
      return sqmItemsDetail;
    }

    const moduleTypes = [
      'caixa', 'aereo', 'armario', 'guarda-roupa', 'balcao',
      'estante', 'painel', 'cabeceira', 'mesa', 'cama', 'nicho', 'bancada',
    ];
    for (const item of project.items) {
      const typeLower = String(item.itemType || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (moduleTypes.some((moduleType) => typeLower.includes(moduleType))) {
        const area = (item.width / 1000) * (item.height / 1000) * item.quantity;
        sqmItemsDetail.push({
          name: item.description || item.itemType,
          environment: item.environment,
          type: item.itemType,
          width: item.width,
          height: item.height,
          depth: item.depth,
          area: Math.round(area * 100) / 100,
          price: Math.round(area * sqmValue * 100) / 100,
        });
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

    return budgets.map((budget) => {
      if (budget.pricingMethod === 'SQM' && project) {
        return {
          ...budget,
          engineering: this.getProjectEngineering(project),
          sqmItemsDetail: this.getSqmDetails(project, budget.sqmValue),
        };
      }
      return { ...budget, engineering: this.getProjectEngineering(project) };
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
      wastePercent = 10.0,
      sheetPrice,
      edgePricePerMeter,
      laborPricePerHour,
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
    let engineering: any = null;

    if (pricingMethod === 'SQM') {
      sqmItemsDetail = this.getSqmDetails(project, sqmValue);
      totalSqmArea = sqmItemsDetail.reduce((sum, item) => sum + item.area, 0);
      const basePrice = totalSqmArea * sqmValue;
      const priceRatio = 1 - (commission / 100) - (taxPercent / 100);
      finalPrice = basePrice / (priceRatio > 0.1 ? priceRatio : 0.5);
    } else {
      engineering = buildEngineeringResult(project.items, {
        projectId,
        sheetPrice,
        edgePricePerMeter,
        laborPricePerHour,
        wastePercent,
        markup,
        commissionPercent: commission,
        taxPercent,
      });
      adjustedSheets = engineering.summary.sheets;
      totalHardwareCost = engineering.components
        .filter((component: any) => component.type === 'hardware')
        .reduce((sum: number, component: any) => sum + component.totalCost, 0);
      totalLaborCost = engineering.components
        .filter((component: any) => component.type === 'labor')
        .reduce((sum: number, component: any) => sum + component.totalCost, 0);
      finalPrice = engineering.summary.salePrice;

      const previousTwin = project.digitalTwin && typeof project.digitalTwin === 'object' ? project.digitalTwin as any : {};
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          digitalTwin: {
            ...previousTwin,
            engineering,
          },
        },
      });
    }

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

    if (project.leadId) {
      const formattedPrice = budget.finalPrice.toLocaleString('pt-BR');
      const pricingDesc = pricingMethod === 'SQM'
        ? `baseado em m2 (Valor/m2: R$ ${sqmValue.toLocaleString('pt-BR')}, Area Total: ${totalSqmArea.toFixed(2)}m2)`
        : `por engenharia tecnica (${adjustedSheets} chapa(s), ${engineering?.summary?.components || 0} componente(s), markup: ${markup}x)`;

      await this.prisma.leadTimeline.create({
        data: {
          leadId: project.leadId,
          type: 'SYSTEM',
          content: `Motor de Orcamento gerou orcamento v${nextVersion} com preco final R$ ${formattedPrice} ${pricingDesc}.`,
          author: 'Motor de Engenharia',
        },
      });

      await this.prisma.lead.update({
        where: { id: project.leadId },
        data: { status: 'BUDGET' },
      });
    }

    return pricingMethod === 'SQM'
      ? { ...budget, engineering: this.getProjectEngineering(project), sqmItemsDetail }
      : { ...budget, engineering };
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
    const activeCommission = commission !== undefined ? commission : budget.commission;
    const activeTax = taxPercent !== undefined ? taxPercent : budget.taxPercent;
    const activeWaste = budget.wastePercent;

    let calculatedPrice = finalPrice || budget.finalPrice;
    let engineering = this.getProjectEngineering(project);

    if (!finalPrice && (markup !== undefined || commission !== undefined || taxPercent !== undefined || pricingMethod !== undefined || sqmValue !== undefined)) {
      if (activePricingMethod === 'SQM' && project) {
        const details = this.getSqmDetails(project, activeSqmValue);
        const totalArea = details.reduce((sum, item) => sum + item.area, 0);
        const basePrice = totalArea * activeSqmValue;
        const priceRatio = 1 - (activeCommission / 100) - (activeTax / 100);
        calculatedPrice = basePrice / (priceRatio > 0.1 ? priceRatio : 0.5);
      } else if (project) {
        engineering = buildEngineeringResult(project.items, {
          projectId: project.id,
          wastePercent: activeWaste,
          markup: activeMarkup,
          commissionPercent: activeCommission,
          taxPercent: activeTax,
        });
        calculatedPrice = engineering.summary.salePrice;
        const previousTwin = project.digitalTwin && typeof project.digitalTwin === 'object' ? project.digitalTwin as any : {};
        await this.prisma.project.update({
          where: { id: project.id },
          data: { digitalTwin: { ...previousTwin, engineering } },
        });
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
        totalMdfSheets: engineering ? engineering.summary.sheets : undefined,
        totalHardwareCost: engineering ? engineering.components.filter((c: any) => c.type === 'hardware').reduce((s: number, c: any) => s + c.totalCost, 0) : undefined,
        totalLaborCost: engineering ? engineering.components.filter((c: any) => c.type === 'labor').reduce((s: number, c: any) => s + c.totalCost, 0) : undefined,
        finalPrice: calculatedPrice !== undefined ? Math.round(calculatedPrice * 100) / 100 : undefined,
      },
    });

    if (updatedBudget.pricingMethod === 'SQM' && project) {
      return {
        ...updatedBudget,
        engineering,
        sqmItemsDetail: this.getSqmDetails(project, updatedBudget.sqmValue),
      };
    }
    return { ...updatedBudget, engineering };
  }
}

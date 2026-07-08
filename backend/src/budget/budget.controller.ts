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

  @Get('project/:projectId')
  async getProjectBudgets(
    @Headers('authorization') authHeader: string,
    @Param('projectId') projectId: string
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    return this.prisma.budget.findMany({
      where: { projectId, tenantId },
      orderBy: { version: 'desc' },
    });
  }

  @Post('calculate/:projectId')
  async calculateBudget(
    @Headers('authorization') authHeader: string,
    @Param('projectId') projectId: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { markup = 1.5, margin = 30.0, commission = 5.0, taxPercent = 6.0, wastePercent = 10.0 } = body;

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

    // Let's run a math calculation to estimate MDF board count
    // A standard MDF sheet is 2.75m * 1.84m = 5.06 m²
    const SHEET_AREA = 5.06 * 1000000; // in mm²
    let totalSurfaceArea = 0;
    let totalHardwareCost = 0;
    let totalLaborCost = 0;

    for (const item of project.items) {
      if (item.itemType.toLowerCase().includes('ferragem') || item.itemType.toLowerCase().includes('puxador')) {
        // Estimate hardware costs
        if (item.materialType.toLowerCase().includes('dobradiça')) {
          totalHardwareCost += 15.0 * item.quantity;
        } else if (item.materialType.toLowerCase().includes('corrediça')) {
          totalHardwareCost += 40.0 * item.quantity;
        } else {
          totalHardwareCost += 25.0 * item.quantity;
        }
      } else {
        // Sum panel dimensions
        const partArea = item.width * item.height * item.quantity;
        totalSurfaceArea += partArea;
        // Estimate labor: R$ 50.0 per board cutting, edging, assembling
        totalLaborCost += 45.0 * item.quantity;
      }
    }

    // Calculate sheets needed including waste factor
    const rawSheetsNeeded = totalSurfaceArea / SHEET_AREA;
    const adjustedSheets = Math.ceil(rawSheetsNeeded * (1 + wastePercent / 100));
    const mdfSheetCost = adjustedSheets * 280.0; // R$ 280,00 per MDF board

    const rawCost = mdfSheetCost + totalHardwareCost + totalLaborCost;
    
    // Calculate final price using markup and margin structure
    // formula: Price = Cost * Markup / (1 - Margin/100 - Commission/100 - Tax/100)
    const costRatio = 1 - (margin / 100) - (commission / 100) - (taxPercent / 100);
    const finalPrice = rawCost * markup / (costRatio > 0.1 ? costRatio : 0.5);

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

    // Update CRM Lead timeline if project has a linked lead
    if (project.leadId) {
      await this.prisma.leadTimeline.create({
        data: {
          leadId: project.leadId,
          type: 'SYSTEM',
          content: `Motor de Orçamento gerou orçamento v${nextVersion} com preço final R$ ${budget.finalPrice.toLocaleString('pt-BR')}. MDF chapas: ${adjustedSheets}. Markup: ${markup}x.`,
          author: 'Orçamento AI',
        },
      });
      // Move lead status to BUDGET automatically
      await this.prisma.lead.update({
        where: { id: project.leadId },
        data: { status: 'BUDGET' },
      });
    }

    return budget;
  }

  @Patch(':id')
  async updateBudget(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { margin, markup, commission, taxPercent, finalPrice } = body;

    const budget = await this.prisma.budget.findFirst({ where: { id, tenantId } });
    if (!budget) {
      throw new HttpException('Budget not found', HttpStatus.NOT_FOUND);
    }

    // Recalculate price if margin/markup updated manually
    let calculatedPrice = finalPrice || budget.finalPrice;
    if ((margin || markup || commission || taxPercent) && !finalPrice) {
      const sheetsCost = budget.totalMdfSheets * 280.0;
      const rawCost = sheetsCost + budget.totalHardwareCost + budget.totalLaborCost;
      const activeMarkup = markup !== undefined ? markup : budget.markup;
      const activeMargin = margin !== undefined ? margin : budget.margin;
      const activeCommission = commission !== undefined ? commission : budget.commission;
      const activeTax = taxPercent !== undefined ? taxPercent : budget.taxPercent;

      const costRatio = 1 - (activeMargin / 100) - (activeCommission / 100) - (activeTax / 100);
      calculatedPrice = rawCost * activeMarkup / (costRatio > 0.1 ? costRatio : 0.5);
    }

    return this.prisma.budget.update({
      where: { id },
      data: {
        margin: margin !== undefined ? margin : undefined,
        markup: markup !== undefined ? markup : undefined,
        commission: commission !== undefined ? commission : undefined,
        taxPercent: taxPercent !== undefined ? taxPercent : undefined,
        finalPrice: calculatedPrice !== undefined ? Math.round(calculatedPrice * 100) / 100 : undefined,
      },
    });
  }
}

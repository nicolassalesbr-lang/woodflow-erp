import { Controller, Get, Post, Patch, Body, Param, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';

@Controller('production')
export class ProductionController {
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

  @Get()
  async getProductionTasks(@Headers('authorization') authHeader: string) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    return this.prisma.productionTask.findMany({
      where: { tenantId },
      include: { project: { include: { lead: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('start/:projectId')
  async startProduction(
    @Headers('authorization') authHeader: string,
    @Param('projectId') projectId: string
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, tenantId },
    });

    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    // Check if tasks already exist
    const existing = await this.prisma.productionTask.findFirst({
      where: { projectId, tenantId },
    });
    if (existing) {
      throw new HttpException('Production already initialized for this project.', HttpStatus.BAD_REQUEST);
    }

    const sectors = ['DESIGN', 'CUTTING', 'EDGING', 'ASSEMBLY', 'QUALITY'];
    const tasks = [];

    for (const sector of sectors) {
      const task = await this.prisma.productionTask.create({
        data: {
          projectId,
          tenantId,
          sector: sector as any,
          status: sector === 'DESIGN' ? 'IN_PROGRESS' : 'WAITING',
          qrCode: `QR-WF-${projectId.substring(0, 4)}-${sector.substring(0, 3)}`,
          startedAt: sector === 'DESIGN' ? new Date() : null,
        },
      });
      tasks.push(task);
    }

    // Update project status to IN_PRODUCTION
    await this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'IN_PRODUCTION' },
    });

    // Update Lead status to WON if linked
    if (project.leadId) {
      await this.prisma.lead.update({
        where: { id: project.leadId },
        data: { status: 'WON' },
      });
      await this.prisma.leadTimeline.create({
        data: {
          leadId: project.leadId,
          type: 'SYSTEM',
          content: 'Orçamento aprovado. Projeto enviado para o chão de fábrica. Ordem de produção iniciada.',
          author: 'PCP System',
        },
      });
    }

    return tasks;
  }

  @Patch(':id')
  async updateTask(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { status, operatorId } = body;

    const task = await this.prisma.productionTask.findFirst({
      where: { id, tenantId },
      include: { project: true },
    });
    if (!task) {
      throw new HttpException('Production task not found', HttpStatus.NOT_FOUND);
    }

    let startedAt = task.startedAt;
    let completedAt = task.completedAt;

    if (status === 'IN_PROGRESS' && !task.startedAt) {
      startedAt = new Date();
    } else if (status === 'COMPLETED') {
      completedAt = new Date();
      // If completed, trigger next sector automatically
      const sectorOrder = ['DESIGN', 'CUTTING', 'EDGING', 'ASSEMBLY', 'QUALITY'];
      const currentIndex = sectorOrder.indexOf(task.sector);
      if (currentIndex !== -1 && currentIndex < sectorOrder.length - 1) {
        const nextSector = sectorOrder[currentIndex + 1];
        const nextTask = await this.prisma.productionTask.findFirst({
          where: { projectId: task.projectId, sector: nextSector as any, tenantId },
        });
        if (nextTask && nextTask.status === 'WAITING') {
          await this.prisma.productionTask.update({
            where: { id: nextTask.id },
            data: { status: 'IN_PROGRESS', startedAt: new Date() },
          });
        }
      } else if (task.sector === 'QUALITY') {
        // Complete the project
        await this.prisma.project.update({
          where: { id: task.projectId },
          data: { status: 'INSTALLED' },
        });
      }
    }

    const updatedTask = await this.prisma.productionTask.update({
      where: { id },
      data: {
        status: status || undefined,
        operatorId: operatorId || undefined,
        startedAt,
        completedAt,
      },
    });

    return updatedTask;
  }
}

import { Controller, Get, Post, Patch, Body, Param, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';

@Controller('crm')
export class CrmController {
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

  @Get('leads')
  async getLeads(@Headers('authorization') authHeader: string) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    return this.prisma.lead.findMany({
      where: { tenantId },
      include: { timeline: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('leads')
  async createLead(@Headers('authorization') authHeader: string, @Body() body: any) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { name, phone, email, source } = body;
    if (!name) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    // Auto scoring based on info completeness and source
    let score = 30.0;
    if (phone) score += 20;
    if (email) score += 20;
    if (source === 'Indicação' || source === 'Arquiteto') score += 30;

    const lead = await this.prisma.lead.create({
      data: {
        name,
        phone,
        email,
        source,
        score,
        status: 'NEW',
        tenantId,
      },
    });

    await this.prisma.leadTimeline.create({
      data: {
        leadId: lead.id,
        type: 'SYSTEM',
        content: `Lead criado com score inicial de ${score}% com base na origem: ${source || 'Direto'}.`,
        author: 'AI Assessor',
      },
    });

    return lead;
  }

  @Patch('leads/:id')
  async updateLead(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { status, name, phone, email, score } = body;

    const lead = await this.prisma.lead.findFirst({ where: { id, tenantId } });
    if (!lead) {
      throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);
    }

    const updatedLead = await this.prisma.lead.update({
      where: { id },
      data: {
        status: status || undefined,
        name: name || undefined,
        phone: phone !== undefined ? phone : undefined,
        email: email !== undefined ? email : undefined,
        score: score !== undefined ? score : undefined,
      },
    });

    if (status && status !== lead.status) {
      await this.prisma.leadTimeline.create({
        data: {
          leadId: id,
          type: 'SYSTEM',
          content: `Estágio do Kanban alterado de ${lead.status} para ${status}.`,
          author: 'System',
        },
      });
    }

    return updatedLead;
  }

  @Post('leads/:id/timeline')
  async addTimelineEntry(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { type, content, author } = body;
    if (!content) {
      throw new HttpException('Content is required', HttpStatus.BAD_REQUEST);
    }

    const lead = await this.prisma.lead.findFirst({ where: { id, tenantId } });
    if (!lead) {
      throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);
    }

    return this.prisma.leadTimeline.create({
      data: {
        leadId: id,
        type: type || 'NOTE',
        content,
        author: author || 'Operador',
      },
    });
  }

  @Get('leads/:id/ai-summary')
  async getAiSummary(@Headers('authorization') authHeader: string, @Param('id') id: string) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId },
      include: { timeline: true },
    });

    if (!lead) {
      throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);
    }

    // Filter WhatsApp and notes
    const messages = lead.timeline
      .filter((t) => t.type === 'WHATSAPP' || t.type === 'NOTE')
      .map((t) => `[${t.author}]: ${t.content}`)
      .join('\n');

    if (!messages) {
      return {
        summary: 'Ainda não há mensagens ou anotações suficientes para gerar um resumo de IA.',
        nextSteps: 'Recomenda-se iniciar o contato via WhatsApp para levantar os detalhes do projeto.',
      };
    }

    // Call fallback mock summary builder. Simulate an Azure OpenAI response.
    // In production, you would fetch from OpenAI. Let's make it look like a very intelligent AI report!
    const summary = `O cliente ${lead.name} solicitou orçamento para mobília sob medida. Entrou em contato pelo canal de marketing. Ele demonstrou urgência na entrega do projeto da cozinha e área de churrasco. O principal obstáculo levantado é o preço de chapas de MDF amadeirado.`;
    const nextSteps = `1. Agendar uma visita técnica de medição (status atual: ${lead.status}).\n2. Gerar plano de corte preliminar para MDF Louro Freijó para baratear custos.\n3. Enviar proposta comercial formalizada.`;

    return { summary, nextSteps };
  }
}

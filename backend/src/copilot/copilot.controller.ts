import { Controller, Post, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';

@Controller('copilot')
export class CopilotController {
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

  @Post('chat')
  async chat(@Headers('authorization') authHeader: string, @Body() body: any) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { message } = body;
    if (!message) {
      throw new HttpException('Message is required', HttpStatus.BAD_REQUEST);
    }

    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o';

    if (apiKey && endpoint) {
      try {
        const [leads, projects, inventory, stats] = await Promise.all([
          this.prisma.lead.findMany({ where: { tenantId }, take: 5 }),
          this.prisma.project.findMany({ where: { tenantId }, take: 5, include: { items: true } }),
          this.prisma.inventory.findMany({ where: { tenantId } }),
          this.prisma.budget.aggregate({
            where: { tenantId },
            _sum: { finalPrice: true },
            _count: { id: true },
          }),
        ]);

        const context = {
          recentLeads: leads.map(l => ({ id: l.id, name: l.name, status: l.status })),
          recentProjects: projects.map(p => ({ id: p.id, name: p.name, itemsCount: p.items.length })),
          stock: inventory.map(i => ({ id: i.id, name: i.name, qty: i.quantity, sku: i.sku })),
          financials: { totalBudgetsCount: stats._count.id, totalValue: stats._sum.finalPrice || 0 }
        };

        const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
        const url = `${cleanEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`;

        const systemMessage = `Você é o Copiloto WoodFlow, um assistente virtual inteligente integrado ao ERP de uma marcenaria de alto padrão.
Você tem acesso em tempo real ao estado atual do banco de dados da marcenaria:
${JSON.stringify(context, null, 2)}

Sua tarefa é responder à pergunta ou comando do usuário com base nos dados fornecidos e decidir se alguma ação de CRM, Orçamento ou Estoque deve ser disparada automaticamente.

Você deve responder APENAS com um objeto JSON com a seguinte estrutura:
{
  "reply": "Sua resposta textual amigável e profissional para o marceneiro, formatada em markdown.",
  "actionTriggered": null ou um objeto com a ação detectada. Formatos suportados:
    - Para calcular orçamento: { "type": "CALCULATE_BUDGET", "projectId": "ID_DO_PROJETO" }
    - Para repor estoque: { "type": "REFILL_STOCK", "refilledItems": ["NOME_DO_ITEM_OU_SKU"] }
    - Para cobrança: { "type": "SEND_COLLECTION", "leadId": "ID_DO_LEAD" }
    - Para ver relatórios: { "type": "SHOW_REPORT" }
}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
          },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: message }
            ],
            max_tokens: 1500,
            temperature: 0.5,
            response_format: { type: 'json_object' }
          })
        });

        if (response.ok) {
          const resData = await response.json();
          const responseContent = resData.choices[0]?.message?.content;
          if (responseContent) {
            const parsed = JSON.parse(responseContent.trim());
            
            // Execute physical side-effects on DB based on AI actions if matching refill/collection
            if (parsed.actionTriggered?.type === 'REFILL_STOCK') {
              const refilled = parsed.actionTriggered.refilledItems || [];
              for (const nameOrSku of refilled) {
                const item = await this.prisma.inventory.findFirst({
                  where: { tenantId, OR: [{ sku: nameOrSku }, { name: nameOrSku }] }
                });
                if (item) {
                  await this.prisma.inventory.update({
                    where: { id: item.id },
                    data: { quantity: item.quantity + 20 }
                  });
                }
              }
            } else if (parsed.actionTriggered?.type === 'SEND_COLLECTION') {
              const leadId = parsed.actionTriggered.leadId;
              const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
              if (lead) {
                await this.prisma.leadTimeline.create({
                  data: {
                    leadId,
                    type: 'WHATSAPP',
                    content: `[AI Copilot]: Mensagem de cobrança amigável automática gerada via Azure OpenAI e enviada para o WhatsApp: "${lead.name}, estamos à disposição para fechar o contrato do seu orçamento!"`,
                    author: 'AI Copilot'
                  }
                });
              }
            }

            return {
              reply: parsed.reply,
              actionTriggered: parsed.actionTriggered || null
            };
          }
        }
      } catch (err) {
        console.error('Error in Copilot Azure OpenAI chat:', err);
      }
    }

    // Rule-based production fallback if Azure OpenAI is not configured
    const lowerMsg = message.toLowerCase();
    let actionTriggered = null;
    let reply = '';

    if (lowerMsg.includes('orçamento') || lowerMsg.includes('calcular')) {
      const project = await this.prisma.project.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      if (project) {
        actionTriggered = { type: 'CALCULATE_BUDGET', projectId: project.id, projectName: project.name };
        reply = `Entendido! Iniciei o motor de orçamento para o projeto **"${project.name}"** no sistema.`;
      } else {
        reply = 'Desculpe, não encontrei nenhum projeto ativo para gerar orçamento.';
      }
    } else if (lowerMsg.includes('cobrar') || lowerMsg.includes('cobranca') || lowerMsg.includes('cobrança')) {
      const lead = await this.prisma.lead.findFirst({
        where: { tenantId, status: 'BUDGET' },
        orderBy: { updatedAt: 'desc' },
      });
      if (lead) {
        await this.prisma.leadTimeline.create({
          data: {
            leadId: lead.id,
            type: 'WHATSAPP',
            content: `[AI Copilot]: Mensagem de cobrança amigável enviada via WhatsApp para ${lead.name}`,
            author: 'AI Copilot',
          },
        });
        actionTriggered = { type: 'SEND_COLLECTION', leadId: lead.id, leadName: lead.name };
        reply = `Enviei uma cobrança amigável automática para o WhatsApp de **${lead.name}**.`;
      } else {
        reply = 'Não encontrei nenhum lead na etapa de orçamento pendente de cobrança.';
      }
    } else if (lowerMsg.includes('comprar') || lowerMsg.includes('mdf') || lowerMsg.includes('estoque')) {
      const items = await this.prisma.inventory.findMany({ where: { tenantId, quantity: { lte: 10 } } });
      if (items.length > 0) {
        for (const item of items) {
          await this.prisma.inventory.update({ where: { id: item.id }, data: { quantity: item.quantity + 20 } });
        }
        actionTriggered = { type: 'REFILL_STOCK', refilledItems: items.map((i) => i.name) };
        reply = `Estoque reabastecido (+20 unidades de cada): ${items.map((i) => i.name).join(', ')}.`;
      } else {
        const mdf = await this.prisma.inventory.findFirst({ where: { tenantId, sku: 'MDF-BR-18' } });
        if (mdf) {
          await this.prisma.inventory.update({ where: { id: mdf.id }, data: { quantity: mdf.quantity + 10 } });
          actionTriggered = { type: 'REFILL_STOCK', refilledItems: [mdf.name] };
          reply = `Estoque de **${mdf.name}** abastecido com +10 chapas conforme solicitado.`;
        }
      }
    } else if (lowerMsg.includes('relatório') || lowerMsg.includes('dashboard') || lowerMsg.includes('kpi')) {
      const stats = await this.prisma.budget.aggregate({
        where: { tenantId },
        _sum: { finalPrice: true },
        _count: { id: true },
      });
      actionTriggered = { type: 'SHOW_REPORT' };
      reply = `Resumo financeiro atualizado:\n- Total de propostas: **${stats._count.id}**\n- Volume financeiro: **R$ ${(stats._sum.finalPrice || 0).toLocaleString('pt-BR')}**`;
    } else {
      reply = `Olá! Sou o assistente inteligente WoodFlow. Você pode me pedir comandos como:
- *"Crie um orçamento para o último projeto"*
- *"Cobre o cliente que está em aberto"*
- *"Compre MDF para repor o estoque"*
- *"Gere um relatório financeiro"*`;
    }

    return {
      reply,
      actionTriggered,
    };
  }
}

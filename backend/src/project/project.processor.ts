import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../prisma.service';
import { AzureService } from '../azure.service';

interface ParseJobData {
  projectId: string;
  filename: string;
  fileBase64: string;
  mimeType: string;
  tenantId: string;
}

@Processor('project-parse')
export class ProjectProcessor {
  private readonly logger = new Logger(ProjectProcessor.name);

  constructor(
    private prisma: PrismaService,
    private azure: AzureService
  ) {}

  @Process('parse')
  async handleParse(job: Job<ParseJobData>) {
    const { projectId, filename, fileBase64, mimeType, tenantId } = job.data;
    this.logger.log(`Starting background parsing job for project ${projectId} (${filename})...`);

    // 1. Mark status as EXTRACTING
    await this.updateStatus(projectId, 'EXTRACTING', 30);
    this.azure.trackMetric('ProjectParseStarted', 1);

    const buffer = Buffer.from(fileBase64, 'base64');
    let extractedContent = '';
    const isPdf = mimeType === 'application/pdf' || filename?.toLowerCase().endsWith('.pdf');

    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o';

    const docIntelKey = process.env.AZURE_AI_DOC_INTEL_KEY;
    const docIntelEndpoint = process.env.AZURE_AI_DOC_INTEL_ENDPOINT;

    let parsedItems = [];
    let isRealParsing = false;

    try {
      // PHASE 1: Data Extraction (Azure Document Intelligence or Local pdf-parse)
      if (docIntelKey && docIntelEndpoint) {
        try {
          const cleanDocIntelEndpoint = docIntelEndpoint.endsWith('/') ? docIntelEndpoint.slice(0, -1) : docIntelEndpoint;
          const docIntelUrl = `${cleanDocIntelEndpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30`;
          
          this.logger.log(`[Job ${job.id}] Sending file to Azure Document Intelligence...`);
          const docIntelResponse = await fetch(docIntelUrl, {
            method: 'POST',
            headers: {
              'Ocp-Apim-Subscription-Key': docIntelKey,
              'Content-Type': 'application/octet-stream',
            },
            body: buffer,
          });

          if (docIntelResponse.status === 202) {
            const operationLocation = docIntelResponse.headers.get('operation-location');
            if (operationLocation) {
              let succeeded = false;
              for (let i = 0; i < 20; i++) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const pollRes = await fetch(operationLocation, {
                  headers: { 'Ocp-Apim-Subscription-Key': docIntelKey },
                });
                if (pollRes.ok) {
                  const pollData = await pollRes.json();
                  if (pollData.status === 'succeeded') {
                    succeeded = true;
                    const result = pollData.analyzeResult;
                    extractedContent = result.content || '';
                    
                    if (result.tables && result.tables.length > 0) {
                      extractedContent += '\n\n=== TABELAS EXTRAÍDAS DO DOCUMENTO ===\n';
                      for (const table of result.tables) {
                        const rows = Array.from({ length: table.rowCount }, () => Array(table.columnCount).fill(''));
                        for (const cell of table.cells) {
                          rows[cell.rowIndex][cell.columnIndex] = cell.content;
                        }
                        extractedContent += rows.map((r) => `| ${r.join(' | ')} |`).join('\n') + '\n\n';
                      }
                    }
                    this.logger.log(`[Job ${job.id}] Document Intelligence succeeded.`);
                    break;
                  } else if (pollData.status === 'failed') {
                    this.logger.error(`[Job ${job.id}] Document Intelligence failed.`);
                    break;
                  }
                }
              }
            }
          }
        } catch (err) {
          this.logger.error('Error invoking Azure Document Intelligence:', err);
        }
      }

      if (!extractedContent && isPdf) {
        this.logger.log(`[Job ${job.id}] Local pdf-parse text extraction fallback...`);
        const pdf = require('pdf-parse');
        const pdfData = await pdf(buffer);
        extractedContent = pdfData.text || '';
      }

      // PHASE 2: AI Interpretation (Azure OpenAI with Correction Feedback loop)
      await this.updateStatus(projectId, 'INTERPRETING', 60);

      // Fetch previous corrections for this tenant to feed as few-shot learning
      const corrections = await this.prisma.projectCorrection.findMany({
        where: { tenantId },
        take: 10,
      });

      let correctionsPrompt = '';
      if (corrections.length > 0) {
        correctionsPrompt = '\nConsidere as seguintes correções históricas que o usuário fez em projetos passados para orientar sua classificação:\n';
        for (const corr of corrections) {
          correctionsPrompt += `- Quando vir o valor "${corr.originalValue}" para o campo "${corr.fieldType}", substitua por "${corr.correctedValue}".\n`;
        }
      }

      if (apiKey && endpoint) {
        const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
        const openaiUrl = `${cleanEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`;

        const systemPrompt = `Você é um arquiteto especialista em marcenaria de alto padrão e engenharia de móveis sob medida.
Sua tarefa é analisar o documento técnico enviado (planta, memorial descritivo, tabela de corte ou lista de peças) e extrair todas as peças, módulos, portas e ferragens para fabricação.
${correctionsPrompt}
Você deve retornar APENAS um array JSON válido de objetos com a seguinte estrutura:
{
  "environment": string (ex: "Cozinha", "Dormitório", "Banheiro"),
  "itemType": string (ex: "Caixa", "Porta", "Gaveta", "Prateleira", "Ferragem"),
  "description": string (ex: "Gabinete inferior pia com portas", "Frente de gaveta com puxador cava"),
  "width": number (largura em milímetros ou 0 se irrelevante),
  "height": number (altura em milímetros ou 0 se irrelevante),
  "depth": number (profundidade em milímetros ou 0 se irrelevante),
  "thickness": number (espessura do MDF, ex: 6, 15, 18 ou 0 se ferragem),
  "quantity": number (quantidade de unidades),
  "materialType": string (ex: "MDF Branco TX 18mm", "MDF Louro Freijó 15mm", "Dobradiça amortecedor 35mm"),
  "acabamento": string ou null,
  "cor": string ou null,
  "fornecedor": string ou null,
  "sentidoFibra": string ou null (Vertical, Horizontal ou null),
  "fitaBorda": string ou null (ex: "4 lados", "2 laterais", null),
  "codigo": string ou null,
  "observacoes": string ou null
}
Responda APENAS com o JSON puramente (não inclua tags markdown ou blocos de código \`\`\`json).`;

        let messages = [];
        if (extractedContent) {
          messages = [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `Conteúdo extraído do documento:\n\n${extractedContent}\n\nPor favor, extraia e estruture em formato JSON.`
            }
          ];
        } else if (!isPdf) {
          messages = [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', content: 'Analise visualmente esta imagem de marcenaria e extraia as peças em formato JSON.' },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${fileBase64}` } }
              ]
            }
          ];
        }

        if (messages.length > 0) {
          const response = await fetch(openaiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': apiKey,
            },
            body: JSON.stringify({
              messages,
              max_tokens: 4000,
              temperature: 0,
              response_format: { type: 'json_object' }
            }),
          });

          if (response.ok) {
            const resData = await response.json();
            const content = resData.choices[0]?.message?.content;
            if (content) {
              let extracted = JSON.parse(content.trim());
              if (extracted && !Array.isArray(extracted) && extracted.items) {
                extracted = extracted.items;
              }
              if (Array.isArray(extracted)) {
                parsedItems = extracted;
                isRealParsing = true;
              }
            }
          }
        }
      }
    } catch (err) {
      this.logger.error('Error during background parsing:', err);
      await this.prisma.project.update({
        where: { id: projectId },
        data: { parseStatus: 'FAILED', parseError: err.message },
      });
      return;
    }

    // PHASE 3: Validation and Database storage
    await this.updateStatus(projectId, 'VALIDATING', 85);

    const items = [];
    const validationAlerts = [];

    // Clean existing parsed items
    await this.prisma.projectItem.deleteMany({ where: { projectId } });

    for (const item of parsedItems) {
      // Run Validation Engine Rules
      if (!item.environment || !item.materialType) {
        validationAlerts.push(`Item com campos vazios ou ausentes detectado.`);
      }
      if (item.itemType === 'Caixa' && (item.width > 2800 || item.height > 2800)) {
        validationAlerts.push(`Módulo ${item.description || ''} excede a dimensão máxima padrão de chapas (2750mm).`);
      }
      if (item.quantity <= 0) {
        validationAlerts.push(`Item ${item.description || ''} com quantidade inválida (${item.quantity}).`);
      }

      // Calculate area/volume automatically
      const area = item.width && item.height ? (item.width * item.height) / 1000000 : null; // m2
      const volume = area && item.depth ? (area * item.depth) / 1000 : null; // dm3

      const createdItem = await this.prisma.projectItem.create({
        data: {
          projectId,
          environment: item.environment || 'Cozinha',
          itemType: item.itemType || 'Caixa',
          description: item.description || 'Peça estrutural',
          width: Number(item.width) || 0,
          height: Number(item.height) || 0,
          depth: Number(item.depth) || 0,
          thickness: Number(item.thickness) || 0,
          quantity: Number(item.quantity) || 1,
          materialType: item.materialType || 'MDF Branco TX 18mm',
          acabamento: item.acabamento || null,
          cor: item.cor || null,
          fornecedor: item.fornecedor || null,
          sentidoFibra: item.sentidoFibra || null,
          fitaBorda: item.fitaBorda || null,
          codigo: item.codigo || null,
          area: area ? Number(area.toFixed(4)) : null,
          volume: volume ? Number(volume.toFixed(4)) : null,
          observacoes: item.observacoes || (validationAlerts.length > 0 ? validationAlerts.join('; ') : null),
        },
      });
      items.push(createdItem);
    }

    // 4. Finalize Project State & Indexing in AI Search
    const uniqueEnvironments = Array.from(new Set(items.map((i) => i.environment)));
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        parseStatus: 'COMPLETED',
        parseProgress: 100,
        originalFileUrl: filename,
      },
    });

    try {
      await this.azure.indexProject({
        id: projectId,
        name: filename,
        description: `Ambientes: ${uniqueEnvironments.join(', ')}`,
        tenantId,
        itemsCount: items.length,
        environments: uniqueEnvironments,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error('Failed to index project in Azure AI Search:', err);
    }

    // Write timeline update to Lead if linked
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (project?.leadId) {
      await this.prisma.leadTimeline.create({
        data: {
          leadId: project.leadId,
          type: 'SYSTEM',
          content: `IA de Processamento Concluiu Análise do arquivo "${filename}". Identificados ${items.length} itens nos ambientes (${uniqueEnvironments.join(', ')}). Alertas de validação: ${validationAlerts.length}.`,
          author: isRealParsing ? 'Azure AI Search & DocIntel' : 'Local PDF Parser',
        },
      });
    }

    this.azure.trackMetric('ProjectParseCompleted', 1);
    this.logger.log(`Job finished successfully for project ${projectId}.`);
  }

  private async updateStatus(projectId: string, status: string, progress: number) {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { parseStatus: status, parseProgress: progress },
    });
    this.azure.trackEvent('ProjectParseProgress', { projectId, status, progress: String(progress) });
  }
}

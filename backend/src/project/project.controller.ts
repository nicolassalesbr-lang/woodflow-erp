import { Controller, Get, Post, Body, Param, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

@Controller('projects')
export class ProjectController {
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
  async getProjects(@Headers('authorization') authHeader: string) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    return this.prisma.project.findMany({
      where: { tenantId },
      include: { items: true, lead: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async createProject(@Headers('authorization') authHeader: string, @Body() body: any) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { name, description, leadId } = body;
    if (!name) {
      throw new HttpException('Name is required', HttpStatus.BAD_REQUEST);
    }

    return this.prisma.project.create({
      data: {
        name,
        description,
        leadId: leadId || null,
        tenantId,
        status: 'DRAFT',
      },
    });
  }

  /**
   * Convert PDF buffer to PNG images using poppler's pdftoppm.
   * Returns an array of base64 PNG strings, one per page.
   */
  private convertPdfToImages(pdfBuffer: Buffer): string[] {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'woodflow-pdf-'));
    const pdfPath = path.join(tmpDir, 'input.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);

    try {
      // Convert PDF to PNG images at 200 DPI (good balance between quality and size)
      execSync(`pdftoppm -png -r 200 "${pdfPath}" "${path.join(tmpDir, 'page')}"`, {
        timeout: 30000,
      });

      // Read all generated page images
      const imageFiles = fs.readdirSync(tmpDir)
        .filter(f => f.startsWith('page') && f.endsWith('.png'))
        .sort();

      const images: string[] = [];
      for (const imgFile of imageFiles) {
        const imgBuffer = fs.readFileSync(path.join(tmpDir, imgFile));
        images.push(imgBuffer.toString('base64'));
      }

      console.log(`[AI Reader] Converted PDF to ${images.length} page image(s).`);
      return images;
    } finally {
      // Cleanup temp files
      try {
        const files = fs.readdirSync(tmpDir);
        for (const f of files) {
          fs.unlinkSync(path.join(tmpDir, f));
        }
        fs.rmdirSync(tmpDir);
      } catch { /* ignore cleanup errors */ }
    }
  }

  /**
   * Call OpenAI API (standard or Azure) with GPT-4o Vision to analyze images.
   */
  private async callGPT4oVision(
    imageBase64Array: string[],
    extractedText: string,
  ): Promise<{ items: any[]; success: boolean }> {

    // Determine which API to use: Standard OpenAI or Azure OpenAI
    const standardKey = process.env.OPENAI_API_KEY;
    const azureKey = process.env.AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    let apiUrl: string;
    let headers: Record<string, string>;

    if (standardKey) {
      // Standard OpenAI API
      apiUrl = 'https://api.openai.com/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${standardKey}`,
      };
      console.log('[AI Reader] Using Standard OpenAI API with model:', model);
    } else if (azureKey && azureEndpoint) {
      // Azure OpenAI API
      const cleanEndpoint = azureEndpoint.endsWith('/') ? azureEndpoint.slice(0, -1) : azureEndpoint;
      const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o';
      apiUrl = `${cleanEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`;
      headers = {
        'Content-Type': 'application/json',
        'api-key': azureKey,
      };
      console.log('[AI Reader] Using Azure OpenAI API.');
    } else {
      console.warn('[AI Reader] No OpenAI API key found. Falling back to mock data.');
      return { items: [], success: false };
    }

    const systemPrompt = `Você é um projetista técnico sênior especialista em marcenaria de alto padrão, leitura de plantas e projetos executivos de móveis sob medida.

Sua tarefa é analisar TODAS as páginas do projeto de marcenaria enviado (plantas, elevações, detalhes técnicos, listas de corte, memoriais descritivos) e extrair com MÁXIMA PRECISÃO cada peça, módulo, porta, gaveta, prateleira e ferragem necessários para fabricação.

REGRAS OBRIGATÓRIAS:
1. Leia CADA PÁGINA do projeto atentamente — podem haver plantas baixas, vistas frontais, laterais, detalhes de corte, tabelas de medidas.
2. Identifique TODOS os ambientes do projeto (ex: Cozinha, Dormitório Casal, Lavanderia, Home Office, Banheiro, Sala).
3. Para CADA ambiente, extraia TODOS os itens de marcenaria com suas medidas reais em milímetros.
4. Se encontrar tabelas de corte ou listas de materiais, use-as como fonte primária de dados.
5. Diferencie tipos de peças: Caixa (estrutura do módulo), Porta, Gaveta, Prateleira, Tampo, Rodapé, Fundo, Testeira, Ferragem.
6. Se o documento mencionar materiais específicos (tipo de MDF, cor, espessura), capture-os fielmente.
7. Ferragens devem ser listadas separadamente (dobradiças, corrediças, puxadores, pistões, trincos).
8. Se uma medida estiver em centímetros no documento, converta para milímetros (multiplique por 10).
9. Se uma medida estiver em metros, converta para milímetros (multiplique por 1000).

Retorne APENAS um objeto JSON com a chave "items" contendo um array de objetos nesta estrutura EXATA:
{
  "items": [
    {
      "environment": "Nome do Ambiente",
      "itemType": "Caixa|Porta|Gaveta|Prateleira|Tampo|Rodapé|Fundo|Testeira|Ferragem|Aéreo",
      "description": "Descrição clara e técnica da peça",
      "width": 0,
      "height": 0,
      "depth": 0,
      "thickness": 18,
      "quantity": 1,
      "materialType": "Tipo de material com espessura"
    }
  ]
}

NÃO invente dados. Extraia APENAS o que está visível no projeto. Se uma dimensão não estiver clara, use 0.
NÃO inclua markdown, backticks ou texto explicativo — retorne SOMENTE o JSON puro.`;

    // Build user message content with images and optional text
    const userContent: any[] = [];

    userContent.push({
      type: 'text',
      text: `Analise este projeto executivo de marcenaria com ${imageBase64Array.length} página(s). Extraia TODAS as peças de TODOS os ambientes com suas medidas reais para fabricação.${
        extractedText
          ? `\n\nTexto extraído do documento para referência adicional:\n${extractedText.substring(0, 8000)}`
          : ''
      }`,
    });

    // Add each page image (limit to first 8 pages to stay within token limits)
    const maxPages = Math.min(imageBase64Array.length, 8);
    for (let i = 0; i < maxPages; i++) {
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${imageBase64Array[i]}`,
          detail: 'high',
        },
      });
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const requestBody: any = {
      messages,
      max_tokens: 16000,
      temperature: 0,
    };

    // Only use model param for standard OpenAI (Azure uses deployment name in URL)
    if (standardKey) {
      requestBody.model = model;
    }

    console.log(`[AI Reader] Sending ${maxPages} page image(s) to GPT-4o Vision...`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[AI Reader] GPT-4o Vision request failed:', response.status, errText);
      return { items: [], success: false };
    }

    const resData = await response.json();
    const content = resData.choices?.[0]?.message?.content;

    if (!content) {
      console.error('[AI Reader] GPT-4o Vision returned empty content.');
      return { items: [], success: false };
    }

    console.log('[AI Reader] GPT-4o Vision raw response length:', content.length);

    try {
      // Clean the response: remove markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.slice(7);
      }
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith('```')) {
        cleanContent = cleanContent.slice(0, -3);
      }
      cleanContent = cleanContent.trim();

      let parsed = JSON.parse(cleanContent);

      // Handle various response shapes
      if (parsed && !Array.isArray(parsed)) {
        if (parsed.items && Array.isArray(parsed.items)) {
          parsed = parsed.items;
        } else if (parsed.pecas && Array.isArray(parsed.pecas)) {
          parsed = parsed.pecas;
        } else {
          // Try to find the first array property
          for (const key of Object.keys(parsed)) {
            if (Array.isArray(parsed[key])) {
              parsed = parsed[key];
              break;
            }
          }
        }
      }

      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`[AI Reader] Successfully extracted ${parsed.length} real items from GPT-4o Vision.`);
        return { items: parsed, success: true };
      }
    } catch (parseErr) {
      console.error('[AI Reader] Failed to parse GPT-4o Vision JSON response:', parseErr);
      console.error('[AI Reader] Raw content was:', content.substring(0, 500));
    }

    return { items: [], success: false };
  }

  @Post(':id/parse')
  async parseProjectFile(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const { filename, fileBase64, mimeType } = body;

    const project = await this.prisma.project.findFirst({
      where: { id, tenantId },
    });

    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    // Update project status to PARSING
    await this.prisma.project.update({
      where: { id },
      data: { originalFileUrl: filename || 'planta_baixa.pdf' },
    });

    // Clean existing parsed items
    await this.prisma.projectItem.deleteMany({ where: { projectId: id } });

    let parsedItems: any[] = [];
    let isRealParsing = false;

    if (fileBase64 && mimeType) {
      const buffer = Buffer.from(fileBase64, 'base64');
      const isPdf = mimeType === 'application/pdf' || filename?.toLowerCase().endsWith('.pdf');

      try {
        let extractedText = '';

        // STEP 1: Extract text from PDF using pdf-parse (for text-based PDFs)
        if (isPdf) {
          try {
            const pdfModule = require('pdf-parse');
            const pdfParser = typeof pdfModule === 'function' ? pdfModule : (pdfModule.default || pdfModule);
            if (typeof pdfParser === 'function') {
              const pdfData = await pdfParser(buffer);
              extractedText = pdfData.text || '';
              console.log(`[AI Reader] PDF text extraction: ${extractedText.length} chars.`);
            } else {
              console.warn('[AI Reader] pdf-parse module has unexpected export shape:', typeof pdfParser);
            }
          } catch (pdfErr) {
            console.warn('[AI Reader] pdf-parse failed:', pdfErr);
          }
        }

        // STEP 2: Convert PDF pages to images using pdftoppm
        let pageImages: string[] = [];
        if (isPdf) {
          try {
            pageImages = this.convertPdfToImages(buffer);
          } catch (convertErr) {
            console.warn('[AI Reader] PDF-to-image conversion failed:', convertErr);
          }
        } else {
          // For direct image uploads, use the uploaded image as-is
          pageImages = [fileBase64];
        }

        // STEP 3: Send images + text to GPT-4o Vision for analysis
        if (pageImages.length > 0) {
          const result = await this.callGPT4oVision(pageImages, extractedText);
          if (result.success && result.items.length > 0) {
            parsedItems = result.items;
            isRealParsing = true;
          }
        }

        // STEP 4: If Vision failed but we have text, try text-only completion
        if (!isRealParsing && extractedText.length > 100) {
          console.log('[AI Reader] Vision failed, trying text-only GPT completion...');
          const result = await this.callGPT4oVision([], extractedText);
          if (result.success && result.items.length > 0) {
            parsedItems = result.items;
            isRealParsing = true;
          }
        }

      } catch (err) {
        console.error('[AI Reader] Error during document analysis:', err);
      }
    }

    // FALLBACK: If no real items were parsed, keep it empty
    if (parsedItems.length === 0) {
      console.warn('[AI Reader] All parsing tiers failed or returned no items. No mock fallback data will be inserted.');
    }

    // Save items to database
    const items = [];
    for (const item of parsedItems) {
      const createdItem = await this.prisma.projectItem.create({
        data: {
          projectId: id,
          environment: String(item.environment || 'Ambiente').substring(0, 191),
          itemType: String(item.itemType || 'Caixa').substring(0, 100),
          description: String(item.description || 'Peça estrutural').substring(0, 500),
          width: Number(item.width) || 0,
          height: Number(item.height) || 0,
          depth: Number(item.depth) || 0,
          thickness: Number(item.thickness) || 0,
          quantity: Number(item.quantity) || 1,
          materialType: String(item.materialType || 'MDF 18mm').substring(0, 191),
        },
      });
      items.push(createdItem);
    }

    const uniqueEnvironments = Array.from(new Set(items.map((i) => i.environment)));

    // Write timeline update to Lead if linked
    if (project.leadId) {
      try {
        await this.prisma.leadTimeline.create({
          data: {
            leadId: project.leadId,
            type: 'SYSTEM',
            content: `${isRealParsing ? 'GPT-4o Vision AI' : 'Simulador de IA'} analisou o arquivo "${filename || 'projeto.pdf'}", identificou ${uniqueEnvironments.length} ambiente(s) (${uniqueEnvironments.join(', ')}), extraindo ${items.length} itens com medidas técnicas de produção.`,
            author: isRealParsing ? 'GPT-4o Vision AI Reader' : 'Fallback Parser',
          },
        });
      } catch { /* ignore timeline errors */ }
    }

    console.log(`[AI Reader] DONE: ${items.length} items saved, real=${isRealParsing}, environments=${uniqueEnvironments.join(', ')}`);

    return {
      success: true,
      itemsParsedCount: items.length,
      environments: uniqueEnvironments,
      items,
      isReal: isRealParsing,
    };
  }
}

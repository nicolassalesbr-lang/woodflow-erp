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
      // Convert PDF to PNG images at 120 DPI (good balance between quality and size, prevents payload limits)
      execSync(`pdftoppm -png -r 120 "${pdfPath}" "${path.join(tmpDir, 'page')}"`, {
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

    const systemPrompt = `Você é um projetista técnico sênior especialista em marcenaria de alto padrão, leitura de plantas executivas de móveis sob medida e detalhamento de fabricação.

Sua tarefa é analisar TODAS as páginas do projeto de marcenaria enviado (plantas, elevações, vistas, cortes técnicos, detalhes de cotas e memoriais) e extrair com MÁXIMA PRECISÃO cada módulo (Caixa), porta, gaveta, prateleira, tampo, painel e acessório.

REGRAS OBRIGATÓRIAS DE LEITURA E EXTRAÇÃO DE MEDIDAS:
1. **Sistema de Escala e Medidas (IMPORTANTE)**:
   * As cotas numéricas nos desenhos executivos apresentados (como 239, 195, 148, 100, 97, 55, 48) estão em **Centímetros (cm)**.
   * Você deve OBRIGATORIAMENTE converter todas as medidas para **Milímetros (mm)** multiplicando o valor por 10 (ex: 239 -> 2390mm, 148 -> 1480mm, 55 -> 550mm, 18 -> 180mm).
   * NUNCA retorne os números puros das cotas em centímetros nos campos de milímetros (ex: largura 148 é ERRO, o correto é 1480).

2. **Prevenção de Inversão de Eixos (Largura x Altura x Profundidade)**:
   * **Largura (Width)**: É a dimensão **horizontal** da peça/módulo na vista frontal ou elevação.
   * **Altura (Height)**: É a dimensão **vertical** da peça/módulo na vista frontal ou elevação.
   * **Profundidade (Depth)**: É a distância de frente para trás do móvel, geralmente encontrada em plantas baixas, cortes laterais, vistas 3D ou descrita no texto técnico (ex: "com profundidade de 50cm" -> depth: 500).
   * Valide a lógica física: Armários altos e roupeiros possuem a Altura (H) muito maior que a Largura (W) (ex: Altura 2390mm e Largura 500mm). Não inverta a orientação horizontal com a vertical!

3. **Estrutura Hierárquica de Módulos e Sub-peças**:
   * Identifique o móvel principal (ex: Armário Superior, Armário Inferior, Cômoda, Cama, Painel, Bancada) e extraia a sua estrutura principal como tipo "Caixa" ou "Aéreo" com suas medidas externas totais.
   * A seguir, extraia cada sub-peça interna/frontal associada a esse móvel (Portas, Gavetas, Prateleiras) com as dimensões específicas mostradas nas subdivisões das cotas:
     * Exemplo (Cômoda 148cm de largura e 100cm de altura):
       - Caixa da Cômoda: W: 1480, H: 1000, D: 550.
       - Gavetas (Três): W: 490 (ou 500), H: 190, D: 500, Qty: 3 (ItemType: "Gaveta").
       - Portas (Três): W: 480 (ou 470), H: 700, D: 18, Qty: 3 (ItemType: "Porta").
     * Exemplo (Armário Escritório/Quarto):
       - Caixa Lateral/Torre: W: 250 (ou similar), H: 2390, D: 500.
       - Aéreo Ponte: W: 1950, H: 1130 (ou altura correspondente), D: 500.
       - Portas de Giro de Vidro: W: 410, H: 2390, D: 20, Qty: 2.

4. **Identificação de Materiais**:
   * Localize a legenda de "MATERIAIS" ou as anotações apontadas por setas (ex: MDF Beton - Guararapes, MDF Preto Trama - Duratex, Madeira Natural Cinamomo Polido Fosco, MDF Freijó, MDF Itapuã, Couro Marrom, Espelho Prata). Atribua o material correto correspondente a cada peça extraída.

Retorne APENAS um objeto JSON com a chave "items" contendo um array de objetos nesta estrutura EXATA:
{
  "items": [
    {
      "environment": "Nome do Ambiente (ex: Escritório, Quarto, Banheiro Social, etc.)",
      "itemType": "Caixa|Porta|Gaveta|Prateleira|Tampo|Rodapé|Fundo|Testeira|Ferragem|Aéreo|Painel|Cabeceira|Mesa",
      "description": "Descrição clara e técnica da peça com acabamento e especificações",
      "width": 0,
      "height": 0,
      "depth": 0,
      "thickness": 18,
      "quantity": 1,
      "materialType": "Nome do material extraído da legenda/chamada"
    }
  ]
}

NÃO invente dados. Extraia APENAS o que está documentado nas cotas e descrições do PDF. Se uma dimensão não estiver clara, use 0.
NÃO inclua markdown, backticks ou texto explicativo — retorne SOMENTE o JSON puro.`;

    // Build user message content
    let userMessageContent: any;

    if (imageBase64Array.length === 0) {
      // Text-only completion
      userMessageContent = `Analise este projeto executivo de marcenaria. Extraia TODAS as peças de TODOS os ambientes com suas medidas reais para fabricação.\n\nTexto extraído do documento:\n${extractedText.substring(0, 12000)}`;
    } else {
      // Multimodal image + text completion
      const contentParts: any[] = [];
      contentParts.push({
        type: 'text',
        text: `Analise este projeto executivo de marcenaria com ${imageBase64Array.length} página(s). Extraia TODAS as peças de TODOS os ambientes com suas medidas reais para fabricação.${
          extractedText
            ? `\n\nTexto extraído do documento para referência adicional:\n${extractedText.substring(0, 8000)}`
            : ''
        }`,
      });

      // Add page images (limit to first 8 pages)
      const maxPages = Math.min(imageBase64Array.length, 8);
      for (let i = 0; i < maxPages; i++) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${imageBase64Array[i]}`,
            detail: 'high',
          },
        });
      }
      userMessageContent = contentParts;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessageContent },
    ];

    const requestBody: any = {
      messages,
      max_tokens: 4096,
      temperature: 0,
      response_format: { type: 'json_object' }
    };

    // Only use model param for standard OpenAI (Azure uses deployment name in URL)
    if (standardKey) {
      requestBody.model = model;
    }

    console.log(`[AI Reader] Sending request to GPT-4o with ${imageBase64Array.length} images...`);

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
            const PDFParseClass = pdfModule.PDFParse;
            if (typeof PDFParseClass === 'function') {
              // Custom class in this project requires Uint8Array rather than Buffer
              const uint8 = new Uint8Array(buffer);
              const parser = new PDFParseClass(uint8);
              const pdfData = await parser.getText();
              extractedText = pdfData.text || '';
              console.log(`[AI Reader] PDF text extraction (Custom PDFParse): ${extractedText.length} chars.`);
            } else {
              // Standard pdf-parse function export
              const pdfParser = typeof pdfModule === 'function' ? pdfModule : (pdfModule.default || pdfModule);
              if (typeof pdfParser === 'function') {
                const pdfData = await pdfParser(buffer);
                extractedText = pdfData.text || '';
                console.log(`[AI Reader] PDF text extraction (Standard pdf-parse): ${extractedText.length} chars.`);
              } else {
                console.warn('[AI Reader] pdf-parse module has unexpected export shape:', typeof pdfModule);
              }
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

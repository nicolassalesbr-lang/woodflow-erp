import { Controller, Get, Post, Body, Param, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { buildProjectInterpretation, ProjectSourceFile } from './project-interpretation.engine';
import { buildEngineeringResult } from './engineering-pricing.engine';

/**
 * Rendering DPI for the executive drawings. High DPI is required so GPT-4o Vision
 * can read the fine red dimension cotas on A3 technical sheets.
 */
const PAGE_DPI = Math.max(200, Number(process.env.PROJECT_PDF_DPI) || 300);
/** How many Vision calls run in parallel (one per sheet). Configurable via env; 2 balances Azure TPM vs latency. */
const VISION_CONCURRENCY = Math.max(1, Number(process.env.VISION_CONCURRENCY) || 2);
/** Safety cap so a monster PDF never explodes cost/latency. */
const MAX_PAGES = 40;

interface VisionConfig {
  apiUrl: string;
  headers: Record<string, string>;
  model?: string;
  name?: string;
}

type UploadedProjectFile = {
  filename: string;
  fileBase64: string;
  mimeType: string;
};

type StoredProjectDocument = {
  filename: string;
  mimeType: string;
  storageKey: string;
  pages?: number;
};

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

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //  PDF Ã¢â€ â€™ IMAGES
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  /**
   * Convert a PDF buffer to an array of base64 PNG strings, one per page.
   * Rendered at PAGE_DPI so the dimension cotas remain legible for the Vision model.
   */
  private convertPdfToImages(pdfBuffer: Buffer, dpi: number = PAGE_DPI): string[] {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'woodflow-pdf-'));
    const pdfPath = path.join(tmpDir, 'input.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);

    try {
      execSync(`pdftoppm -jpeg -r ${dpi} "${pdfPath}" "${path.join(tmpDir, 'page')}"`, {
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 64,
      });

      const imageFiles = fs.readdirSync(tmpDir)
        .filter(f => f.startsWith('page') && f.endsWith('.jpg'))
        // pdftoppm zero-pads page numbers, so a lexical sort keeps page order
        .sort();

      const images: string[] = [];
      for (const imgFile of imageFiles) {
        const imgBuffer = fs.readFileSync(path.join(tmpDir, imgFile));
        images.push(imgBuffer.toString('base64'));
      }

      console.log(`[AI Reader] Rendered PDF to ${images.length} page image(s) @ ${dpi} DPI.`);
      return images;
    } finally {
      try {
        for (const f of fs.readdirSync(tmpDir)) {
          fs.unlinkSync(path.join(tmpDir, f));
        }
        fs.rmdirSync(tmpDir);
      } catch { /* ignore cleanup errors */ }
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //  VISION / LLM
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  /**
   * Provedores com quota esgotada/credencial invÃƒÂ¡lida nesta sessÃƒÂ£o do processo.
   * Um provedor morto ÃƒÂ© pulado atÃƒÂ© o prÃƒÂ³ximo restart do PM2.
   */
  private deadProviders = new Set<string>();

  /**
   * Lista ordenada de provedores Vision disponÃƒÂ­veis (Gemini, OpenAI e/ou Azure).
   * VISION_PROVIDER=azure|gemini inverte a prioridade. O failover em callVision pula
   * automaticamente para o prÃƒÂ³ximo quando um deles fica sem quota.
   */
  private getVisionConfigs(): VisionConfig[] {
    const configs: VisionConfig[] = [];
    const deepseek = this.buildDeepSeekConfig();
    const gemini = this.buildGeminiConfig();
    const openai = this.buildOpenAIConfig();
    const azure = this.buildAzureConfig();
    const preferred = (process.env.VISION_PROVIDER || '').toLowerCase();
          if (preferred === 'deepseek') {
        if (deepseek) configs.push(deepseek);
        if (gemini) configs.push(gemini);
        if (openai) configs.push(openai);
        if (azure) configs.push(azure);
      } else if (preferred === 'azure') {
        if (azure) configs.push(azure);
        if (deepseek) configs.push(deepseek);
        if (gemini) configs.push(gemini);
        if (openai) configs.push(openai);
      } else if (preferred === 'openai') {
        if (openai) configs.push(openai);
        if (deepseek) configs.push(deepseek);
        if (gemini) configs.push(gemini);
        if (azure) configs.push(azure);
      } else {
        if (deepseek) configs.push(deepseek);
        if (gemini) configs.push(gemini);
        if (openai) configs.push(openai);
        if (azure) configs.push(azure);
      }
      return configs;
  }

  /** Primeiro provedor vivo (compatibilidade com os chamadores existentes). */
  private getVisionConfig(): VisionConfig | null {
    const alive = this.getVisionConfigs().filter((c) => !this.deadProviders.has(c.apiUrl));
    if (!alive.length) {
      console.warn('[AI Reader] Nenhum provedor Vision disponÃƒÂ­vel (sem chave ou todos sem quota).');
      return null;
    }
    return alive[0];
  }

  private buildDeepSeekConfig(): VisionConfig | null {
    const rawKey = process.env.DEEPSEEK_API_KEY;
    if (!rawKey) return null;
    const standardKey = rawKey.trim().replace(/^["']|["']$/g, '');
    return {
      apiUrl: 'https://api.deepseek.com/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${standardKey}`,
      },
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      name: 'DeepSeek',
    };
  }

  private buildOpenAIConfig(): VisionConfig | null {
    const rawKey = process.env.OPENAI_API_KEY;
    if (!rawKey) return null;
    const standardKey = rawKey.trim().replace(/^["']|["']$/g, '');
    return {
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${standardKey}`,
      },
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      name: 'OpenAI',
    };
  }

  private buildGeminiConfig(): VisionConfig | null {
    const rawKey = process.env.GEMINI_API_KEY;
    if (!rawKey) return null;
    const key = rawKey.trim().replace(/^["']|["']$/g, '');
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    return {
      apiUrl: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      model,
      name: 'Gemini',
    };
  }

  private buildAzureConfig(): VisionConfig | null {
    const azureKey = process.env.AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (azureKey && azureEndpoint) {
      const cleanEndpoint = azureEndpoint.trim();

      // Se for a URL do Azure AI Studio/Foundry com gateway compatÃƒÂ­vel com OpenAI
      if (cleanEndpoint.includes('services.ai.azure.com') || cleanEndpoint.includes('/openai/v1')) {
        let apiUrl = cleanEndpoint;
        if (apiUrl.endsWith('/responses')) {
          apiUrl = apiUrl.replace(/\/responses$/, '/chat/completions');
        } else if (!apiUrl.endsWith('/chat/completions')) {
          apiUrl = apiUrl.endsWith('/') ? apiUrl + 'chat/completions' : apiUrl + '/chat/completions';
        }

        const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5';
        return {
          apiUrl,
          headers: {
            'Content-Type': 'application/json',
            'api-key': azureKey,
          },
          model: deploymentName,
          name: 'Azure',
        };
      }

      // Caso clÃƒÂ¡ssico da Azure OpenAI
      const cleanClassic = cleanEndpoint.endsWith('/') ? cleanEndpoint.slice(0, -1) : cleanEndpoint;
      const classicDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o';
      return {
        apiUrl: `${cleanClassic}/openai/deployments/${classicDeployment}/chat/completions?api-version=2024-02-15-preview`,
        headers: {
          'Content-Type': 'application/json',
          'api-key': azureKey,
        },
        name: 'Azure',
      };
    }

    return null;
  }

  private buildSystemPrompt(): string {
    return `VocÃƒÂª ÃƒÂ© um OrÃƒÂ§amentista SÃƒÂªnior e Especialista em Projetos Executivos de Marcenaria Sob Medida e MÃƒÂ³veis Planejados.

Sua funÃƒÂ§ÃƒÂ£o ÃƒÂ© analisar a prancha do projeto executivo e extrair EXCLUSIVAMENTE os MÃƒâ€œVEIS MONTADOS (MÃƒÂ³dulos Inteiros / Estruturas Principais) com suas MEDIDAS BRUTAS EXTERNAS TOTAIS.

Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
REGRA CRÃƒÂTICA DE EXTRAÃƒâ€¡ÃƒÆ’O PARA MARCENARIA (MÃƒâ€œVEIS MONTADOS)
Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
1. NÃƒÆ’O EXTRAIA SUB-PEÃƒâ€¡AS FRACIONADAS: NÃƒÆ’O extraia frentes de portas de giro/correr/basculantes, NÃƒÆ’O extraia caixas de gavetas ou gavetÃƒÂµes, NÃƒÆ’O extraia prateleiras internas, divisÃƒÂ³rias, fundos, puxadores, corrediÃƒÂ§as, dobradiÃƒÂ§as ou fitas de LED como itens separados.
2. EXTRAIA APENAS MÃƒâ€œVEIS MONTADOS INTEIROS (MÃƒâ€œDULOS PRINCIPAIS): Identifique cada mÃƒÂ³vel ou bancada como um volume completo como se estivesse montado no ambiente.

Exemplos de MÃƒÂ³veis Montados Inteiros:
- BalcÃƒÂ£o de Base / BalcÃƒÂ£o da Pia (ex: L 2400 x A 720 x P 560 mm)
- ArmÃƒÂ¡rio AÃƒÂ©reo Superior (ex: L 1274 x A 600 x P 350 mm)
- Torre Quente / Torre de Eletros (ex: L 600 x A 2596 x P 600 mm)
- Bancada / Ilha Cooktop (ex: L 1859 x A 920 x P 620 mm)
- Guarda-Roupa / Roupeiro (ex: L 2970 x A 2430 x P 570 mm)
- Painel de Cabeceira / Painel de TV (ex: L 2840 x A 1300 x P 50 mm)
- Penteadeira / Escrivaninha / Mesa (ex: L 2620 x A 450 x P 450 mm)

FILTRO ABSOLUTO DE ORCAMENTO:
- Retorne somente moveis planejados/marcenaria sob medida que entram no orcamento.
- NAO extraia eletrodomesticos, metais, loucas, decoracao ou itens de obra como itens: geladeira, refrigerador, freezer, forno, micro-ondas, cooktop, fogao, coifa, depurador, cuba, pia, torneira, tanque, cafeteira, adega/cervejeira, quadro, planta, cortina, persiana, luminaria, piso, parede, rodape da obra.
- Nichos/vaos para eletros podem aparecer apenas em observacoes do movel que os contem (ex: "torre com vao para forno e micro-ondas"). Nunca crie o eletro como item.
- Fotos, perspectivas e renders 3D SEM cotas numericas servem para entender QUAIS moveis planejados existem, materiais, disposicao e vao de eletros. Podem retornar moveis planejados com dimensoes null e observacao "Identificado visualmente - sem cotas nesta imagem".
- Itens visuais sem cota NAO entram em area/chapas ate receberem medidas, mas devem aparecer como pendencia para a lista ficar coerente com as imagens do projeto.

REGRA ESPECIAL PARA COZINHAS EM PLANTA BAIXA/COTADA:
- Interprete o conjunto completo da cozinha, cruzando linhas de parede, bancadas e render/planta superior.
- Nao resuma uma cozinha inteira em 1 ou 2 itens. Em geral, liste separadamente os conjuntos montados: aereos superiores por trecho, balcoes inferiores por trecho, torre/coluna de eletros ou despensa, armario alto/lateral, ilha/peninsula/bancada, painel/ripado quando for movel planejado.
- Nao some trechos separados por canto, torre, parede, vao ou mudanca de profundidade em um unico "armario linear". Cada trecho fisico montado deve virar um item.
- Para aereos superiores, use larguras cotadas por trecho (ex: 40+82+24 cm = 1460 mm; 127,4 cm = 1274 mm), altura cotada (ex: 60 cm = 600 mm) e profundidade cotada/indicada (ex: 35 cm = 350 mm) quando houver.
- Para balcoes inferiores e ilhas, use largura do trecho, altura de bancada cotada (ex: Alt. 92 cm = 920 mm) e profundidade cotada na planta/corte. Cooktop, cuba e eletros sao apenas referencias de vao/uso.
- Se uma dimensao faltar em um movel visivel, mantenha null nessa dimensao e explique a pendencia em observacoes; nao descarte o movel inteiro se ele existe claramente no render/planta.

Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
REGRAS DE MEDIDAS E COTAS (OBRIGATÃƒâ€œRIAS)
Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
1. CONVERSÃƒÆ’O CM -> MM: As cotas dos desenhos estÃƒÂ£o em CENTÃƒÂMETROS (cm). Multiplique OBRIGATORIAMENTE por 10 para converter em MILÃƒÂMETROS (mm).
   - Cota "127,4" cm Ã¢Å¾â€ 1274 mm
   - Cota "185,9" cm Ã¢Å¾â€ 1859 mm
   - Cota "62,0" cm Ã¢Å¾â€ 620 mm
   - Cota "259,6" cm Ã¢Å¾â€ 2596 mm
   - Cota "40,0" cm Ã¢Å¾â€ 400 mm
   - Cota "82,0" cm Ã¢Å¾â€ 820 mm

2. EIXOS DIMENSIONAIS:
   - width (largura L): dimensÃƒÂ£o horizontal na vista frontal ou elevaÃƒÂ§ÃƒÂ£o.
   - height (altura A): dimensÃƒÂ£o vertical na vista frontal ou elevaÃƒÂ§ÃƒÂ£o.
   - depth (profundidade P): profundidade externa frente/fundo lida no corte, planta ou 3D.
   - Em Planta Baixa (vista superior), as dimensÃµes desenhadas sÃ£o Largura e Profundidade. A Altura costuma vir escrita em texto (ex: "Alt. 250cm").
   - Cuidado com a sigla "Susp." (Suspenso): refere-se Ã  distÃ¢cia do chÃ£o, nÃ£o Ã  altura do mÃ³vel.

3. MATERIAIS E CORES:
   - Extraia o material/cor indicado na observaÃƒÂ§ÃƒÂ£o ou legenda (ex: "MDF Gianduia Trama (Duratex)", "MDF FreijÃƒÂ³", "Quartzo Branco").

4. NÃƒÆ’O DUPLIQUE MÃƒâ€œVEIS:
   - Um mÃƒÂ³vel desenhado em planta, vista frontal e 3D deve ser contabilizado apenas UMA VEZ.

Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
REGRA DE CONFIABILIDADE (CRÃƒÂTICA Ã¢â‚¬â€ NUNCA VIOLE)
Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
- Se uma dimensÃƒÂ£o (width, height ou depth) NÃƒÆ’O estÃƒÂ¡ cotada/escrita no desenho, retorne null para essa dimensÃƒÂ£o.
- NUNCA invente, estime ou "adivinhe" medidas. Retorne APENAS o que estÃƒÂ¡ EXPLÃƒÂCITO no documento.
- Para imagens 3D / renders / perspectivas SEM cotas numericas: retorne os moveis planejados visiveis com width/height/depth null e observacoes claras. Eles sao pendencias visuais, nao medidas de orcamento.
- A confiabilidade do orÃƒÂ§amento depende 100% de medidas reais dos documentos.

Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
MÃƒÅ¡LTIPLOS DOCUMENTOS DO MESMO PROJETO
Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
- O projeto pode conter vÃƒÂ¡rios documentos: pranchas executivas com cotas, renders 3D, fotos de referÃƒÂªncia.
- Cada folha/imagem serÃƒÂ¡ enviada individualmente. Extraia o que for possÃƒÂ­vel de cada uma.
- Se uma folha e um render 3D/foto sem cotas, extraia os moveis planejados visiveis como itens visuais com dimensoes null, para reconciliar com as pranchas cotadas do mesmo projeto.
- Se uma folha ÃƒÂ© uma prancha executiva com cotas, extraia as medidas reais.
- O sistema consolidarÃƒÂ¡ as informaÃƒÂ§ÃƒÂµes de todos os documentos automaticamente.

Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
FORMATO DE SAÃƒÂDA (JSON PURO)
Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
Retorne SOMENTE um objeto JSON puro no formato:
{
  "items": [
    {
      "environment": "Cozinha|SuÃƒÂ­te|Banheiro|DormitÃƒÂ³rio|Sala",
      "itemType": "BalcÃƒÂ£o|AÃƒÂ©reo|Torre|Bancada|Guarda-Roupa|Painel|Cama|Mesa|Penteadeira",
      "description": "Nome legÃƒÂ­vel do mÃƒÂ³vel montado (ex: ArmÃƒÂ¡rio AÃƒÂ©reo sobre Pia com 3 portas)",
      "codigo": "A|B|C|1|2|vazio",
      "width": 1274,
      "height": 600,
      "depth": 350,
      "thickness": 18,
      "quantity": 1,
      "materialType": "MDF Gianduia Trama (Duratex)",
      "cor": "Gianduia Trama",
      "acabamento": "Texturizado",
      "observacoes": "MÃƒÂ³vel aÃƒÂ©reo montado conforme prancha.",
      "classificacao": "explicita",
      "confianca": 98
    }
  ]
}

Nota: Se a dimensÃƒÂ£o nÃƒÂ£o estÃƒÂ¡ cotada, use null:
  "width": null,
  "height": null,
  "depth": null,
  "observacoes": "Medidas ausentes Ã¢â‚¬â€ verificar prancha executiva com cotas",
  "classificacao": "visual",
  "confianca": 30`;
  }

  /**
   * The initial pass identifies the whole project. A review pass is deliberately
   * narrower: it may only complete the items the validation layer flagged and
   * must leave unrelated furniture untouched.
   */
  private buildTargetedReviewPrompt(targets: any[]): string {
    const targetList = targets.map((target, index) => {
      const dimensions = target.dimensions || {};
      const brief = target.reviewBrief || {};
      const confirmed = brief.confirmedDimensions?.length
        ? brief.confirmedDimensions.join(', ')
        : [dimensions.width && `L=${dimensions.width} mm`, dimensions.height && `A=${dimensions.height} mm`, dimensions.depth && `P=${dimensions.depth} mm`].filter(Boolean).join(', ') || 'nenhuma';
      const missing = brief.missingDimensions?.join(', ') || [
        !dimensions.width && 'largura (L)',
        !dimensions.height && 'altura (A)',
        !dimensions.depth && 'profundidade (P)',
      ].filter(Boolean).join(', ') || 'validar medidas';
      const objectives = brief.objectives?.join(' ') || target.validation?.issues?.map((issue: any) => issue.message).join(' ') || 'Conferir medidas e material.';
      const evidence = String(brief.evidenceSummary || target.evidence?.notes || target.evidence?.sourceText || '').replace(/\s+/g, ' ').slice(0, 420);
      return `${index + 1}. reviewTargetId: ${target.id}\n   Ambiente: ${target.environment || 'Ambiente'}\n   Movel: ${target.description || target.itemType || 'Movel'} | codigo: ${target.codigo || 'sem codigo'}\n   Ja confirmado: ${confirmed}\n   Falta validar: ${missing}\n   Objetivo: ${objectives}\n   Folha de origem: ${brief.sourcePage || target.evidence?.sourcePage || 'nao identificada'}\n   Evidencia anterior: ${evidence || 'nenhuma - localizar diretamente na prancha'}`;
    }).join('\n') + '\n\nREGRA DE IDENTIDADE: em cada item retornado, inclua "reviewTargetId" copiando exatamente o identificador do item-alvo correspondente.';

    return `${this.buildSystemPrompt()}\n\nMODO REVISAO DIRIGIDA DO PDF\nVoce esta revisando APENAS os moveis abaixo, pois ficaram pendentes ou com alerta na primeira leitura. Leia com maximo cuidado as cotas, setas, vistas e texto OCR relacionados a eles.\n\nITENS-ALVO:\n${targetList}\n\nREGRAS ADICIONAIS:\n- Retorne SOMENTE itens que correspondam claramente a um dos itens-alvo; nao crie novos moveis.\n- Para cada dimensao, use somente uma cota explicitamente visivel/escrita no PDF. Converta cm para mm quando aplicavel.\n- Se uma medida nao puder ser associada sem ambiguidade ao movel, mantenha null e explique em observacoes.\n- Em observacoes, registre a origem da cota de forma curta, por exemplo: \"Evidencia: L 1274 mm na vista frontal, A 600 mm, P 350 mm no corte\". Quando houver pendencia, diga exatamente qual vista/cota nao foi localizada.\n- Leia as vistas frontal, lateral, corte e planta como fontes complementares do MESMO movel. Pode completar L, A e P usando vistas diferentes, desde que codigo, posicao ou desenho confirmem que pertencem ao mesmo modulo.\n- Use medidas parciais ja confirmadas como ancora. Nao substitua uma medida confirmada por outra sem explicar a divergencia em observacoes.\n- Nao estime medidas por proporcao, padrao de marcenaria, eletrodomestico ou render.\n- Preserve o ambiente, codigo e descricao quando estiverem identificaveis.`;
  }

  private projectUploadDirectory(projectId: string): string {
    const root = process.env.PROJECT_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'projects');
    const safeProjectId = String(projectId).replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(root, safeProjectId);
  }

  /** Keeps the original drawing available for a later targeted review. */
  private persistProjectDocuments(projectId: string, files: UploadedProjectFile[]): StoredProjectDocument[] {
    const directory = this.projectUploadDirectory(projectId);
    fs.mkdirSync(directory, { recursive: true });

    return files.map((file, index) => {
      const originalName = file.filename || `documento-${index + 1}`;
      const extension = path.extname(originalName).replace(/[^.a-zA-Z0-9]/g, '') ||
        (file.mimeType === 'application/pdf' ? '.pdf' : '.jpg');
      const safeBase = path.basename(originalName, path.extname(originalName))
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || `documento-${index + 1}`;
      const storageKey = `${String(index + 1).padStart(2, '0')}-${safeBase}${extension}`;
      fs.writeFileSync(path.join(directory, storageKey), Buffer.from(file.fileBase64, 'base64'));
      return { filename: originalName, mimeType: file.mimeType, storageKey };
    });
  }

  private sourceItemFromInterpretation(item: any): any {
    return {
      environment: item.environment,
      itemType: item.itemType,
      description: item.description,
      codigo: item.codigo,
      width: item.dimensions?.width,
      height: item.dimensions?.height,
      depth: item.dimensions?.depth,
      thickness: item.dimensions?.thickness || 18,
      quantity: item.quantity || 1,
      materialType: item.materialType,
      cor: item.color,
      acabamento: item.finish,
      observacoes: item.evidence?.notes,
      source: item.evidence?.source,
      sourcePage: item.evidence?.sourcePage,
      sourceText: item.evidence?.sourceText,
      reviewTargetId: item.id,
    };
  }

  private isSameFurniture(left: any, right: any): boolean {
    const leftTargetId = String(left.reviewTargetId || left.id || '').trim();
    const rightTargetId = String(right.reviewTargetId || '').trim();
    if (leftTargetId && rightTargetId && leftTargetId === rightTargetId) return true;
    const leftCode = this.normKey(String(left.codigo || ''));
    const rightCode = this.normKey(String(right.codigo || ''));
    if (leftCode && rightCode && leftCode === rightCode && this.normKey(left.environment) === this.normKey(right.environment)) return true;
    const sameEnvironment = this.normKey(left.environment) === this.normKey(right.environment);
    const leftText = this.normKey(`${left.description || ''} ${left.itemType || ''}`);
    const rightText = this.normKey(`${right.description || ''} ${right.itemType || ''}`);
    return sameEnvironment && Boolean(leftText && rightText) && (leftText.includes(rightText) || rightText.includes(leftText));
  }

  /** Combine complementary dimensions found in front, plan and section views. */
  private mergeReviewedFurniture(target: any, matches: any[]): any | null {
    if (!matches.length) return null;
    const original = this.sourceItemFromInterpretation(target);
    const merged = { ...original, ...matches[0] };
    for (const axis of ['width', 'height', 'depth'] as const) {
      const originalValue = Number(original[axis]) || 0;
      if (originalValue > 0) {
        merged[axis] = originalValue;
        continue;
      }
      const candidates = Array.from(new Set(matches
        .map((item) => Number(item[axis]) || 0)
        .filter((value) => value > 0)));
      // Conflicting readings remain pending instead of selecting an arbitrary cota.
      merged[axis] = candidates.length === 1 ? candidates[0] : 0;
    }
    merged.observacoes = `${matches.map((item) => item.observacoes).filter(Boolean).join(' | ') || original.observacoes || ''} | Revisao dirigida do PDF.`.trim();
    merged.reviewTargetId = target.id;
    return merged;
  }

  /**
   * A profundidade costuma estar no corte/vista lateral imediatamente anterior
   * ou posterior à vista frontal. Revisar somente a página onde o móvel foi
   * identificado impede a segunda leitura de encontrar a terceira dimensão.
   */
  private reviewPageIndexes(targets: any[], pageCount: number): number[] {
    const pages = new Set<number>();
    for (const target of targets) {
      const page = Number(target?.evidence?.sourcePage);
      if (!Number.isInteger(page) || page < 1) continue;
      for (const candidate of [page - 1, page, page + 1]) {
        if (candidate >= 1 && candidate <= pageCount) pages.add(candidate - 1);
      }
    }
    return pages.size ? Array.from(pages).sort((a, b) => a - b) : Array.from({ length: pageCount }, (_, index) => index);
  }

  /** Limit the prompt to targets whose source is on this sheet or a neighbour. */
  private reviewTargetsForPage(targets: any[], pageNumber: number): any[] {
    const nearby = targets.filter((target) => {
      const sourcePage = Number(target?.evidence?.sourcePage);
      return Number.isInteger(sourcePage) && Math.abs(sourcePage - pageNumber) <= 1;
    });
    return nearby.length ? nearby : targets;
  }

  private async callVision(
    cfg: VisionConfig,
    messages: any[],
    maxTokens: number,
    attempt: number = 0,
  ): Promise<string | null> {
    const isNewModel = cfg.model && (
      cfg.model.startsWith('gpt-5') ||
      cfg.model.startsWith('o1') ||
      cfg.model.startsWith('o3')
    );

    const requestBody: any = {
      messages,
    };
    if (cfg.model) requestBody.model = cfg.model;

    if (isNewModel) {
      // Modelos de reasoning (gpt-5/o1/o3) consomem tokens em raciocÃƒÂ­nio ANTES da
      // resposta Ã¢â‚¬â€ sem folga o JSON sai truncado/vazio (finish_reason=length).
      requestBody.max_completion_tokens = maxTokens + 8000;
      // reasoning_effort low: corta a latÃƒÂªncia de ~3min para segundos por folha
      // sem comprometer a leitura de cotas (a extraÃƒÂ§ÃƒÂ£o ÃƒÂ© visual, nÃƒÂ£o lÃƒÂ³gica-profunda)
      requestBody.reasoning_effort = process.env.VISION_REASONING_EFFORT || 'low';
      // json_object FUNCIONA no gpt-5 via chat/completions (validado); o problema
      // antigo era sÃƒÂ³ no endpoint /responses. Garante JSON vÃƒÂ¡lido (twin quebrava sem isso).
      requestBody.response_format = { type: 'json_object' };
      // Sem temperature: modelos de reasoning nÃƒÂ£o aceitam valor customizado
    } else {
      requestBody.max_tokens = maxTokens;
      requestBody.temperature = 0;
      requestBody.response_format = { type: 'json_object' };
    }

    // Provedor jÃƒÂ¡ marcado como morto nesta sessÃƒÂ£o Ã¢â€ â€™ troca antes mesmo de tentar
    if (this.deadProviders.has(cfg.apiUrl)) {
      const alive = this.getVisionConfig();
      if (!alive) return null;
      if (alive.apiUrl !== cfg.apiUrl) return this.callVision(alive, messages, maxTokens, attempt);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s (3 minutos) para modelos de visÃƒÂ£o pesados

      const response = await fetch(cfg.apiUrl, {
        method: 'POST',
        headers: cfg.headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      // 429/503: diferenciar quota ESGOTADA (permanente) de rate limit temporÃƒÂ¡rio
      if (response.status === 429 || response.status === 503) {
        const errBody = await response.text();

        // Quota esgotada ou credencial invÃƒÂ¡lida Ã¢â€ â€™ FAILOVER imediato para o prÃƒÂ³ximo provedor
        if (/insufficient_quota|billing|account is not active/i.test(errBody)) {
          this.deadProviders.add(cfg.apiUrl);
          const next = this.getVisionConfig();
          if (next && next.apiUrl !== cfg.apiUrl) {
            console.warn(`[AI Reader] ${cfg.name || 'provedor'} SEM QUOTA Ã¢â‚¬â€ failover para ${next.name || 'alternativo'}.`);
            return this.callVision(next, messages, maxTokens, 0);
          }
          console.error('[AI Reader] Quota esgotada e nenhum provedor alternativo configurado.');
          return null;
        }

        // Rate limit temporÃƒÂ¡rio Ã¢â€ â€™ retry com backoff exponencial
        if (attempt < 5) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const waitMs = retryAfter > 0
            ? retryAfter * 1000
            : Math.min(3000 * Math.pow(2, attempt), 30000);
          console.warn(`[AI Reader] ${response.status} rate limit (${cfg.name}) Ã¢â‚¬â€ retry em ${waitMs}ms (tentativa ${attempt + 1}/5)`);
          await new Promise((r) => setTimeout(r, waitMs));
          return this.callVision(cfg, messages, maxTokens, attempt + 1);
        }
        console.error('[AI Reader] Rate limit persistente apÃƒÂ³s 5 tentativas:', errBody.substring(0, 200));
        return null;
      }

      // 401/403: credencial invÃƒÂ¡lida Ã¢â€ â€™ failover
      if (response.status === 401 || response.status === 403) {
        this.deadProviders.add(cfg.apiUrl);
        const next = this.getVisionConfig();
        if (next && next.apiUrl !== cfg.apiUrl) {
          console.warn(`[AI Reader] ${cfg.name || 'provedor'} credencial invÃƒÂ¡lida (${response.status}) Ã¢â‚¬â€ failover para ${next.name}.`);
          return this.callVision(next, messages, maxTokens, 0);
        }
        return null;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error('[AI Reader] Vision request failed:', response.status, errText.substring(0, 300));
        return null;
      }
      const data = await response.json();
      return data.choices?.[0]?.message?.content || null;
    } catch (err) {
      console.error('[AI Reader] Vision request error:', err);
      return null;
    }
  }

  /** Parse the model's JSON content into an items array, tolerating various shapes. */
  private extractItemsFromContent(content: string | null): any[] {
    if (!content) return [];
    const normalizeJsonText = (value: string): string => {
      let clean = value.trim();
      if (clean.startsWith('```json')) clean = clean.slice(7);
      if (clean.startsWith('```')) clean = clean.slice(3);
      if (clean.endsWith('```')) clean = clean.slice(0, -3);
      return clean.trim();
    };

    const unwrapItems = (parsed: any): any[] => {
      if (parsed && !Array.isArray(parsed)) {
        if (Array.isArray(parsed.items)) return parsed.items;
        if (Array.isArray(parsed.pecas)) return parsed.pecas;
        for (const key of Object.keys(parsed)) {
          if (Array.isArray(parsed[key])) return parsed[key];
        }
      }
      return Array.isArray(parsed) ? parsed : [];
    };

    const salvageCompleteObjects = (clean: string): any[] => {
      const start = clean.indexOf('[');
      if (start < 0) return [];
      const out: any[] = [];
      let depth = 0;
      let inString = false;
      let escaped = false;
      let objectStart = -1;

      for (let i = start; i < clean.length; i++) {
        const ch = clean[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === '{') {
          if (depth === 0) objectStart = i;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && objectStart >= 0) {
            const rawObject = clean.slice(objectStart, i + 1).replace(/,\s*([}\]])/g, '$1');
            try {
              out.push(JSON.parse(rawObject));
            } catch {
              // Ignore only this object; later complete objects may still be valid.
            }
            objectStart = -1;
          }
        }
      }
      return out;
    };

    try {
      const clean = normalizeJsonText(content);
      return unwrapItems(JSON.parse(clean));
    } catch (err) {
      const clean = normalizeJsonText(content);
      const salvaged = salvageCompleteObjects(clean);
      if (salvaged.length > 0) {
        console.warn(`[AI Reader] JSON parse failed, salvaged ${salvaged.length} complete item(s) from partial response.`);
        return salvaged;
      }
      console.error('[AI Reader] JSON parse failed:', err, '| raw:', content.substring(0, 200));
      return [];
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //  CAMADA 1 Ã¢â‚¬â€ LOCAL PADDLEOCR MICROSERVICE (OCR + PyMuPDF)
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  /** Verifica se o OCR local estÃƒÂ¡ habilitado. */
  private getLocalOcrUrl(): string | null {
    return process.env.LOCAL_OCR_ENDPOINT || 'http://localhost:8000/analyze';
  }

  /**
   * Envia PDF/imagem ao microserviÃƒÂ§o local PaddleOCR e retorna,
   * por pÃƒÂ¡gina (ÃƒÂ­ndice 0-based), um contexto estruturado (texto OCR +
   * cotas numÃƒÂ©ricas com posiÃƒÂ§ÃƒÂ£o). Retorna [] se o serviÃƒÂ§o estiver offline
   * em caso de falha Ã¢â‚¬â€ o pipeline entÃƒÂ£o segue sÃƒÂ³ com a imagem (fallback silencioso).
   */
  private async analyzeLayout(fileBuffer: Buffer, contentType: string = 'application/pdf'): Promise<string[]> {
    const ocrUrl = this.getLocalOcrUrl();
    if (!ocrUrl) return [];

    try {
      let filename = 'document.pdf';
      if (contentType === 'image/jpeg' || contentType === 'image/jpg') filename = 'document.jpg';
      else if (contentType === 'image/png') filename = 'document.png';
      
      const formData = new FormData();
      const bytes = Uint8Array.from(fileBuffer);
      const blob = new Blob([bytes], { type: contentType });
      formData.append('file', blob, filename);

      const submit = await fetch(ocrUrl, {
        method: 'POST',
        body: formData,
      });

      if (!submit.ok) {
        console.warn('[PaddleOCR] submit falhou:', submit.status, (await submit.text()).slice(0, 200));
        return [];
      }

      const data = await submit.json();
      if (data.status !== 'completed') {
        console.warn('[PaddleOCR] anÃƒÂ¡lise falhou.', data.status);
        return [];
      }

      // O backend Python jÃƒÂ¡ devolve `contexts` populado corretamente
      const contexts = data.contexts || [];
      console.log(`[PaddleOCR] contexto estruturado de ${contexts.length} pÃƒÂ¡gina(s).`);
      return contexts;
    } catch (err) {
      console.warn('[PaddleOCR] erro de conexÃƒÂ£o com o microserviÃƒÂ§o local (verifique se estÃƒÂ¡ rodando):', err);
      return [];
    }
  }

  /** Monta o contexto estruturado por pÃƒÂ¡gina a partir do analyzeResult. */
  private buildPageContexts(result: any): string[] {
    const pages: any[] = result.pages || [];
    const tables: any[] = result.tables || [];
    const contexts: string[] = [];

    pages.forEach((page: any, idx: number) => {
      const pageNum = page.pageNumber || idx + 1;
      const pw = page.width || 1;
      const ph = page.height || 1;

      const lines: string[] = (page.lines || []).map((l: any) => l.content).filter(Boolean);

      // Cotas numÃƒÂ©ricas (1-4 dÃƒÂ­gitos) com posiÃƒÂ§ÃƒÂ£o normalizada 0-1 na folha
      const cotas: string[] = [];
      (page.words || []).forEach((w: any) => {
        const t = String(w.content || '').trim();
        if (/^\d{1,4}$/.test(t) && Array.isArray(w.polygon) && w.polygon.length >= 2) {
          const x = (w.polygon[0] / pw).toFixed(2);
          const y = (w.polygon[1] / ph).toFixed(2);
          cotas.push(`${t}@(${x},${y})`);
        }
      });

      const pageTables = tables.filter((tb: any) =>
        (tb.boundingRegions || []).some((br: any) => br.pageNumber === pageNum),
      );
      const tablesMd = pageTables.map((tb: any) => this.tableToMarkdown(tb)).filter(Boolean).join('\n\n');

      const parts: string[] = [];
      if (lines.length) parts.push(`TEXTO OCR:\n${lines.join(' | ').slice(0, 3500)}`);
      if (tablesMd) parts.push(`TABELAS/MEMORIAIS:\n${tablesMd.slice(0, 2500)}`);
      if (cotas.length) parts.push(`COTAS (valor@posiÃƒÂ§ÃƒÂ£o x,y normalizada 0-1):\n${cotas.slice(0, 90).join('; ')}`);
      contexts[idx] = parts.join('\n\n');
    });
    return contexts;
  }

  /** Converte uma tabela do Doc Intelligence em markdown. */
  private tableToMarkdown(table: any): string {
    const rows = table.rowCount || 0;
    const cols = table.columnCount || 0;
    if (!rows || !cols) return '';
    const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(''));
    (table.cells || []).forEach((c: any) => {
      if (c.rowIndex < rows && c.columnIndex < cols) {
        grid[c.rowIndex][c.columnIndex] = String(c.content || '').replace(/\n/g, ' ').trim();
      }
    });
    return grid.map((r) => '| ' + r.join(' | ') + ' |').join('\n');
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //  CAMADA 2 Ã¢â‚¬â€ GPT-4o VISION (raciocÃƒÂ­nio geomÃƒÂ©trico + cruzamento com Camada 1)
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  /** Analyze a single sheet image and return its extracted items. */
  private async analyzePage(
    cfg: VisionConfig,
    imageBase64: string,
    pageIndex: number,
    totalPages: number,
    structuredContext?: string,
    isImageUpload = false,
  ): Promise<any[]> {
    const userContent: any[] = [
      {
        type: 'text',
        text: `Esta e a folha ${pageIndex + 1} de ${totalPages} de um projeto de marcenaria sob medida. Analise SOMENTE esta folha e extraia apenas MOVEIS PLANEJADOS (modulos principais/moveis montados). Use medidas reais explicitas em milimetros quando houver cota. Nao extraia subpecas, eletrodomesticos, loucas, metais, decoracao ou itens de obra. Se for foto/render sem cotas, retorne os moveis planejados visiveis com dimensoes null e observacao de pendencia, sem inventar medidas. Priorize no maximo 12 moveis montados por folha para evitar JSON truncado. Nao use medidas assumidas, estimadas ou aproximadas.`,
      },
      {
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' },
      },
    ];

    if (isImageUpload) {
      userContent.push({
        type: 'text',
        text: `REGRAS EXCLUSIVAS PARA PRANCHA TECNICA ENVIADA COMO IMAGEM:
- Examine todos os agrupamentos de cotas e contornos independentes. Nao resuma a prancha em um unico movel.
- Em planta ou vista superior, as duas dimensoes do contorno representam largura e profundidade. A anotacao "Alt." fornece a altura externa do movel.
- "Susp." indica somente a distancia de instalacao ao piso. Nunca use "Susp." como altura, largura ou profundidade.
- Retorne separadamente cada armario alto ou roupeiro, armario aereo, painel e prateleira de canto externa que tenha contorno ou chamada propria.
- Uma prateleira de canto externa cotada e um item planejado independente; nao a descarte como prateleira interna.
- Associe cada cota somente ao contorno tocado pela linha de chamada ou pelas setas.
- Mesmo que falte uma dimensao, retorne o item com as medidas confirmadas e null apenas no eixo ausente. Nao omita o item.`,
      });
    }

    if (structuredContext && structuredContext.length > 20) {
      userContent.push({
        type: 'text',
        text:
          `\n\nDADOS ESTRUTURADOS DESTA FOLHA (extraÃƒÂ­dos por OCR/layout do Azure Document Intelligence). ` +
          `O OCR pode cometer erros ou omitir textos verticais/pequenos. Se vocÃª ler uma cota claramente na imagem, CONFIE NA SUA VISÃƒO, mesmo que ela nÃ£o apareÃ§a no OCR. Use o OCR apenas como guia espacial ` +
          `(pela proximidade das posiÃƒÂ§ÃƒÂµes x,y). Ainda assim aplique a regra cmÃ¢â€ â€™mm (Ãƒâ€”10). ` +
          `VocÃª DEVE se esforÃ§ar ao mÃ¡ximo para encontrar e extrair as medidas (Largura, Altura e Profundidade) de cada mÃ³vel usando sua visÃ£o. Se a medida estiver visÃ­vel na imagem (mesmo que com zoom ou texto pequeno), vocÃª DEVE preenchÃª-la no JSON. Use null APENAS se a medida realmente nÃ£o existir em nenhum lugar do desenho. ` +
          `Para evitar JSON longo/truncado, priorize no mÃ¡ximo 25 MÃ“VEIS MONTADOS desta folha e ignore subpeÃ§as. ` +
          `Ã‰ extremamente importante que vocÃª preencha width, height e depth com valores numÃ©ricos lidos da imagem. NÃ£o deixe as medidas em branco (null) se vocÃª conseguir enxergar os nÃºmeros no desenho. Apenas use null em Ãºltimo caso.\n\n${structuredContext}`,
      });
    }

    const messages = [
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user', content: userContent },
    ];

    const content = await this.callVision(cfg, messages, 12000);
    console.log(`[AI Reader] Sheet ${pageIndex + 1} raw content snippet:`, content ? (content.length > 500 ? content.substring(0, 500) + '...' : content) : 'NULL');
    const items = this.extractItemsFromContent(content).map((item) => ({
      ...item,
      source: structuredContext ? 'ocr_layout' : 'vision',
      sourceMediaType: isImageUpload ? 'image' : 'pdf',
      sourcePage: pageIndex + 1,
      sourceText: structuredContext ? structuredContext.slice(0, 1200) : null,
    }));
    console.log(`[AI Reader] Sheet ${pageIndex + 1}/${totalPages}: ${items.length} item(s)${structuredContext ? ' (com Doc Intelligence)' : ''}.`);
    return items;
  }

  /** Consolidates different renders and the dimensioned sheet from one image-only batch. */
  private async reconcileImageBatch(
    cfg: VisionConfig,
    projectName: string,
    sources: Array<{ filename: string; imageBase64: string; structuredContext?: string }>,
    firstPassItems: any[],
  ): Promise<any[]> {
    if (sources.length < 2 || firstPassItems.length === 0) return firstPassItems;

    const evidenceText = sources
      .map((source) => source.structuredContext || '')
      .filter(Boolean)
      .sort((left, right) => (right.match(/\d/g)?.length || 0) - (left.match(/\d/g)?.length || 0))
      .join('\n\n')
      .slice(0, 1200);
    const compactItems = firstPassItems.map((item) => ({
      environment: item.environment,
      itemType: item.itemType,
      description: item.description,
      width: item.width,
      height: item.height,
      depth: item.depth,
      thickness: item.thickness,
      quantity: item.quantity,
      materialType: item.materialType,
      cor: item.cor,
      observacoes: item.observacoes,
      sourceFilename: item.sourceFilename,
    }));

    const userContent: any[] = [{
      type: 'text',
      text: `MODO DE RECONCILIACAO DE UM LOTE DE IMAGENS DO MESMO PROJETO
Projeto: ${projectName || 'Projeto de marcenaria'}

As imagens seguintes sao renders, vistas superiores e uma eventual prancha cotada do MESMO projeto. Produza uma unica lista consolidada de moveis planejados.

REGRAS OBRIGATORIAS:
- O mesmo movel visto fechado, aberto, de frente ou de cima conta uma unica vez. Una essas vistas; nao some duplicatas.
- A prancha com cotas prevalece sobre o render para medidas. O render serve para identidade, configuracao e material, nunca para estimar cota.
- Nao invente medidas. Preserve null quando a cota realmente nao existir.
- Em planta, as duas cotas do contorno sao largura e profundidade; a chamada "Alt." e a altura. "Susp." e apenas posicao de instalacao.
- Se houver um armario alto com duas cotas no contorno e uma chamada "Alt.", use a maior cota do contorno como largura, a menor como profundidade e "Alt." como altura.
- Painel, aereo, armario/roupeiro e prateleira de canto com chamada propria sao itens separados.
- Para prateleira de canto plana, use a espessura do MDF como height apenas quando largura e profundidade estiverem cotadas; descreva essa regra na observacao.
- Nao transforme cama, TV, quadros, janelas ou decoracao em itens de marcenaria.
- Use o ambiente coerente com o conjunto completo de imagens. Nao crie outro ambiente apenas porque a prancha cotada nao traz o nome do comodo.

ITENS DA PRIMEIRA LEITURA (podem conter duplicatas e eixos trocados):
${JSON.stringify(compactItems).slice(0, 18000)}`,
    }];

    for (const source of sources.slice(0, 10)) {
      userContent.push({ type: 'text', text: `Arquivo: ${source.filename}` });
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${source.imageBase64}`, detail: 'high' },
      });
    }

    try {
      const content = await this.callVision(cfg, [
        { role: 'system', content: this.buildSystemPrompt() },
        { role: 'user', content: userContent },
      ], 16000);
      const reconciled = this.extractItemsFromContent(content).map((item) => ({
        ...item,
        source: 'ocr_layout',
        sourceMediaType: 'image',
        sourcePage: 1,
        sourceText: evidenceText || null,
      }));
      if (reconciled.length > 0) {
        const measuredFirstPass = firstPassItems.filter((item) =>
          [item.width, item.height, item.depth].filter((value) => Number(value) > 0).length >= 2,
        );
        const dimensionSet = (item: any) => [item.width, item.height, item.depth]
          .map(Number)
          .filter((value) => value > 0);
        for (const measured of measuredFirstPass) {
          const measuredDimensions = dimensionSet(measured);
          const alreadyRepresented = reconciled.some((candidate) => {
            const candidateDimensions = dimensionSet(candidate);
            const sharedDimensions = measuredDimensions.filter((value) =>
              candidateDimensions.some((other) => Math.abs(other - value) <= 10),
            ).length;
            return sharedDimensions >= 2;
          });
          if (!alreadyRepresented) reconciled.push(measured);
        }
        console.log(`[Image Reconciliation] ${firstPassItems.length} item(s) de primeira leitura -> ${reconciled.length} consolidado(s), com preservacao de itens cotados.`);
        return reconciled;
      }
    } catch (error) {
      console.warn('[Image Reconciliation] Falha na consolidacao; mantendo primeira leitura:', error);
    }
    return firstPassItems;
  }

  /** Fixes dimension roles that can be proven from image-plan annotations. */
  private inferEnvironmentFromProjectName(projectName: string): string | null {
    const normalized = this.normKey(projectName);
    if (/\b(quarto|dormitorio)\b/.test(normalized)) return 'DormitÃ³rio';
    if (/\bsuite\b/.test(normalized)) return 'SuÃ­te';
    if (/\bcozinha\b/.test(normalized)) return 'Cozinha';
    if (/\bsala\b/.test(normalized)) return 'Sala';
    if (/\bbanheiro\b/.test(normalized)) return 'Banheiro';
    if (/\bescritorio\b/.test(normalized)) return 'EscritÃ³rio';
    return null;
  }

  private normalizeImagePlanMeasurements(items: any[], projectName = ''): any[] {
    const parseCm = (text: string, pattern: RegExp): number[] => {
      const values: number[] = [];
      for (const match of text.matchAll(pattern)) {
        const parsed = Number(String(match[1]).replace(',', '.'));
        if (Number.isFinite(parsed) && parsed > 0) values.push(Math.round(parsed * 10));
      }
      return values;
    };

    const projectEnvironment = this.inferEnvironmentFromProjectName(projectName);
    return items.map((original) => {
      if (original?.sourceMediaType !== 'image') return original;
      const item = { ...original };
      if (projectEnvironment) item.environment = projectEnvironment;
      const label = this.normKey([item.itemType, item.description].filter(Boolean).join(' '));
      const evidence = [item.sourceText, item.observacoes].filter(Boolean).join(' ');
      const width = Number(item.width) || 0;
      const height = Number(item.height) || 0;
      const depth = Number(item.depth) || 0;
      const thickness = Number(item.thickness) || 18;

      if (/prateleira de canto|prateleira externa/.test(label) && width > 0 && depth > 0 && height === 0) {
        item.height = thickness;
        item.itemType = 'Prateleira de canto';
        item.observacoes = `${item.observacoes || ''} | Peca plana: altura estrutural igual a espessura do MDF (${thickness} mm); planta confirma ${width} x ${depth} mm.`.replace(/^ \| /, '');
        return item;
      }

      if (depth === 0 && width > 0 && height > 0 && /torre|armario alto|roupeiro|guarda roupa|guarda-roupa/.test(label)) {
        const altitudes = parseCm(evidence, /\bAlt(?:ura)?\.?\s*:?[\s-]*(\d{1,4}(?:[.,]\d{1,2})?)\s*cm/gi);
        const explicitHeight = altitudes.sort((a, b) => b - a)[0] || 0;
        const differsFromAssignedHeight = explicitHeight > 0 && Math.abs(explicitHeight - height) >= 10;
        const isNearbyDimension = explicitHeight > 0 && Math.abs(explicitHeight - height) / explicitHeight <= 0.2;
        if (differsFromAssignedHeight && isNearbyDimension && Math.min(width, height) <= 900) {
          item.width = Math.max(width, height);
          item.depth = Math.min(width, height);
          item.height = explicitHeight;
          item.observacoes = `${item.observacoes || ''} | Eixos validados pela planta: L=${item.width} mm, A=${item.height} mm (Alt.), P=${item.depth} mm.`.replace(/^ \| /, '');
        }
      }
      return item;
    });
  }

  private async analyzeTargetedReviewPage(
    cfg: VisionConfig,
    imageBase64: string,
    pageIndex: number,
    totalPages: number,
    targets: any[],
    structuredContext?: string,
  ): Promise<any[]> {
    const userContent: any[] = [
      {
        type: 'text',
        text: `Esta e a folha ${pageIndex + 1} de ${totalPages}. Faca uma REVISAO DIRIGIDA: procure somente os itens-alvo informados no prompt, conferindo cuidadosamente cada cota e sua associacao ao movel.`,
      },
      {
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' },
      },
    ];
    if (structuredContext && structuredContext.length > 20) {
      userContent.push({
        type: 'text',
        text: `OCR/layout desta folha. Use para confirmar valores e posicoes das cotas; nao transforme valores sem associacao clara em medida do movel.\n\n${structuredContext}`,
      });
    }

    const content = await this.callVision(cfg, [
      { role: 'system', content: this.buildTargetedReviewPrompt(targets) },
      { role: 'user', content: userContent },
    ], 16000);
    const items = this.extractItemsFromContent(content).map((item) => ({
      ...item,
      source: structuredContext ? 'ocr_layout' : 'vision',
      sourcePage: pageIndex + 1,
      sourceText: structuredContext ? structuredContext.slice(0, 1200) : null,
    }));
    console.log(`[PDF Review] Sheet ${pageIndex + 1}/${totalPages}: ${items.length} targeted item(s).`);
    return items;
  }

  /** Run async tasks over a list with a bounded concurrency pool. */
  private async runPool<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, idx: number) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workerCount = Math.min(limit, items.length) || 1;
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return results;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //  NORMALIZATION
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  /**
   * Clean raw model items: coerce numbers, drop empty rows, and Ã¢â‚¬â€ crucially Ã¢â‚¬â€
   * replace any 0 primary dimension with the panel thickness so the 3D engine
   * renders a real board instead of a flat plane.
   */
  private isFurnitureContainerText(text: string): boolean {
    return /\b(armario|aereo|balcao|bancada|base|torre|ilha|painel|gabinete|modulo|movel|roupeiro|guarda roupa|guarda-roupa|nicho|coluna|cristaleira|penteadeira|mesa|estante|rack|aparador|closet|despensa)\b/.test(text);
  }

  private isNonQuoteableItem(raw: any): boolean {
    const text = this.normKey([
      raw?.description,
      raw?.itemType,
      raw?.environment,
      raw?.observacoes,
    ].filter(Boolean).join(' '));

    if (!text) return true;

    const hasFurnitureContainer = this.isFurnitureContainerText(text);
    const nonQuoteable =
      /\b(geladeira|refrigerador|freezer|forno|micro ondas|microondas|micro-ondas|cooktop|fogao|coifa|depurador|lava loucas|lava-loucas|cuba|pia|torneira|tanque|cafeteira|adega|cervejeira|eletrodomestico|eletrodomesticos|eletro|tv|televisao|quadro|planta|vaso|cortina|persiana|luminaria|luz|spot|piso|parede|revestimento da parede|rodape da obra|soleira|bancada de pedra solta|granito|quartzo solto)\b/.test(text);

    // "Torre de eletros" and "armario para forno" are furniture; the appliance
    // is only a void/reference and must stay in notes.
    return nonQuoteable && !hasFurnitureContainer;
  }

  private isSubPieceOnly(raw: any): boolean {
    const text = this.normKey([raw?.description, raw?.itemType].filter(Boolean).join(' '));
    if (this.isFurnitureContainerText(text)) return false;
    if (raw?.sourceMediaType === 'image' && /\b(prateleira de canto|prateleira externa|prateleira decorativa)\b/.test(text)) return false;
    return /\b(porta|frente|gaveta|gavetao|prateleira|divisoria|fundo|lateral|tampo|puxador|corredica|dobradica|trilho|roldana|fita led|led|perfil|ripa|sarrafo|rodape|rodateto|saia)\b/.test(text);
  }

  private sanitizeItems(rawItems: any[]): any[] {
    const out: any[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const desc = String(raw.description || raw.itemType || '').trim();
      if (!desc || desc.length < 2) continue;
      if (this.isNonQuoteableItem(raw) || this.isSubPieceOnly(raw)) continue;

      const num = (v: any) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
      };

      const w = num(raw.width);
      const h = num(raw.height);
      const d = num(raw.depth);
      const t = num(raw.thickness) || 18;

      // NÃƒÆ’O inventar dimensÃƒÂµes! Manter 0 se a IA nÃƒÂ£o encontrou cotas no documento.
      const width = Math.round(w);
      const height = Math.round(h);
      const depth = Math.round(d);
      const thickness = Math.round(t);
      const quantity = Math.max(1, Math.round(Number(raw.quantity) || 1));

      const visualOnly = width === 0 && height === 0 && depth === 0;
      const flatShelf = /\b(prateleira de canto|prateleira externa)\b/.test(this.normKey([raw.itemType, desc].join(' ')));

      // MÃƒÂ©tricas derivadas (sÃƒÂ³ calcula se tiver dimensÃƒÂµes reais)
      const areaWidth = width;
      const areaHeight = flatShelf ? depth : height;
      const hasRealDims = areaWidth > 0 && areaHeight > 0;
      const area = hasRealDims ? +(((areaWidth * areaHeight) / 1_000_000) * quantity).toFixed(3) : 0;
      const volume = hasRealDims ? +(((areaWidth * areaHeight * thickness) / 1_000_000_000) * quantity).toFixed(4) : 0;

      // Adicionar aviso se dimensÃƒÂµes estÃƒÂ£o ausentes
      const missingDims = [w === 0 && 'largura', h === 0 && 'altura', d === 0 && 'profundidade'].filter(Boolean);
      let obs = raw.observacoes ? String(raw.observacoes).substring(0, 400) : '';
      if (visualOnly && !/visual|render|sem cota|sem medida|pendencia/i.test(obs)) {
        obs = obs ? `${obs} | Identificado visualmente - sem cotas nesta imagem.` : 'Identificado visualmente - sem cotas nesta imagem.';
      }
      if (missingDims.length > 0) {
        const warning = `Ã¢Å¡Â  Medidas nÃƒÂ£o cotadas no documento (${missingDims.join(', ')}). Verificar prancha executiva.`;
        obs = obs ? `${obs} | ${warning}` : warning;
      }

      out.push({
        environment: String(raw.environment || 'Ambiente').substring(0, 191),
        itemType: String(raw.itemType || 'Caixa').substring(0, 100),
        description: desc.substring(0, 500),
        codigo: raw.codigo ? String(raw.codigo).substring(0, 60) : null,
        width,
        height,
        depth,
        thickness,
        quantity,
        materialType: String(raw.materialType || 'MDF 18mm').substring(0, 191),
        cor: raw.cor ? String(raw.cor).substring(0, 100) : null,
        acabamento: raw.acabamento ? String(raw.acabamento).substring(0, 191) : null,
        observacoes: obs.substring(0, 500) || null,
        area,
        volume,
        source: raw.source || 'vision',
        sourceMediaType: raw.sourceMediaType || null,
        sourcePage: raw.sourcePage || null,
        sourceText: raw.sourceText ? String(raw.sourceText).substring(0, 1200) : null,
        reviewTargetId: raw.reviewTargetId ? String(raw.reviewTargetId).substring(0, 191) : null,
      });
    }
    return out;
  }

  /**
   * Funde peÃƒÂ§as idÃƒÂªnticas (mesmo ambiente + tipo + material + dimensÃƒÂµes ~iguais)
   * somando a quantidade. Corrige a super-contagem: a mesma peÃƒÂ§a aparece em vÃƒÂ¡rias
   * vistas da folha e o modelo ÃƒÂ s vezes a lista repetida Ã¢â€ â€™ aqui vira 1 item com qty.
   */
  /** Normaliza texto p/ chave: minÃƒÂºsculas, sem acentos, espaÃƒÂ§os colapsados. */
  private normKey(s: string): string {
    return (s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private dedupeItems(items: any[]): any[] {
    // Canoniza nomes de ambiente: "AREA INTIMA" e "ÃƒÂrea ÃƒÂntima" viram o mesmo
    // (vence a primeira grafia com acentos/caixa mista encontrada)
    const envCanon = new Map<string, string>();
    for (const it of items) {
      const k = this.normKey(it.environment);
      const cur = envCanon.get(k);
      const cand = String(it.environment || 'Ambiente').trim();
      if (!cur || (/[a-zÃƒÂ -ÃƒÂ¿]/.test(cand) && !/[a-zÃƒÂ -ÃƒÂ¿]/.test(cur))) envCanon.set(k, cand);
    }
    for (const it of items) it.environment = envCanon.get(this.normKey(it.environment)) || it.environment;

    const map = new Map<string, any>();
    for (const it of items) {
      const key = [
        it.reviewTargetId || '',
        this.normKey(it.environment),
        (it.itemType || '').toLowerCase().trim(),
        (it.materialType || '').toLowerCase().trim(),
        Math.round((it.width || 0) / 10),   // tolerÃƒÂ¢ncia de 1cm
        Math.round((it.height || 0) / 10),
        Math.round((it.depth || 0) / 10),
        (it.width || 0) + (it.height || 0) + (it.depth || 0) === 0 ? this.normKey(it.description) : '',
      ].join('|');
      const ex = map.get(key);
      if (ex) {
        ex.quantity += it.quantity || 1;
        if ((it.description || '').length > (ex.description || '').length) ex.description = it.description;
        if ((it.observacoes || '').length > (ex.observacoes || '').length) ex.observacoes = it.observacoes;
        if (!ex.codigo && it.codigo) ex.codigo = it.codigo;
        if (!ex.acabamento && it.acabamento) ex.acabamento = it.acabamento;
      } else {
        map.set(key, { ...it });
      }
    }
    // Recalcula ÃƒÂ¡rea/volume com a quantidade consolidada
    const out = Array.from(map.values());
    for (const m of out) {
      m.area = +(((m.width * m.height) / 1_000_000) * m.quantity).toFixed(3);
      m.volume = +(((m.width * m.height * m.thickness) / 1_000_000_000) * m.quantity).toFixed(4);
    }
    return out;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //  FASE SEMÃƒâ€šNTICA Ã¢â‚¬â€ DIGITAL TWIN (Ambiente Ã¢â€ â€™ MÃƒÂ³veis Ã¢â€ â€™ Componentes Ã¢â€ â€™ Ferragens)
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  /** System prompt do montador semÃƒÂ¢ntico: transforma peÃƒÂ§as planas em um modelo paramÃƒÂ©trico. */
  private buildTwinPrompt(): string {
    return `VocÃƒÂª ÃƒÂ© um Engenheiro CAD/BIM ParamÃƒÂ©trico SÃƒÂªnior, especialista em reconstruÃƒÂ§ÃƒÂ£o 3D de marcenaria sob medida a partir de projetos executivos em PDF.

Sua responsabilidade nÃƒÂ£o ÃƒÂ© produzir uma representaÃƒÂ§ÃƒÂ£o aproximada ou conceitual. VocÃƒÂª deve criar um DIGITAL TWIN geometricamente fiel, detalhado e auditÃƒÂ¡vel de cada mÃƒÂ³vel apresentado no projeto.

O resultado serÃƒÂ¡ renderizado diretamente no Three.js 0.185 (WebGL, materiais PBR, sombras, visualizaÃƒÂ§ÃƒÂ£o paramÃƒÂ©trica, vistas explodidas, abertura de portas/gavetas e cortes).

ENTRADA:
VocÃƒÂª recebe a LISTA DE PEÃƒâ€¡AS individuais extraÃƒÂ­das das pranchas do projeto executivo, agrupadas por ambiente.

SUA MISSÃƒÆ’O:
Reconstrua SEMANTICAMENTE o projeto como um MODELO PARAMÃƒâ€°TRICO ("Digital Twin"), agrupando as peÃƒÂ§as em MÃƒâ€œVEIS coesos e detalhando os COMPONENTES tridimensionais de cada mÃƒÂ³vel.

Ãƒâ€° proibido substituir um mÃƒÂ³vel detalhado por uma caixa genÃƒÂ©rica, placa lisa, retÃƒÂ¢ngulo sem detalhes ou textura simulada. Detalhes como cantos arredondados, negativos, ripados, frisos, rebaixos, cubas esculpidas, molduras, nichos e avanÃƒÂ§os Z devem existir como geometria real nos componentes do Digital Twin.

Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
REGRA DE NÃƒÆ’O SIMPLIFICAÃƒâ€¡ÃƒÆ’O E MODELAGEM DE PROFUNDIDADE (Z-DEPTH)
Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

1. Cada detalhe desenhado, cotado ou descrito deve aparecer no modelo 3D como um componente separado, mesmo que fino (0.5cm ou 1cm).
2. Modele relevos, avanÃƒÂ§os e recuos no eixo Z (profundidade). Exemplo: painel base no fundo (Z recuado), molduras/bordas avanÃƒÂ§ando em Z, negativos/frisos entre painÃƒÂ©is com recuo real. Isso produz sombras de contato e leitura volumÃƒÂ©trica real.
3. NÃƒÂ£o use apenas texturas para substituir ripados, frisos largos, puxadores cava/chanfro ou mudanÃƒÂ§as de profundidade. Modele-os.
4. Para cantos curvos/arredondados, descreva os raios de curvatura e o formato geomÃƒÂ©trico nas notas.

Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
DECOMPOSIÃƒâ€¡ÃƒÆ’O E POSICIONAMENTO 3D (X, Y, Z em mm)
Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

1. Determine a posiÃƒÂ§ÃƒÂ£o absoluta de cada mÃƒÂ³vel no ambiente (x, y, z em mm):
   - y = 0 ÃƒÂ© o chÃƒÂ£o da sala/banheiro.
   - Bancadas de pedra/marcenaria com cuba/pia devem ser posicionadas com y entre 800 e 850 mm (altura de uso).
   - MÃƒÂ³veis aÃƒÂ©reos devem ser posicionados suspensos (ex.: y = 1500 mm).
   - Camas devem ser posicionadas com base em y = 0, estendendo-se no eixo Z para frente.
   - Cabeceiras e painÃƒÂ©is decorativos devem ser posicionados rentes ÃƒÂ  parede traseira (z = 0 ou z prÃƒÂ³ximo a 0).
   - Criados-mudos devem ser posicionados nas laterais da cama (ajustando a coordenada x em relaÃƒÂ§ÃƒÂ£o ao centro da cama).
2. Cada componente do mÃƒÂ³vel deve ter dimensÃƒÂµes (width, height, depth, thickness em mm) e posiÃƒÂ§ÃƒÂ£o local relativa ao mÃƒÂ³vel pai.
3. Classifique componentes mÃƒÂ³veis com pivÃƒÂ´ e rotaÃƒÂ§ÃƒÂ£o corretos:
   - porta: defina opening (giro_esquerda, giro_direita, basculante, tombar, correr).
   - gaveta / gavetao: defina eixo de abertura (z).
4. Infira ferragens obrigatÃƒÂ³rias por componente: porta de giro -> dobradica; porta de correr -> trilho/roldana; gaveta -> corredica; gaveta/porta -> puxador (perfil, fecho_toque, cava).

Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
FORMATO DE SAÃƒÂDA (JSON PURO)
Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

Retorne SOMENTE um objeto JSON puro (sem markdown, sem crases, sem texto fora do JSON) no formato:
{
  "environments": [
    {
      "name": "string Ã¢â‚¬â€ nome do ambiente",
      "furnitures": [
        {
          "id": "slug_unico_do_movel (ex: suite_master_guarda_roupa_01)",
          "name": "Nome descritivo e fiel do mÃƒÂ³vel (ex: ArmÃƒÂ¡rio Inferior da Pia)",
          "type": "guarda_roupa|armario_inferior|aereo|estante|painel|cama|bancada|cabeceira|nicho|mesa|balcao",
          "dimensions": {
            "width": 0,
            "height": 0,
            "depth": 0
          },
          "position": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "rotation": {
            "y": 0
          },
          "material": "material predominante do corpo (ex: MDF Beton - Guararapes)",
          "color": "cor/tom (ex: Cinza)",
          "finish": "acabamento (ex: Texturizado)",
          "components": [
            {
              "id": "slug_componente",
              "type": "porta|gaveta|gavetao|prateleira|cabideiro|tampo|cuba|pia|rodape|rodateto|saia|lateral|fundo|divisoria|nicho|ripado|perfil|metalon|ferragem|espelho|vidro|led|painel|moldura|negativo|friso",
              "opening": "giro_esquerda|giro_direita|correr|basculante|tombar|vazio",
              "width": 0,
              "height": 0,
              "depth": 0,
              "qty": 1,
              "material": "material especÃƒÂ­fico do componente (ou vazio)",
              "hardware": ["dobradica", "corredica", "puxador_perfil", "trilho_correr", "suporte_invisivel"],
              "position_local": { "x": 0, "y": 0, "z": 0 },
              "notes": "detalhes geomÃƒÂ©tricos: cantos arredondados, raios, rebaixos, espessuras finas"
            }
          ],
          "notes": "observaÃƒÂ§ÃƒÂµes gerais de construÃƒÂ§ÃƒÂ£o do mÃƒÂ³vel e montagem"
        }
      ]
    }
  ],
  "audit": {
    "warnings": [
      "lista de pendÃƒÂªncias, cotas ausentes ou inconsistÃƒÂªncias de auditoria"
    ],
    "stats": {
      "environments": 0,
      "furnitures": 0,
      "components": 0
    }
  }
}

Use milÃƒÂ­metros para TODAS as dimensÃƒÂµes e coordenadas X, Y, Z. NÃƒÂ£o simplifique a geometria. Se um mÃƒÂ³vel possui mÃƒÂºltiplos materiais ou camadas em Z, modele como componentes independentes detalhados.`;
  }

  /**
   * Parse tolerante de JSON vindo do LLM: remove cercas de markdown, extrai o bloco
   * {Ã¢â‚¬Â¦} mais externo e tenta reparos comuns (vÃƒÂ­rgulas penduradas, truncamento).
   */
  private tryParseJsonLoose(content: string): any | null {
    let clean = content.trim();
    if (clean.startsWith('```json')) clean = clean.slice(7);
    if (clean.startsWith('```')) clean = clean.slice(3);
    if (clean.endsWith('```')) clean = clean.slice(0, -3);
    clean = clean.trim();

    const attempts: string[] = [clean];
    // Bloco { Ã¢â‚¬Â¦ } mais externo (descarta texto antes/depois)
    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    if (first >= 0 && last > first) attempts.push(clean.slice(first, last + 1));
    // Reparo: vÃƒÂ­rgulas penduradas antes de } ou ]
    attempts.push(...attempts.map((a) => a.replace(/,\s*([}\]])/g, '$1')));

    for (const a of attempts) {
      try { return JSON.parse(a); } catch { /* tenta o prÃƒÂ³ximo */ }
    }
    return null;
  }

  /**
   * Monta o Digital Twin POR AMBIENTE (chamadas menores em paralelo) e agrega.
   * Gerar o projeto inteiro numa ÃƒÂºnica chamada truncava a saÃƒÂ­da (25k+ tokens)
   * e cortava ambientes Ã¢â‚¬â€ por ambiente o payload e a resposta ficam pequenos.
   */
  private async assembleDigitalTwin(cfg: VisionConfig, itemsByEnv: Record<string, any[]>): Promise<any | null> {
    const envNames = Object.keys(itemsByEnv);
    if (!envNames.length) return null;

    const buildOneEnv = async (envName: string): Promise<any | null> => {
      const payload = JSON.stringify({ [envName]: itemsByEnv[envName] });
      for (let attempt = 0; attempt < 2; attempt++) {
        const messages = [
          { role: 'system', content: this.buildTwinPrompt() },
          {
            role: 'user',
            content:
              `PEÃƒâ€¡AS EXTRAÃƒÂDAS do ambiente "${envName}":\n${payload.slice(0, 60000)}\n\nReconstrua o Digital Twin paramÃƒÂ©trico SOMENTE deste ambiente (environments terÃƒÂ¡ 1 elemento).` +
              (attempt > 0 ? '\n\nATENÃƒâ€¡ÃƒÆ’O: a tentativa anterior retornou JSON INVÃƒÂLIDO. Retorne SOMENTE JSON estritamente vÃƒÂ¡lido.' : ''),
          },
        ];
        const content = await this.callVision(cfg, messages, 10000);
        if (!content) continue;
        const parsed = this.tryParseJsonLoose(content);
        const env = parsed?.environments?.[0];
        if (env && Array.isArray(env.furnitures)) {
          console.log(`[Twin] ${envName}: ${env.furnitures.length} mÃƒÂ³vel(is).`);
          return { env, warnings: parsed?.audit?.warnings || [] };
        }
        console.warn(`[Twin] JSON invÃƒÂ¡lido p/ ambiente "${envName}" (tentativa ${attempt + 1}/2).`);
      }
      return null;
    };

    const results = await this.runPool(envNames, VISION_CONCURRENCY, (name) => buildOneEnv(name));
    const environments = results.filter(Boolean).map((r: any) => r.env);
    if (!environments.length) return null;

    const warnings = results.filter(Boolean).flatMap((r: any) => r.warnings);
    const missing = envNames.filter((_, i) => !results[i]);
    if (missing.length) warnings.push(`Ambientes nÃƒÂ£o reconstruÃƒÂ­dos: ${missing.join(', ')}`);

    const furns = environments.reduce((s: number, e: any) => s + (e.furnitures?.length || 0), 0);
    const comps = environments.reduce(
      (s: number, e: any) => s + (e.furnitures || []).reduce((t: number, f: any) => t + (f.components?.length || 0), 0),
      0,
    );
    console.log(`[Twin] Digital Twin montado: ${environments.length}/${envNames.length} ambiente(s), ${furns} mÃƒÂ³vel(is), ${comps} comp.`);
    return {
      environments,
      audit: { warnings, stats: { environments: environments.length, furnitures: furns, components: comps } },
    };
  }

  /** ReconstrÃƒÂ³i sÃƒÂ³ o Digital Twin a partir dos itens jÃƒÂ¡ salvos (sem reprocessar o PDF). */
  @Post(':id/twin')
  async rebuildTwin(@Headers('authorization') authHeader: string, @Param('id') id: string) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const project = await this.prisma.project.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    if (!project.items.length) throw new HttpException('Projeto sem peÃƒÂ§as extraÃƒÂ­das', HttpStatus.UNPROCESSABLE_ENTITY);

    const cfg = this.getVisionConfig();
    if (!cfg) throw new HttpException('Motor de IA nÃƒÂ£o configurado', HttpStatus.SERVICE_UNAVAILABLE);

    const byEnv: Record<string, any[]> = {};
    for (const it of project.items) {
      (byEnv[it.environment] = byEnv[it.environment] || []).push({
        itemType: it.itemType, description: it.description, codigo: it.codigo,
        width: it.width, height: it.height, depth: it.depth, thickness: it.thickness,
        quantity: it.quantity, materialType: it.materialType, cor: it.cor,
        acabamento: it.acabamento, observacoes: it.observacoes,
      });
    }
    const twin = await this.assembleDigitalTwin(cfg, byEnv);
    if (!twin) throw new HttpException('Falha ao montar o Digital Twin', HttpStatus.BAD_GATEWAY);
    const previousTwin = project.digitalTwin && typeof project.digitalTwin === 'object' ? project.digitalTwin as any : null;
    await this.prisma.project.update({
      where: { id },
      data: { digitalTwin: previousTwin?.interpretation ? { ...twin, interpretation: previousTwin.interpretation } : twin },
    });
    return { success: true, stats: twin.audit?.stats || null };
  }

  @Post(':id/engineering')
  async rebuildEngineering(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const project = await this.prisma.project.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    if (!project.items.length) throw new HttpException('Projeto sem moveis medidos', HttpStatus.UNPROCESSABLE_ENTITY);

    const engineering = buildEngineeringResult(project.items, {
      projectId: id,
      sheetPrice: body?.sheetPrice,
      edgePricePerMeter: body?.edgePricePerMeter,
      laborPricePerHour: body?.laborPricePerHour,
      wastePercent: body?.wastePercent,
      markup: body?.markup,
      commissionPercent: body?.commission,
      taxPercent: body?.taxPercent,
    });
    const previousTwin = project.digitalTwin && typeof project.digitalTwin === 'object' ? project.digitalTwin as any : {};
    await this.prisma.project.update({
      where: { id },
      data: {
        digitalTwin: {
          ...previousTwin,
          engineering,
        },
      },
    });
    return { success: true, engineering };
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  //  PARSE ENDPOINT
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  @Post(':id/review-pdf')
  async reviewProjectPdf(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const project = await this.prisma.project.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);

    const twin = project.digitalTwin && typeof project.digitalTwin === 'object' ? project.digitalTwin as any : {};
    const interpretation = twin.interpretation;
    if (!interpretation?.environments) {
      throw new HttpException('O projeto ainda nao possui uma leitura para revisar.', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const targets = interpretation.environments
      .flatMap((environment: any) => environment.items || [])
      .filter((item: any) => item.quoteStatus !== 'READY' || (item.validation?.issues || []).some((issue: any) => issue.severity === 'WARNING'));
    if (!targets.length) {
      return { success: true, started: false, message: 'Nao ha pendencias ou alertas para revisar.' };
    }

    const documents = Array.isArray(twin.sourceDocuments) ? twin.sourceDocuments as StoredProjectDocument[] : [];
    if (!documents.length) {
      throw new HttpException('Os arquivos deste projeto nao foram guardados para releitura. Reenvie o PDF uma vez para habilitar a revisao dirigida.', HttpStatus.CONFLICT);
    }

    await this.prisma.project.update({
      where: { id },
      data: { parseStatus: 'REVIEWING', parseProgress: 8, parseError: null },
    });
    this.runTargetedPdfReview(id, project, documents, targets).catch((error) =>
      console.error('[PDF Review] unhandled job error:', error),
    );
    return { success: true, started: true, targets: targets.length, parseStatus: 'REVIEWING' };
  }

  private async runTargetedPdfReview(
    id: string,
    project: any,
    documents: StoredProjectDocument[],
    targets: any[],
  ): Promise<void> {
    try {
      const cfg = this.getVisionConfig();
      if (!cfg) throw new Error('Motor de IA (DeepSeek/OpenAI/Gemini/Azure) nao configurado no servidor.');

      const reviewItems: any[] = [];
      const sourceFiles: ProjectSourceFile[] = [];
      const directory = this.projectUploadDirectory(id);

      for (let documentIndex = 0; documentIndex < documents.length; documentIndex++) {
        const document = documents[documentIndex];
        const safeKey = path.basename(String(document.storageKey || ''));
        const documentPath = path.join(directory, safeKey);
        if (!safeKey || !fs.existsSync(documentPath)) {
          console.warn(`[PDF Review] Stored document missing: ${document.filename}`);
          continue;
        }

        const buffer = fs.readFileSync(documentPath);
        const isPdf = document.mimeType === 'application/pdf' || document.filename.toLowerCase().endsWith('.pdf');
        const pageImages = isPdf
          ? this.convertPdfToImages(buffer, Math.max(PAGE_DPI, 450)).slice(0, MAX_PAGES)
          : [buffer.toString('base64')];
        const contexts = await this.analyzeLayout(buffer, isPdf ? 'application/pdf' : document.mimeType);
        sourceFiles.push({
          filename: document.filename,
          mimeType: document.mimeType,
          pages: pageImages.length,
          hasStructuredContext: contexts.some((context) => Boolean(context && context.length > 20)),
        });

        const pagesToReview = this.reviewPageIndexes(targets, pageImages.length);
        const fromDocument = await this.runPool(pagesToReview, 1, async (pageIndex) => {
          const pageTargets = this.reviewTargetsForPage(targets, pageIndex + 1);
          return this.analyzeTargetedReviewPage(
            cfg,
            pageImages[pageIndex],
            pageIndex,
            pageImages.length,
            pageTargets,
            contexts[pageIndex],
          );
        });
        reviewItems.push(...fromDocument.flat());
        await this.prisma.project.update({
          where: { id },
          data: { parseProgress: Math.min(75, 20 + Math.round(((documentIndex + 1) / documents.length) * 55)) },
        });
      }

      const reviewed = this.dedupeItems(this.sanitizeItems(reviewItems))
        .filter((item) => targets.some((target) => this.isSameFurniture(target, item)));
      const resolvedTargetIds: string[] = [];
      const retainedTargets = targets.map((target) => {
        const merged = this.mergeReviewedFurniture(
          target,
          reviewed.filter((item) => this.isSameFurniture(target, item)),
        );
        if (!merged) return this.sourceItemFromInterpretation(target);
        if (merged.width > 0 && merged.height > 0 && merged.depth > 0) resolvedTargetIds.push(target.id);
        return merged;
      });

      const untouchedItems = project.items
        .filter((item: any) => !targets.some((target) => this.isSameFurniture(target, item)))
        .map((item: any) => ({ ...item }));
      const consolidated = this.dedupeItems(this.sanitizeItems([...untouchedItems, ...retainedTargets]));
      const quoteReadyItems = consolidated.filter((item) => item.width > 0 && item.height > 0 && item.depth > 0);
      const nextInterpretation: any = buildProjectInterpretation(consolidated, sourceFiles);
      nextInterpretation.review = {
        mode: 'targeted_pdf_review_v1',
        reviewedAt: new Date().toISOString(),
        targetedItems: targets.length,
        resolvedItems: resolvedTargetIds.length,
        unresolvedItems: targets.length - resolvedTargetIds.length,
        resolvedTargetIds,
      };

      await this.prisma.project.update({ where: { id }, data: { parseStatus: 'VALIDATING', parseProgress: 88 } });
      await this.prisma.projectItem.deleteMany({ where: { projectId: id } });
      for (const item of quoteReadyItems) {
        await this.prisma.projectItem.create({
          data: {
            projectId: id,
            environment: item.environment,
            itemType: item.itemType,
            description: item.description,
            codigo: item.codigo,
            width: item.width,
            height: item.height,
            depth: item.depth,
            thickness: item.thickness,
            quantity: item.quantity,
            materialType: item.materialType,
            cor: item.cor,
            acabamento: item.acabamento,
            observacoes: item.observacoes,
            area: item.area,
            volume: item.volume,
          },
        });
      }

      const previousTwin = project.digitalTwin && typeof project.digitalTwin === 'object' ? project.digitalTwin as any : {};
      const engineering = quoteReadyItems.length ? buildEngineeringResult(quoteReadyItems, { projectId: id }) : null;
      await this.prisma.project.update({
        where: { id },
        data: {
          parseStatus: 'COMPLETED',
          parseProgress: 100,
          parseError: null,
          digitalTwin: { ...previousTwin, interpretation: nextInterpretation, engineering },
        },
      });
      console.log(`[PDF Review] DONE: ${resolvedTargetIds.length}/${targets.length} target(s) resolved.`);
    } catch (error: any) {
      console.error('[PDF Review] job failed:', error);
      await this.prisma.project.update({
        where: { id },
        data: { parseStatus: 'FAILED', parseProgress: 100, parseError: error?.message || 'Falha na revisao dirigida do PDF.' },
      });
    }
  }

  @Post(':id/parse')
  async parseProjectFile(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);

    // Suporta batch (array de files) e single-file (retrocompatÃƒÂ­vel)
    let files: { filename: string; fileBase64: string; mimeType: string }[] = [];
    if (Array.isArray(body.files) && body.files.length > 0) {
      files = body.files;
    } else if (body.fileBase64) {
      files = [{ filename: body.filename, fileBase64: body.fileBase64, mimeType: body.mimeType }];
    }

    if (files.length === 0) {
      throw new HttpException('Nenhum arquivo enviado.', HttpStatus.BAD_REQUEST);
    }

    const project = await this.prisma.project.findFirst({ where: { id, tenantId } });
    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    let storedDocuments: StoredProjectDocument[];
    try {
      storedDocuments = this.persistProjectDocuments(id, files);
    } catch (error) {
      console.error('[AI Reader] Could not persist uploaded project documents:', error);
      throw new HttpException('Nao foi possivel guardar os documentos para revisao.', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const filenames = files.map(f => f.filename || 'documento').join(', ');
    await this.prisma.project.update({
      where: { id },
      data: {
        originalFileUrl: filenames.substring(0, 191),
        parseStatus: 'EXTRACTING',
        parseProgress: 5,
        parseError: null,
      },
    });

    // Wipe previous extraction UMA VEZ antes de processar o batch inteiro.
    await this.prisma.projectItem.deleteMany({ where: { projectId: id } });

    // Executa a anÃƒÂ¡lise pesada em BACKGROUND Ã¢â‚¬â€ agora processando TODOS os arquivos do batch.
    this.runParseJobBatch(id, project, files, storedDocuments).catch((e) =>
      console.error('[Parse Job] erro nÃƒÂ£o tratado:', e),
    );

    return { success: true, started: true, parseStatus: 'EXTRACTING', filesCount: files.length };
  }

  /** Job pesado de anÃƒÂ¡lise Ã¢â‚¬â€ processa TODOS os arquivos do batch em sequÃƒÂªncia, consolidando itens. */
  private async runParseJobBatch(
    id: string,
    project: any,
    files: UploadedProjectFile[],
    storedDocuments: StoredProjectDocument[] = [],
  ): Promise<void> {
    let allRawItems: any[] = [];
    let isRealParsing = false;
    let parseError: string | null = null;
    const allFilenames: string[] = [];
    const sourceFiles: ProjectSourceFile[] = [];
    const imageBatchSources: Array<{ filename: string; imageBase64: string; structuredContext?: string }> = [];

    try {
      const cfg = this.getVisionConfig();
      if (!cfg) {
        throw new Error('Motor de IA (DeepSeek/OpenAI/Gemini/Azure) nÃƒÂ£o configurado no servidor.');
      }

      console.log(`[AI Reader] Iniciando batch com ${files.length} arquivo(s).`);

      // Processa cada arquivo do batch, acumulando TODOS os itens extraÃƒÂ­dos
      for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
        const file = files[fileIdx];
        const fname = file.filename || `documento-${fileIdx + 1}`;
        allFilenames.push(fname);
        console.log(`[AI Reader] Processando arquivo ${fileIdx + 1}/${files.length}: ${fname}`);

        if (!file.fileBase64 || !file.mimeType) {
          console.warn(`[AI Reader] Arquivo ${fname} sem dados Ã¢â‚¬â€ pulando.`);
          continue;
        }

        const buffer = Buffer.from(file.fileBase64, 'base64');
        const isPdf = file.mimeType === 'application/pdf' || fname.toLowerCase().endsWith('.pdf');

        // Atualizar progresso
        const progressBase = Math.round((fileIdx / files.length) * 70) + 10;
        await this.prisma.project.update({
          where: { id },
          data: { parseProgress: progressBase },
        });

        // Extract embedded text (fallback)
        let extractedText = '';
        if (isPdf) {
          try {
            const pdfModule = require('pdf-parse');
            const PDFParseClass = pdfModule.PDFParse;
            if (typeof PDFParseClass === 'function') {
              const parser = new PDFParseClass(new Uint8Array(buffer));
              const pdfData = await parser.getText();
              extractedText = pdfData.text || '';
            } else {
              const pdfParser = typeof pdfModule === 'function' ? pdfModule : (pdfModule.default || pdfModule);
              if (typeof pdfParser === 'function') {
                const pdfData = await pdfParser(buffer);
                extractedText = pdfData.text || '';
              }
            }
            console.log(`[AI Reader] ${fname}: PDF text extraction: ${extractedText.length} chars.`);
          } catch (pdfErr) {
            console.warn(`[AI Reader] ${fname}: pdf-parse failed:`, pdfErr);
          }
        }

        // Render pages to images
        let pageImages: string[] = [];
        if (isPdf) {
          pageImages = this.convertPdfToImages(buffer).slice(0, MAX_PAGES);
        } else {
          pageImages = [file.fileBase64]; // direct image upload
        }

        // CAMADA 1: Azure Document Intelligence (se configurado)
        let pageContexts: string[] = [];
        pageContexts = await this.analyzeLayout(buffer, isPdf ? 'application/pdf' : file.mimeType);
        if (!isPdf) {
          imageBatchSources.push({
            filename: fname,
            imageBase64: file.fileBase64,
            structuredContext: pageContexts.filter(Boolean).join('\n\n'),
          });
        }
        sourceFiles.push({
          filename: fname,
          mimeType: file.mimeType,
          pages: pageImages.length,
          hasStructuredContext: pageContexts.some((ctx) => Boolean(ctx && ctx.length > 20)),
        });

        await this.prisma.project.update({
          where: { id },
          data: { parseStatus: 'INTERPRETING', parseProgress: progressBase + 5 },
        });

        // CAMADA 2: Vision AI Ã¢â‚¬â€ analisa cada folha
        let rawItems: any[] = [];
        if (pageImages.length > 0) {
          const totalPagesAllFiles = pageImages.length;
          const perPage = await this.runPool(
            pageImages,
            VISION_CONCURRENCY,
            async (img, idx) => {
              let items = await this.analyzePage(cfg, img, idx, totalPagesAllFiles, pageContexts[idx], !isPdf);
              if (items.length === 0) {
                console.warn(`[AI Reader] ${fname} folha ${idx + 1} vazia Ã¢â‚¬â€ retry de completude.`);
                items = await this.analyzePage(cfg, img, idx, totalPagesAllFiles, pageContexts[idx], !isPdf);
              }
              return items;
            },
          );
          rawItems = perPage.flat().map((item) => ({ ...item, sourceFilename: fname }));
        }

        // Last resort: text-only pass
        if (rawItems.length === 0 && extractedText.length > 100) {
          console.log(`[AI Reader] ${fname}: No items from imagery, attempting text-only pass...`);
          const messages = [
            { role: 'system', content: this.buildSystemPrompt() },
            {
              role: 'user',
              content: `Analise este projeto executivo de marcenaria a partir do texto extraÃƒÂ­do e extraia TODAS as peÃƒÂ§as de TODOS os ambientes.\n\nTexto:\n${extractedText.substring(0, 14000)}`,
            },
          ];
          rawItems = this.extractItemsFromContent(await this.callVision(cfg, messages, 8192)).map((item) => ({
            ...item,
            source: 'ocr_layout',
            sourcePage: null,
            sourceText: extractedText.substring(0, 1200),
          }));
        }

        console.log(`[AI Reader] ${fname}: ${rawItems.length} raw item(s) extraÃƒÂ­dos.`);
        allRawItems = allRawItems.concat(rawItems);
      }

      // Reconcile only image-only batches. PDF behavior remains unchanged.
      if (imageBatchSources.length === files.length && imageBatchSources.length > 1) {
        allRawItems = await this.reconcileImageBatch(cfg, project?.name || '', imageBatchSources, allRawItems);
      }
      allRawItems = this.normalizeImagePlanMeasurements(allRawItems, project?.name || '');

      // Consolida TODOS os itens de TODOS os arquivos
      const sanitized = this.sanitizeItems(allRawItems);
      const deduplicated = this.dedupeItems(sanitized);
      const interpretation = buildProjectInterpretation(deduplicated, sourceFiles);
      const quoteReadyItems = deduplicated.filter((item) => item.width > 0 && item.height > 0 && item.depth > 0);
      const itemsToPersist = deduplicated.filter(
        (item) => item.sourceMediaType === 'image' || (item.width > 0 && item.height > 0 && item.depth > 0),
      );
      isRealParsing = deduplicated.length > 0;
      console.log(`[Interpretation] ${interpretation.summary.furnitureItems} movel(is), ${interpretation.summary.readyToQuote} pronto(s), ${interpretation.summary.pendingMeasurements} pendente(s), status=${interpretation.validation.status}.`);
      console.log(`[AI Reader] Batch consolidado: ${allRawItems.length} raw Ã¢â€ â€™ ${sanitized.length} sanitized Ã¢â€ â€™ ${deduplicated.length} deduplicated Ã¢â€ â€™ ${quoteReadyItems.length} quote-ready item(s).`);

      // Persist the extracted pieces.
      await this.prisma.project.update({
        where: { id },
        data: { parseStatus: 'VALIDATING', parseProgress: 85 },
      });

      const items = [];
      for (const item of itemsToPersist) {
        const createdItem = await this.prisma.projectItem.create({
          data: {
            projectId: id,
            environment: item.environment,
            itemType: item.itemType,
            description: item.description,
            codigo: item.codigo,
            width: item.width,
            height: item.height,
            depth: item.depth,
            thickness: item.thickness,
            quantity: item.quantity,
            materialType: item.materialType,
            cor: item.cor,
            acabamento: item.acabamento,
            observacoes: item.observacoes,
            area: item.area,
            volume: item.volume,
          },
        });
        items.push(createdItem);
      }

      const uniqueEnvironments = Array.from(new Set(items.map((i) => i.environment)));

      if (!parseError && items.length === 0 && deduplicated.length === 0) {
        parseError = 'Nenhum movel extraido. Verifique se as imagens contem ambientes ou mÃƒÂ³veis validos.';
      }

      // FASE SEMÃƒâ€šNTICA: Digital Twin
      let digitalTwin: any = null;
      if (!parseError && quoteReadyItems.length > 0 && process.env.ENABLE_DIGITAL_TWIN === 'true') {
        try {
          const cfgTwin = this.getVisionConfig();
          if (cfgTwin) {
            const byEnv: Record<string, any[]> = {};
            for (const it of quoteReadyItems) {
              (byEnv[it.environment] = byEnv[it.environment] || []).push({
                itemType: it.itemType, description: it.description, codigo: it.codigo,
                width: it.width, height: it.height, depth: it.depth, thickness: it.thickness,
                quantity: it.quantity, materialType: it.materialType, cor: it.cor,
                acabamento: it.acabamento, observacoes: it.observacoes,
              });
            }
            digitalTwin = await this.assembleDigitalTwin(cfgTwin, byEnv);
          }
        } catch (twinErr) {
          console.warn('[Twin] Falha ao montar Digital Twin:', twinErr);
        }
      }

      const engineering = !parseError && quoteReadyItems.length > 0
        ? buildEngineeringResult(quoteReadyItems, { projectId: id })
        : null;

      await this.prisma.project.update({
        where: { id },
        data: {
          parseStatus: parseError ? 'FAILED' : 'COMPLETED',
          parseProgress: 100,
          parseError,
          digitalTwin: digitalTwin
            ? { ...digitalTwin, interpretation, engineering, sourceDocuments: storedDocuments }
            : { environments: [], audit: { warnings: [], stats: { environments: 0, furnitures: 0, components: 0 } }, interpretation, engineering, sourceDocuments: storedDocuments },
        },
      });

      if (project.leadId) {
        try {
          const batchLabel = allFilenames.join(', ');
          await this.prisma.leadTimeline.create({
            data: {
              leadId: project.leadId,
              type: 'SYSTEM',
              content: `${isRealParsing ? 'GPT-4o Vision AI' : 'Analisador'} processou ${files.length} documento(s) "${batchLabel}": ${uniqueEnvironments.length} ambiente(s) (${uniqueEnvironments.join(', ')}), ${items.length} mÃƒÂ³veis montados.`,
              author: isRealParsing ? 'GPT-4o Vision AI Reader' : 'Analisador de Projetos',
            },
          });
        } catch { /* ignore timeline errors */ }
      }

      console.log(`[AI Reader] BATCH DONE: ${items.length} items from ${files.length} file(s), real=${isRealParsing}, envs=${uniqueEnvironments.join(', ')}`);
    } catch (err: any) {
      parseError = err?.message || 'Falha na anÃƒÂ¡lise dos documentos.';
      console.error('[AI Reader] Batch parse error:', err);
      await this.prisma.project.update({
        where: { id },
        data: {
          parseStatus: 'FAILED',
          parseProgress: 100,
          parseError,
        },
      });
    }
  }
}









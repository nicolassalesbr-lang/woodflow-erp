import { Controller, Get, Post, Body, Param, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

/**
 * Rendering DPI for the executive drawings. High DPI is required so GPT-4o Vision
 * can read the fine red dimension cotas on A3 technical sheets.
 */
const PAGE_DPI = 200;
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

  // ─────────────────────────────────────────────────────────────────────────
  //  PDF → IMAGES
  // ─────────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────────
  //  VISION / LLM
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Provedores com quota esgotada/credencial inválida nesta sessão do processo.
   * Um provedor morto é pulado até o próximo restart do PM2.
   */
  private deadProviders = new Set<string>();

  /**
   * Lista ordenada de provedores Vision disponíveis (Gemini, OpenAI e/ou Azure).
   * VISION_PROVIDER=azure|gemini inverte a prioridade. O failover em callVision pula
   * automaticamente para o próximo quando um deles fica sem quota.
   */
  private getVisionConfigs(): VisionConfig[] {
    const configs: VisionConfig[] = [];
    const gemini = this.buildGeminiConfig();
    const openai = this.buildOpenAIConfig();
    const azure = this.buildAzureConfig();
    const preferred = (process.env.VISION_PROVIDER || '').toLowerCase();
    if (preferred === 'azure') {
      if (azure) configs.push(azure);
      if (gemini) configs.push(gemini);
      if (openai) configs.push(openai);
    } else if (preferred === 'openai') {
      if (openai) configs.push(openai);
      if (gemini) configs.push(gemini);
      if (azure) configs.push(azure);
    } else {
      // Padrão: Gemini primeiro (quota gratuita disponível), depois OpenAI, depois Azure
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
      console.warn('[AI Reader] Nenhum provedor Vision disponível (sem chave ou todos sem quota).');
      return null;
    }
    return alive[0];
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

      // Se for a URL do Azure AI Studio/Foundry com gateway compatível com OpenAI
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

      // Caso clássico da Azure OpenAI
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
    return `Você é um Orçamentista Sênior e Especialista em Projetos Executivos de Marcenaria Sob Medida e Móveis Planejados.

Sua função é analisar a prancha do projeto executivo e extrair EXCLUSIVAMENTE os MÓVEIS MONTADOS (Módulos Inteiros / Estruturas Principais) com suas MEDIDAS BRUTAS EXTERNAS TOTAIS.

═══════════════════════════════════════════════════════════════════
REGRA CRÍTICA DE EXTRAÇÃO PARA MARCENARIA (MÓVEIS MONTADOS)
═══════════════════════════════════════════════════════════════════
1. NÃO EXTRAIA SUB-PEÇAS FRACIONADAS: NÃO extraia frentes de portas de giro/correr/basculantes, NÃO extraia caixas de gavetas ou gavetões, NÃO extraia prateleiras internas, divisórias, fundos, puxadores, corrediças, dobradiças ou fitas de LED como itens separados.
2. EXTRAIA APENAS MÓVEIS MONTADOS INTEIROS (MÓDULOS PRINCIPAIS): Identifique cada móvel ou bancada como um volume completo como se estivesse montado no ambiente.

Exemplos de Móveis Montados Inteiros:
- Balcão de Base / Balcão da Pia (ex: L 2400 x A 720 x P 560 mm)
- Armário Aéreo Superior (ex: L 1274 x A 600 x P 350 mm)
- Torre Quente / Torre de Eletros (ex: L 600 x A 2596 x P 600 mm)
- Bancada / Ilha Cooktop (ex: L 1859 x A 920 x P 620 mm)
- Guarda-Roupa / Roupeiro (ex: L 2970 x A 2430 x P 570 mm)
- Painel de Cabeceira / Painel de TV (ex: L 2840 x A 1300 x P 50 mm)
- Penteadeira / Escrivaninha / Mesa (ex: L 2620 x A 450 x P 450 mm)

FILTRO ABSOLUTO DE ORCAMENTO:
- Retorne somente moveis planejados/marcenaria sob medida que entram no orcamento.
- NAO extraia eletrodomesticos, metais, loucas, decoracao ou itens de obra como itens: geladeira, refrigerador, freezer, forno, micro-ondas, cooktop, fogao, coifa, depurador, cuba, pia, torneira, tanque, cafeteira, adega/cervejeira, quadro, planta, cortina, persiana, luminaria, piso, parede, rodape da obra.
- Nichos/vaos para eletros podem aparecer apenas em observacoes do movel que os contem (ex: "torre com vao para forno e micro-ondas"). Nunca crie o eletro como item.
- Fotos, perspectivas e renders 3D SEM cotas numericas servem apenas como referencia visual/material. Nao crie itens orcaveis a partir deles. A lista deve vir das pranchas cotadas ou memorias com medidas explicitas.
- Se a folha/imagem nao contem medida explicita associavel ao movel planejado, retorne {"items": []}.

═══════════════════════════════════════════════════════════════════
REGRAS DE MEDIDAS E COTAS (OBRIGATÓRIAS)
═══════════════════════════════════════════════════════════════════
1. CONVERSÃO CM -> MM: As cotas dos desenhos estão em CENTÍMETROS (cm). Multiplique OBRIGATORIAMENTE por 10 para converter em MILÍMETROS (mm).
   - Cota "127,4" cm ➔ 1274 mm
   - Cota "185,9" cm ➔ 1859 mm
   - Cota "62,0" cm ➔ 620 mm
   - Cota "259,6" cm ➔ 2596 mm
   - Cota "40,0" cm ➔ 400 mm
   - Cota "82,0" cm ➔ 820 mm

2. EIXOS DIMENSIONAIS:
   - width (largura L): dimensão horizontal na vista frontal ou elevação.
   - height (altura A): dimensão vertical na vista frontal ou elevação.
   - depth (profundidade P): profundidade externa frente/fundo lida no corte, planta ou 3D.

3. MATERIAIS E CORES:
   - Extraia o material/cor indicado na observação ou legenda (ex: "MDF Gianduia Trama (Duratex)", "MDF Freijó", "Quartzo Branco").

4. NÃO DUPLIQUE MÓVEIS:
   - Um móvel desenhado em planta, vista frontal e 3D deve ser contabilizado apenas UMA VEZ.

═══════════════════════════════════════════════════════════════════
REGRA DE CONFIABILIDADE (CRÍTICA — NUNCA VIOLE)
═══════════════════════════════════════════════════════════════════
- Se uma dimensão (width, height ou depth) NÃO está cotada/escrita no desenho, retorne null para essa dimensão.
- NUNCA invente, estime ou "adivinhe" medidas. Retorne APENAS o que está EXPLÍCITO no documento.
- Para imagens 3D / renders / perspectivas SEM cotas numericas: NAO retorne itens para orcamento. Use essas imagens apenas como apoio visual; a extracao deve vir de prancha cotada.
- A confiabilidade do orçamento depende 100% de medidas reais dos documentos.

═══════════════════════════════════════════════════════════════════
MÚLTIPLOS DOCUMENTOS DO MESMO PROJETO
═══════════════════════════════════════════════════════════════════
- O projeto pode conter vários documentos: pranchas executivas com cotas, renders 3D, fotos de referência.
- Cada folha/imagem será enviada individualmente. Extraia o que for possível de cada uma.
- Se uma folha e um render 3D/foto sem cotas, retorne {"items": []}; nao gere orcamento visual.
- Se uma folha é uma prancha executiva com cotas, extraia as medidas reais.
- O sistema consolidará as informações de todos os documentos automaticamente.

═══════════════════════════════════════════════════════════════════
FORMATO DE SAÍDA (JSON PURO)
═══════════════════════════════════════════════════════════════════
Retorne SOMENTE um objeto JSON puro no formato:
{
  "items": [
    {
      "environment": "Cozinha|Suíte|Banheiro|Dormitório|Sala",
      "itemType": "Balcão|Aéreo|Torre|Bancada|Guarda-Roupa|Painel|Cama|Mesa|Penteadeira",
      "description": "Nome legível do móvel montado (ex: Armário Aéreo sobre Pia com 3 portas)",
      "codigo": "A|B|C|1|2|vazio",
      "width": 1274,
      "height": 600,
      "depth": 350,
      "thickness": 18,
      "quantity": 1,
      "materialType": "MDF Gianduia Trama (Duratex)",
      "cor": "Gianduia Trama",
      "acabamento": "Texturizado",
      "observacoes": "Móvel aéreo montado conforme prancha.",
      "classificacao": "explicita",
      "confianca": 98
    }
  ]
}

Nota: Se a dimensão não está cotada, use null:
  "width": null,
  "height": null,
  "depth": null,
  "observacoes": "Medidas ausentes — verificar prancha executiva com cotas",
  "classificacao": "visual",
  "confianca": 30`;
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
      // Modelos de reasoning (gpt-5/o1/o3) consomem tokens em raciocínio ANTES da
      // resposta — sem folga o JSON sai truncado/vazio (finish_reason=length).
      requestBody.max_completion_tokens = maxTokens + 8000;
      // reasoning_effort low: corta a latência de ~3min para segundos por folha
      // sem comprometer a leitura de cotas (a extração é visual, não lógica-profunda)
      requestBody.reasoning_effort = process.env.VISION_REASONING_EFFORT || 'low';
      // json_object FUNCIONA no gpt-5 via chat/completions (validado); o problema
      // antigo era só no endpoint /responses. Garante JSON válido (twin quebrava sem isso).
      requestBody.response_format = { type: 'json_object' };
      // Sem temperature: modelos de reasoning não aceitam valor customizado
    } else {
      requestBody.max_tokens = maxTokens;
      requestBody.temperature = 0;
      requestBody.response_format = { type: 'json_object' };
    }

    // Provedor já marcado como morto nesta sessão → troca antes mesmo de tentar
    if (this.deadProviders.has(cfg.apiUrl)) {
      const alive = this.getVisionConfig();
      if (!alive) return null;
      if (alive.apiUrl !== cfg.apiUrl) return this.callVision(alive, messages, maxTokens, attempt);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s (3 minutos) para modelos de visão pesados

      const response = await fetch(cfg.apiUrl, {
        method: 'POST',
        headers: cfg.headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      // 429/503: diferenciar quota ESGOTADA (permanente) de rate limit temporário
      if (response.status === 429 || response.status === 503) {
        const errBody = await response.text();

        // Quota esgotada ou credencial inválida → FAILOVER imediato para o próximo provedor
        if (/insufficient_quota|billing|account is not active/i.test(errBody)) {
          this.deadProviders.add(cfg.apiUrl);
          const next = this.getVisionConfig();
          if (next && next.apiUrl !== cfg.apiUrl) {
            console.warn(`[AI Reader] ${cfg.name || 'provedor'} SEM QUOTA — failover para ${next.name || 'alternativo'}.`);
            return this.callVision(next, messages, maxTokens, 0);
          }
          console.error('[AI Reader] Quota esgotada e nenhum provedor alternativo configurado.');
          return null;
        }

        // Rate limit temporário → retry com backoff exponencial
        if (attempt < 5) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const waitMs = retryAfter > 0
            ? retryAfter * 1000
            : Math.min(3000 * Math.pow(2, attempt), 30000);
          console.warn(`[AI Reader] ${response.status} rate limit (${cfg.name}) — retry em ${waitMs}ms (tentativa ${attempt + 1}/5)`);
          await new Promise((r) => setTimeout(r, waitMs));
          return this.callVision(cfg, messages, maxTokens, attempt + 1);
        }
        console.error('[AI Reader] Rate limit persistente após 5 tentativas:', errBody.substring(0, 200));
        return null;
      }

      // 401/403: credencial inválida → failover
      if (response.status === 401 || response.status === 403) {
        this.deadProviders.add(cfg.apiUrl);
        const next = this.getVisionConfig();
        if (next && next.apiUrl !== cfg.apiUrl) {
          console.warn(`[AI Reader] ${cfg.name || 'provedor'} credencial inválida (${response.status}) — failover para ${next.name}.`);
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
    try {
      let clean = content.trim();
      if (clean.startsWith('```json')) clean = clean.slice(7);
      if (clean.startsWith('```')) clean = clean.slice(3);
      if (clean.endsWith('```')) clean = clean.slice(0, -3);
      clean = clean.trim();

      let parsed: any = JSON.parse(clean);
      if (parsed && !Array.isArray(parsed)) {
        if (Array.isArray(parsed.items)) parsed = parsed.items;
        else if (Array.isArray(parsed.pecas)) parsed = parsed.pecas;
        else {
          for (const key of Object.keys(parsed)) {
            if (Array.isArray(parsed[key])) { parsed = parsed[key]; break; }
          }
        }
      }
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('[AI Reader] JSON parse failed:', err, '| raw:', content.substring(0, 200));
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  CAMADA 1 — AZURE AI DOCUMENT INTELLIGENCE (layout/OCR + cotas + tabelas)
  // ─────────────────────────────────────────────────────────────────────────

  /** Resolve a config do Azure Document Intelligence, ou null se não configurado. */
  private getDocIntelConfig(): { endpoint: string; key: string } | null {
    const key = process.env.AZURE_AI_DOC_INTEL_KEY;
    const endpoint = process.env.AZURE_AI_DOC_INTEL_ENDPOINT;
    if (!key || !endpoint) return null;
    return { endpoint: endpoint.replace(/\/$/, ''), key };
  }

  /**
   * Envia o PDF ao modelo prebuilt-layout do Azure Document Intelligence e retorna,
   * por página (índice 0-based), um contexto estruturado (texto OCR + tabelas em
   * markdown + cotas numéricas com posição). Retorna [] se não configurado ou em
   * caso de falha — o pipeline então segue só com a imagem (fallback silencioso).
   */
  private async analyzeLayout(pdfBuffer: Buffer): Promise<string[]> {
    const di = this.getDocIntelConfig();
    if (!di) return [];

    const apiVersion = process.env.AZURE_AI_DOC_INTEL_API_VERSION || '2024-11-30';
    const isNewApi = apiVersion >= '2024-11-30';
    const analyzePath = isNewApi
      ? `/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${apiVersion}`
      : `/formrecognizer/documentModels/prebuilt-layout:analyze?api-version=${apiVersion}`;

    try {
      const submit = await fetch(`${di.endpoint}${analyzePath}`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': di.key, 'Content-Type': 'application/pdf' },
        body: pdfBuffer as any,
      });
      if (submit.status !== 202) {
        console.warn('[Doc Intelligence] submit falhou:', submit.status, (await submit.text()).slice(0, 200));
        return [];
      }
      const opLocation = submit.headers.get('operation-location') || submit.headers.get('Operation-Location');
      if (!opLocation) return [];

      // Polling da operação assíncrona (até ~60s)
      let analyzeResult: any = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(opLocation, { headers: { 'Ocp-Apim-Subscription-Key': di.key } });
        const data = await poll.json();
        if (data.status === 'succeeded') { analyzeResult = data.analyzeResult; break; }
        if (data.status === 'failed') { console.warn('[Doc Intelligence] análise falhou.'); return []; }
      }
      if (!analyzeResult) { console.warn('[Doc Intelligence] timeout no polling.'); return []; }

      const contexts = this.buildPageContexts(analyzeResult);
      console.log(`[Doc Intelligence] contexto estruturado de ${contexts.length} página(s).`);
      return contexts;
    } catch (err) {
      console.warn('[Doc Intelligence] erro:', err);
      return [];
    }
  }

  /** Monta o contexto estruturado por página a partir do analyzeResult. */
  private buildPageContexts(result: any): string[] {
    const pages: any[] = result.pages || [];
    const tables: any[] = result.tables || [];
    const contexts: string[] = [];

    pages.forEach((page: any, idx: number) => {
      const pageNum = page.pageNumber || idx + 1;
      const pw = page.width || 1;
      const ph = page.height || 1;

      const lines: string[] = (page.lines || []).map((l: any) => l.content).filter(Boolean);

      // Cotas numéricas (1-4 dígitos) com posição normalizada 0-1 na folha
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
      if (cotas.length) parts.push(`COTAS (valor@posição x,y normalizada 0-1):\n${cotas.slice(0, 90).join('; ')}`);
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

  // ─────────────────────────────────────────────────────────────────────────
  //  CAMADA 2 — GPT-4o VISION (raciocínio geométrico + cruzamento com Camada 1)
  // ─────────────────────────────────────────────────────────────────────────

  /** Analyze a single sheet image and return its extracted items. */
  private async analyzePage(
    cfg: VisionConfig,
    imageBase64: string,
    pageIndex: number,
    totalPages: number,
    structuredContext?: string,
  ): Promise<any[]> {
    const userContent: any[] = [
      {
        type: 'text',
        text: `Esta e a folha ${pageIndex + 1} de ${totalPages} de um projeto de marcenaria sob medida. Analise SOMENTE esta folha e extraia apenas MOVEIS PLANEJADOS ORCAVEIS (modulos principais/moveis montados), com medidas reais explicitas em milimetros. Nao extraia subpecas, eletrodomesticos, loucas, metais, decoracao ou itens de obra. Se for foto/render sem cotas, retorne {"items": []}.`,
      },
      {
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' },
      },
    ];

    if (structuredContext && structuredContext.length > 20) {
      userContent.push({
        type: 'text',
        text:
          `\n\nDADOS ESTRUTURADOS DESTA FOLHA (extraídos por OCR/layout do Azure Document Intelligence). ` +
          `Use estes VALORES como fonte da verdade para as cotas exatas e cruze-os com a imagem para associar cada cota ao movel correto ` +
          `(pela proximidade das posições x,y). Ainda assim aplique a regra cm→mm (×10). ` +
          `Se uma medida nao tiver cota correspondente, use null ou omita o item; nunca registre medida estimada.\n\n${structuredContext}`,
      });
    }

    const messages = [
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user', content: userContent },
    ];

    const content = await this.callVision(cfg, messages, 8192);
    console.log(`[AI Reader] Sheet ${pageIndex + 1} raw content snippet:`, content ? (content.length > 500 ? content.substring(0, 500) + '...' : content) : 'NULL');
    const items = this.extractItemsFromContent(content);
    console.log(`[AI Reader] Sheet ${pageIndex + 1}/${totalPages}: ${items.length} item(s)${structuredContext ? ' (com Doc Intelligence)' : ''}.`);
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

  // ─────────────────────────────────────────────────────────────────────────
  //  NORMALIZATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Clean raw model items: coerce numbers, drop empty rows, and — crucially —
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

      // NÃO inventar dimensões! Manter 0 se a IA não encontrou cotas no documento.
      const width = Math.round(w);
      const height = Math.round(h);
      const depth = Math.round(d);
      const thickness = Math.round(t);
      const quantity = Math.max(1, Math.round(Number(raw.quantity) || 1));

      // Render/foto sem cota costuma chegar com tudo nulo/zero. Isso nao e
      // orcamento assertivo; descarte para nao inflar itens ou valores.
      if (width === 0 && height === 0 && depth === 0) continue;

      // Métricas derivadas (só calcula se tiver dimensões reais)
      const hasRealDims = width > 0 && height > 0;
      const area = hasRealDims ? +(((width * height) / 1_000_000) * quantity).toFixed(3) : 0;
      const volume = hasRealDims ? +(((width * height * thickness) / 1_000_000_000) * quantity).toFixed(4) : 0;

      // Adicionar aviso se dimensões estão ausentes
      const missingDims = [w === 0 && 'largura', h === 0 && 'altura', d === 0 && 'profundidade'].filter(Boolean);
      let obs = raw.observacoes ? String(raw.observacoes).substring(0, 400) : '';
      if (missingDims.length > 0) {
        const warning = `⚠ Medidas não cotadas no documento (${missingDims.join(', ')}). Verificar prancha executiva.`;
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
      });
    }
    return out;
  }

  /**
   * Funde peças idênticas (mesmo ambiente + tipo + material + dimensões ~iguais)
   * somando a quantidade. Corrige a super-contagem: a mesma peça aparece em várias
   * vistas da folha e o modelo às vezes a lista repetida → aqui vira 1 item com qty.
   */
  /** Normaliza texto p/ chave: minúsculas, sem acentos, espaços colapsados. */
  private normKey(s: string): string {
    return (s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private dedupeItems(items: any[]): any[] {
    // Canoniza nomes de ambiente: "AREA INTIMA" e "Área Íntima" viram o mesmo
    // (vence a primeira grafia com acentos/caixa mista encontrada)
    const envCanon = new Map<string, string>();
    for (const it of items) {
      const k = this.normKey(it.environment);
      const cur = envCanon.get(k);
      const cand = String(it.environment || 'Ambiente').trim();
      if (!cur || (/[a-zà-ÿ]/.test(cand) && !/[a-zà-ÿ]/.test(cur))) envCanon.set(k, cand);
    }
    for (const it of items) it.environment = envCanon.get(this.normKey(it.environment)) || it.environment;

    const map = new Map<string, any>();
    for (const it of items) {
      const key = [
        this.normKey(it.environment),
        (it.itemType || '').toLowerCase().trim(),
        (it.materialType || '').toLowerCase().trim(),
        Math.round((it.width || 0) / 10),   // tolerância de 1cm
        Math.round((it.height || 0) / 10),
        Math.round((it.depth || 0) / 10),
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
    // Recalcula área/volume com a quantidade consolidada
    const out = Array.from(map.values());
    for (const m of out) {
      m.area = +(((m.width * m.height) / 1_000_000) * m.quantity).toFixed(3);
      m.volume = +(((m.width * m.height * m.thickness) / 1_000_000_000) * m.quantity).toFixed(4);
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  FASE SEMÂNTICA — DIGITAL TWIN (Ambiente → Móveis → Componentes → Ferragens)
  // ─────────────────────────────────────────────────────────────────────────

  /** System prompt do montador semântico: transforma peças planas em um modelo paramétrico. */
  private buildTwinPrompt(): string {
    return `Você é um Engenheiro CAD/BIM Paramétrico Sênior, especialista em reconstrução 3D de marcenaria sob medida a partir de projetos executivos em PDF.

Sua responsabilidade não é produzir uma representação aproximada ou conceitual. Você deve criar um DIGITAL TWIN geometricamente fiel, detalhado e auditável de cada móvel apresentado no projeto.

O resultado será renderizado diretamente no Three.js 0.185 (WebGL, materiais PBR, sombras, visualização paramétrica, vistas explodidas, abertura de portas/gavetas e cortes).

ENTRADA:
Você recebe a LISTA DE PEÇAS individuais extraídas das pranchas do projeto executivo, agrupadas por ambiente.

SUA MISSÃO:
Reconstrua SEMANTICAMENTE o projeto como um MODELO PARAMÉTRICO ("Digital Twin"), agrupando as peças em MÓVEIS coesos e detalhando os COMPONENTES tridimensionais de cada móvel.

É proibido substituir um móvel detalhado por uma caixa genérica, placa lisa, retângulo sem detalhes ou textura simulada. Detalhes como cantos arredondados, negativos, ripados, frisos, rebaixos, cubas esculpidas, molduras, nichos e avanços Z devem existir como geometria real nos componentes do Digital Twin.

═══════════════════════════════════════════════════════════════════
REGRA DE NÃO SIMPLIFICAÇÃO E MODELAGEM DE PROFUNDIDADE (Z-DEPTH)
═══════════════════════════════════════════════════════════════════

1. Cada detalhe desenhado, cotado ou descrito deve aparecer no modelo 3D como um componente separado, mesmo que fino (0.5cm ou 1cm).
2. Modele relevos, avanços e recuos no eixo Z (profundidade). Exemplo: painel base no fundo (Z recuado), molduras/bordas avançando em Z, negativos/frisos entre painéis com recuo real. Isso produz sombras de contato e leitura volumétrica real.
3. Não use apenas texturas para substituir ripados, frisos largos, puxadores cava/chanfro ou mudanças de profundidade. Modele-os.
4. Para cantos curvos/arredondados, descreva os raios de curvatura e o formato geométrico nas notas.

═══════════════════════════════════════════════════════════════════
DECOMPOSIÇÃO E POSICIONAMENTO 3D (X, Y, Z em mm)
═══════════════════════════════════════════════════════════════════

1. Determine a posição absoluta de cada móvel no ambiente (x, y, z em mm):
   - y = 0 é o chão da sala/banheiro.
   - Bancadas de pedra/marcenaria com cuba/pia devem ser posicionadas com y entre 800 e 850 mm (altura de uso).
   - Móveis aéreos devem ser posicionados suspensos (ex.: y = 1500 mm).
   - Camas devem ser posicionadas com base em y = 0, estendendo-se no eixo Z para frente.
   - Cabeceiras e painéis decorativos devem ser posicionados rentes à parede traseira (z = 0 ou z próximo a 0).
   - Criados-mudos devem ser posicionados nas laterais da cama (ajustando a coordenada x em relação ao centro da cama).
2. Cada componente do móvel deve ter dimensões (width, height, depth, thickness em mm) e posição local relativa ao móvel pai.
3. Classifique componentes móveis com pivô e rotação corretos:
   - porta: defina opening (giro_esquerda, giro_direita, basculante, tombar, correr).
   - gaveta / gavetao: defina eixo de abertura (z).
4. Infira ferragens obrigatórias por componente: porta de giro -> dobradica; porta de correr -> trilho/roldana; gaveta -> corredica; gaveta/porta -> puxador (perfil, fecho_toque, cava).

═══════════════════════════════════════════════════════════════════
FORMATO DE SAÍDA (JSON PURO)
═══════════════════════════════════════════════════════════════════

Retorne SOMENTE um objeto JSON puro (sem markdown, sem crases, sem texto fora do JSON) no formato:
{
  "environments": [
    {
      "name": "string — nome do ambiente",
      "furnitures": [
        {
          "id": "slug_unico_do_movel (ex: suite_master_guarda_roupa_01)",
          "name": "Nome descritivo e fiel do móvel (ex: Armário Inferior da Pia)",
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
              "material": "material específico do componente (ou vazio)",
              "hardware": ["dobradica", "corredica", "puxador_perfil", "trilho_correr", "suporte_invisivel"],
              "position_local": { "x": 0, "y": 0, "z": 0 },
              "notes": "detalhes geométricos: cantos arredondados, raios, rebaixos, espessuras finas"
            }
          ],
          "notes": "observações gerais de construção do móvel e montagem"
        }
      ]
    }
  ],
  "audit": {
    "warnings": [
      "lista de pendências, cotas ausentes ou inconsistências de auditoria"
    ],
    "stats": {
      "environments": 0,
      "furnitures": 0,
      "components": 0
    }
  }
}

Use milímetros para TODAS as dimensões e coordenadas X, Y, Z. Não simplifique a geometria. Se um móvel possui múltiplos materiais ou camadas em Z, modele como componentes independentes detalhados.`;
  }

  /**
   * Parse tolerante de JSON vindo do LLM: remove cercas de markdown, extrai o bloco
   * {…} mais externo e tenta reparos comuns (vírgulas penduradas, truncamento).
   */
  private tryParseJsonLoose(content: string): any | null {
    let clean = content.trim();
    if (clean.startsWith('```json')) clean = clean.slice(7);
    if (clean.startsWith('```')) clean = clean.slice(3);
    if (clean.endsWith('```')) clean = clean.slice(0, -3);
    clean = clean.trim();

    const attempts: string[] = [clean];
    // Bloco { … } mais externo (descarta texto antes/depois)
    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    if (first >= 0 && last > first) attempts.push(clean.slice(first, last + 1));
    // Reparo: vírgulas penduradas antes de } ou ]
    attempts.push(...attempts.map((a) => a.replace(/,\s*([}\]])/g, '$1')));

    for (const a of attempts) {
      try { return JSON.parse(a); } catch { /* tenta o próximo */ }
    }
    return null;
  }

  /**
   * Monta o Digital Twin POR AMBIENTE (chamadas menores em paralelo) e agrega.
   * Gerar o projeto inteiro numa única chamada truncava a saída (25k+ tokens)
   * e cortava ambientes — por ambiente o payload e a resposta ficam pequenos.
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
              `PEÇAS EXTRAÍDAS do ambiente "${envName}":\n${payload.slice(0, 60000)}\n\nReconstrua o Digital Twin paramétrico SOMENTE deste ambiente (environments terá 1 elemento).` +
              (attempt > 0 ? '\n\nATENÇÃO: a tentativa anterior retornou JSON INVÁLIDO. Retorne SOMENTE JSON estritamente válido.' : ''),
          },
        ];
        const content = await this.callVision(cfg, messages, 10000);
        if (!content) continue;
        const parsed = this.tryParseJsonLoose(content);
        const env = parsed?.environments?.[0];
        if (env && Array.isArray(env.furnitures)) {
          console.log(`[Twin] ${envName}: ${env.furnitures.length} móvel(is).`);
          return { env, warnings: parsed?.audit?.warnings || [] };
        }
        console.warn(`[Twin] JSON inválido p/ ambiente "${envName}" (tentativa ${attempt + 1}/2).`);
      }
      return null;
    };

    const results = await this.runPool(envNames, VISION_CONCURRENCY, (name) => buildOneEnv(name));
    const environments = results.filter(Boolean).map((r: any) => r.env);
    if (!environments.length) return null;

    const warnings = results.filter(Boolean).flatMap((r: any) => r.warnings);
    const missing = envNames.filter((_, i) => !results[i]);
    if (missing.length) warnings.push(`Ambientes não reconstruídos: ${missing.join(', ')}`);

    const furns = environments.reduce((s: number, e: any) => s + (e.furnitures?.length || 0), 0);
    const comps = environments.reduce(
      (s: number, e: any) => s + (e.furnitures || []).reduce((t: number, f: any) => t + (f.components?.length || 0), 0),
      0,
    );
    console.log(`[Twin] Digital Twin montado: ${environments.length}/${envNames.length} ambiente(s), ${furns} móvel(is), ${comps} comp.`);
    return {
      environments,
      audit: { warnings, stats: { environments: environments.length, furnitures: furns, components: comps } },
    };
  }

  /** Reconstrói só o Digital Twin a partir dos itens já salvos (sem reprocessar o PDF). */
  @Post(':id/twin')
  async rebuildTwin(@Headers('authorization') authHeader: string, @Param('id') id: string) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);
    const project = await this.prisma.project.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    if (!project.items.length) throw new HttpException('Projeto sem peças extraídas', HttpStatus.UNPROCESSABLE_ENTITY);

    const cfg = this.getVisionConfig();
    if (!cfg) throw new HttpException('Motor de IA não configurado', HttpStatus.SERVICE_UNAVAILABLE);

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
    await this.prisma.project.update({ where: { id }, data: { digitalTwin: twin } });
    return { success: true, stats: twin.audit?.stats || null };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  PARSE ENDPOINT
  // ─────────────────────────────────────────────────────────────────────────

  @Post(':id/parse')
  async parseProjectFile(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
    @Body() body: any
  ) {
    const tenantId = this.verifyTokenAndGetTenantId(authHeader);

    // Suporta batch (array de files) e single-file (retrocompatível)
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

    // Executa a análise pesada em BACKGROUND — agora processando TODOS os arquivos do batch.
    this.runParseJobBatch(id, project, files).catch((e) =>
      console.error('[Parse Job] erro não tratado:', e),
    );

    return { success: true, started: true, parseStatus: 'EXTRACTING', filesCount: files.length };
  }

  /** Job pesado de análise — processa TODOS os arquivos do batch em sequência, consolidando itens. */
  private async runParseJobBatch(
    id: string,
    project: any,
    files: { filename: string; fileBase64: string; mimeType: string }[],
  ): Promise<void> {
    let allRawItems: any[] = [];
    let isRealParsing = false;
    let parseError: string | null = null;
    const allFilenames: string[] = [];

    try {
      const cfg = this.getVisionConfig();
      if (!cfg) {
        throw new Error('Motor de IA (OpenAI/Azure) não configurado no servidor.');
      }

      console.log(`[AI Reader] Iniciando batch com ${files.length} arquivo(s).`);

      // Processa cada arquivo do batch, acumulando TODOS os itens extraídos
      for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
        const file = files[fileIdx];
        const fname = file.filename || `documento-${fileIdx + 1}`;
        allFilenames.push(fname);
        console.log(`[AI Reader] Processando arquivo ${fileIdx + 1}/${files.length}: ${fname}`);

        if (!file.fileBase64 || !file.mimeType) {
          console.warn(`[AI Reader] Arquivo ${fname} sem dados — pulando.`);
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
        if (isPdf) {
          pageContexts = await this.analyzeLayout(buffer);
        }

        await this.prisma.project.update({
          where: { id },
          data: { parseStatus: 'INTERPRETING', parseProgress: progressBase + 5 },
        });

        // CAMADA 2: Vision AI — analisa cada folha
        let rawItems: any[] = [];
        if (pageImages.length > 0) {
          const totalPagesAllFiles = pageImages.length;
          const perPage = await this.runPool(
            pageImages,
            VISION_CONCURRENCY,
            async (img, idx) => {
              let items = await this.analyzePage(cfg, img, idx, totalPagesAllFiles, pageContexts[idx]);
              if (items.length === 0) {
                console.warn(`[AI Reader] ${fname} folha ${idx + 1} vazia — retry de completude.`);
                items = await this.analyzePage(cfg, img, idx, totalPagesAllFiles, pageContexts[idx]);
              }
              return items;
            },
          );
          rawItems = perPage.flat();
        }

        // Last resort: text-only pass
        if (rawItems.length === 0 && extractedText.length > 100) {
          console.log(`[AI Reader] ${fname}: No items from imagery, attempting text-only pass...`);
          const messages = [
            { role: 'system', content: this.buildSystemPrompt() },
            {
              role: 'user',
              content: `Analise este projeto executivo de marcenaria a partir do texto extraído e extraia TODAS as peças de TODOS os ambientes.\n\nTexto:\n${extractedText.substring(0, 14000)}`,
            },
          ];
          rawItems = this.extractItemsFromContent(await this.callVision(cfg, messages, 8192));
        }

        console.log(`[AI Reader] ${fname}: ${rawItems.length} raw item(s) extraídos.`);
        allRawItems = allRawItems.concat(rawItems);
      }

      // Consolida TODOS os itens de TODOS os arquivos
      const sanitized = this.sanitizeItems(allRawItems);
      const deduplicated = this.dedupeItems(sanitized);
      isRealParsing = deduplicated.length > 0;
      console.log(`[AI Reader] Batch consolidado: ${allRawItems.length} raw → ${sanitized.length} sanitized → ${deduplicated.length} deduplicated item(s).`);

      // Persist the extracted pieces.
      await this.prisma.project.update({
        where: { id },
        data: { parseStatus: 'VALIDATING', parseProgress: 85 },
      });

      const items = [];
      for (const item of deduplicated) {
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

      if (!parseError && items.length === 0) {
        parseError = 'Nenhuma peça extraída dos documentos — verifique os créditos/configuração do provedor de IA e reprocesse.';
      }

      // FASE SEMÂNTICA: Digital Twin
      let digitalTwin: any = null;
      if (!parseError && items.length > 0) {
        try {
          const cfgTwin = this.getVisionConfig();
          if (cfgTwin) {
            const byEnv: Record<string, any[]> = {};
            for (const it of items) {
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

      await this.prisma.project.update({
        where: { id },
        data: {
          parseStatus: parseError ? 'FAILED' : 'COMPLETED',
          parseProgress: 100,
          parseError,
          digitalTwin: digitalTwin ?? undefined,
        },
      });

      if (project.leadId) {
        try {
          const batchLabel = allFilenames.join(', ');
          await this.prisma.leadTimeline.create({
            data: {
              leadId: project.leadId,
              type: 'SYSTEM',
              content: `${isRealParsing ? 'GPT-4o Vision AI' : 'Analisador'} processou ${files.length} documento(s) "${batchLabel}": ${uniqueEnvironments.length} ambiente(s) (${uniqueEnvironments.join(', ')}), ${items.length} móveis montados.`,
              author: isRealParsing ? 'GPT-4o Vision AI Reader' : 'Analisador de Projetos',
            },
          });
        } catch { /* ignore timeline errors */ }
      }

      console.log(`[AI Reader] BATCH DONE: ${items.length} items from ${files.length} file(s), real=${isRealParsing}, envs=${uniqueEnvironments.join(', ')}`);
    } catch (err: any) {
      parseError = err?.message || 'Falha na análise dos documentos.';
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

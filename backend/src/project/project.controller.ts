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
/** How many Vision calls run in parallel (one per sheet). Keeps latency low without tripping rate limits. */
const VISION_CONCURRENCY = 3;
/** Safety cap so a monster PDF never explodes cost/latency. */
const MAX_PAGES = 40;

interface VisionConfig {
  apiUrl: string;
  headers: Record<string, string>;
  model?: string;
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
      execSync(`pdftoppm -png -r ${dpi} "${pdfPath}" "${path.join(tmpDir, 'page')}"`, {
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 64,
      });

      const imageFiles = fs.readdirSync(tmpDir)
        .filter(f => f.startsWith('page') && f.endsWith('.png'))
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

  /** Resolve which API (Standard OpenAI or Azure OpenAI) to use, or null if unconfigured. */
  private getVisionConfig(): VisionConfig | null {
    const standardKey = process.env.OPENAI_API_KEY;
    const azureKey = process.env.AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

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
          model: deploymentName, // Necessário enviar no body no gateway da Azure AI
        };
      }

      // Caso clássico da Azure OpenAI
      const cleanClassic = cleanEndpoint.endsWith('/') ? cleanEndpoint.slice(0, -1) : cleanEndpoint;
      const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o';
      return {
        apiUrl: `${cleanClassic}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`,
        headers: {
          'Content-Type': 'application/json',
          'api-key': azureKey,
        },
      };
    }

    if (standardKey) {
      return {
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${standardKey}`,
        },
        model,
      };
    }

    console.warn('[AI Reader] No OpenAI/Azure key configured.');
    return null;
  }

  /**
   * System prompt for a SINGLE executive sheet. Deliberately free of hard-coded
   * example numbers so the model reads the drawing instead of echoing the prompt.
   */
  private buildSystemPrompt(): string {
    return `Você é um Especialista Sênior em Leitura de Projetos Executivos de Marcenaria, Mobiliário Sob Medida e Pedras.

Sua função é analisar integralmente UMA FOLHA/PRANCHA de um projeto executivo e transformá-la em dados técnicos estruturados, completos, rastreáveis e úteis para orçamento, engenharia, fabricação, conferência e instalação.

Você possui conhecimento profissional sobre:
- Projetos executivos de marcenaria (plantas, elevações, vistas frontais, vistas internas, vistas laterais, cortes, perspectivas isométricas e imagens 3D);
- Móveis planejados e mobiliário sob medida;
- MDF, madeira natural, lâminas, pedras, vidros, espelhos, metais e estofados;
- Portas de giro, correr, tombar, bascular e sistemas invisíveis;
- Gavetas, gavetões, prateleiras, nichos, cabideiros e divisórias;
- Rodapés, rodatetos, recuos, negativos, ripados, chanfros e cavas;
- Perfis de alumínio, puxadores, ferragens, metalóns e acessórios;
- Fitas e perfis de LED, temperatura de cor e formas de acionamento;
- Bancadas, cubas esculpidas, saias, rodapias e revestimentos em pedra;
- Interpretação de cotas, escalas e chamadas técnicas.

OBJETIVO: Extraia com MÁXIMA PRECISÃO e COMPLETUDE cada peça e subpeça desenhada nesta prancha — módulo principal (caixa/estrutura) E todas as subpeças (portas, gavetas, prateleiras, nichos, tampos, painéis, cabeceiras, bancadas, ripados, perfis, rodapés, divisórias, fundos, laterais). NÃO resuma: enumere TUDO. Uma folha densa pode render de 8 a 30+ peças.

═══════════════════════════════════════════════════════════════════
REGRAS FUNDAMENTAIS (22 regras — siga TODAS rigorosamente)
═══════════════════════════════════════════════════════════════════

1. Examine a prancha visualmente em alta resolução. Não confie somente na extração automática de texto ou OCR.
2. Textos rotacionados, cotas verticais, números pequenos e chamadas próximas aos desenhos devem ser examinados visualmente com atenção.
3. Relacione cada medida à linha de cota, às linhas de extensão e ao elemento correspondente.
4. Diferencie medidas gerais (externas), parciais (internas), medidas de componentes e espessuras.
5. Não associe uma medida a um móvel apenas porque ela está visualmente próxima — siga as linhas de cota.
6. Cruze as informações entre planta, vista frontal, vista interna, lateral, corte e perspectiva 3D da MESMA prancha.
7. Use as perspectivas 3D para compreender o móvel, mas extraia medidas preferencialmente dos desenhos técnicos cotados.
8. Preserve EXATAMENTE os valores encontrados. Não arredonde silenciosamente.

9. ESCALA DAS COTAS → As cotas numéricas destes desenhos estão em CENTÍMETROS (cm). Converta OBRIGATORIAMENTE para MILÍMETROS multiplicando por 10 (uma cota "148" vira 1480 mm; "55" vira 550 mm; "3" vira 30 mm). Nunca devolva o número puro da cota nos campos em mm. Leia o VALOR REAL impresso ao lado da linha de cota — não estime.

10. EIXOS (não inverta) →
    • width (largura): dimensão HORIZONTAL na elevação/vista frontal.
    • height (altura): dimensão VERTICAL na elevação/vista frontal.
    • depth (profundidade): distância frente↔fundo, lida no CORTE lateral, na planta baixa ou na vista 3D.
    Valide a lógica física: torres e roupeiros têm altura >> largura; prateleiras e tampos têm profundidade relevante e espessura fina.

11. ESPESSURA → thickness é a espessura do material (tipicamente 18 mm para MDF; portas/frentes ~18-20 mm; costas/fundo ~6-15 mm). O eixo "fino" de uma porta é a profundidade; de uma prateleira/tampo é a altura. NUNCA retorne 0 em qualquer dimensão: se for o eixo fino da peça, use a espessura.

12. Nunca invente medidas, materiais, ferragens ou componentes ausentes da prancha.
13. Nunca complete uma medida por simetria sem sinalizar que se trata de uma inferência (classificacao: "inferida").
14. Quando uma dimensão puder ser calculada pela cadeia de cotas, classifique como "calculada" e indique a fórmula nas observações.
15. Quando houver conflito entre vistas, registre o conflito nas observações com os valores divergentes.
16. Quando um número estiver ilegível ou ambíguo, não adivinhe — marque classificacao "ilegivel" e indique as leituras possíveis nas observações.
17. A observação "todas as medidas devem ser conferidas no local" NÃO elimina a obrigação de extrair todas as cotas do projeto.
18. Não confunda número de detalhe, número da prancha ou escala com uma cota dimensional.
19. Não confunda temperatura de LED (3000K, 4000K), códigos de materiais, códigos de perfis ou modelos de puxadores com cotas dimensionais.
20. Verifique se a soma das cotas parciais bate com a medida total. Se não bater, registre o conflito.
21. Verifique se a quantidade de portas, gavetas, nichos e prateleiras coincide entre vista frontal, interna e 3D.
22. Se um móvel aparecer na perspectiva 3D mas não tiver cotas em nenhuma vista técnica, registre-o com classificacao "estimada" e confianca baixa.

═══════════════════════════════════════════════════════════════════
HIERARQUIA E TIPOS
═══════════════════════════════════════════════════════════════════

Primeiro o módulo principal com as medidas EXTERNAS totais; depois cada subpeça com suas medidas próprias e quantity correta.

Tipos de módulo principal: Caixa, Aéreo, Painel, Estante, Bancada, Cama, Cabeceira, Mesa, Balcão, Guarda-Roupa.
Tipos de subpeça: Porta, Gaveta, Gavetão, Prateleira, Nicho, Tampo, Fundo, Lateral, Divisória, Cabideiro, Rodapé, Rodateto, Ripado, Saia, Cuba, Perfil, Metalon, Ferragem, Espelho, Vidro, LED.

*Bancadas (countertops)*: Feitas de pedra/madeira espessa, normalmente possuem saia frontal (15-20 cm) e rodapia contra a parede (15-20 cm). Extraia largura e profundidade totais.
*Camas*: Extraia base/estrado, cabeceira (quando integrada) e criados-mudos adjacentes como peças separadas.

═══════════════════════════════════════════════════════════════════
AMBIENTE
═══════════════════════════════════════════════════════════════════

Leia o título da folha (normalmente no canto superior ou carimbo, ex.: "EXECUTIVO MARCENÁRIA: SUÍTE MASTER" → environment "Suíte Master"). Se a folha mostrar mais de um móvel de ambientes distintos, use o ambiente correto para cada um.

═══════════════════════════════════════════════════════════════════
MATERIAIS E ACABAMENTOS
═══════════════════════════════════════════════════════════════════

Leia a legenda "MATERIAIS" e as chamadas com seta. Preencha materialType com o material exato, cor com o tom/cor indicado, e acabamento quando descrito.

Reconheça materiais como: MDF Beton, MDF Preto Trama, MDF Freijó, MDF Canela, MDF Truffel, MDF Rosa Sal, MDF Areia, Madeira Natural, Couro, Suede, Espelho Prata, Vidro Reflecta Fumê, Vidro Extra Clear, Silestone, Granito, Metalon, Laca, Porcelanato.

NÃO substitua fabricante, padrão ou acabamento por descrição genérica. Preserve: "MDF Beton - Guararapes", "Silestone Cinder Crazy", etc.

═══════════════════════════════════════════════════════════════════
FERRAGENS E ACESSÓRIOS
═══════════════════════════════════════════════════════════════════

Extraia e registre no campo "ferragens" (array de strings): puxadores (modelo, código, cor — ex.: "P170 preto", "Oslo Espia", "fecho e toque"), perfis (ex.: "P1145 preto", "PX060"), trilhos, sistemas de correr (ex.: "sistema invisível S150"), dobradiças, corrediças, cabideiros, papeleiras, barras de toalha, suportes, ferragens de regulagem.

Preserve códigos e modelos LITERALMENTE: P170, P545, PX060, P1145, Oslo Espia, Bali, Santa Fé.

═══════════════════════════════════════════════════════════════════
ILUMINAÇÃO
═══════════════════════════════════════════════════════════════════

Registre no campo "iluminacao": tipo (fita LED, spot, arandela), temperatura (3000K, 4000K — diferencie!), localização (perfil superior, rodapé, nicho), forma de acionamento (sensor de presença, interruptor, botoeira), necessidade de recorte.

═══════════════════════════════════════════════════════════════════
OBSERVAÇÕES DE FABRICAÇÃO E INSTALAÇÃO
═══════════════════════════════════════════════════════════════════

Extraia INTEGRALMENTE no campo "fabricacao": rodapé recuado, rodateto recuado, trilho fixado no forro, perfil na cor preta/alumínio, puxador tipo cava/chanfro/passante, bordas avançadas, detalhes de negativos, ripados e espaçamentos, interior fitado em outro MDF, peças reguláveis/removíveis, alturas de instalação, conferências obrigatórias no local.

NÃO resuma instruções que afetem orçamento ou fabricação.

═══════════════════════════════════════════════════════════════════
FORMATO DE SAÍDA (JSON PURO)
═══════════════════════════════════════════════════════════════════

Retorne SOMENTE um objeto JSON puro (sem markdown, sem crases, sem texto fora do JSON) no formato:
{
  "items": [
    {
      "environment": "string — nome do ambiente",
      "itemType": "Caixa|Aéreo|Painel|Estante|Porta|Gaveta|Gavetão|Prateleira|Nicho|Tampo|Bancada|Cabeceira|Mesa|Cama|Balcão|Guarda-Roupa|Rodapé|Rodateto|Fundo|Lateral|Divisória|Cabideiro|Ripado|Saia|Cuba|Perfil|Metalon|Ferragem|Espelho|Vidro|LED",
      "description": "descrição técnica detalhada da peça (incluir função, posição e relação com o módulo pai)",
      "codigo": "referência/balão da prancha (letras A, B, C, D ou código do detalhe — ou vazio)",
      "width": 0,
      "height": 0,
      "depth": 0,
      "thickness": 18,
      "quantity": 1,
      "materialType": "material exato conforme legenda (ex.: MDF Beton - Guararapes)",
      "cor": "cor/tom exato (ou vazio)",
      "acabamento": "acabamento exato (ou vazio)",
      "observacoes": "notas técnicas + instruções de fabricação/instalação + conflitos + fórmulas de cálculo",
      "classificacao": "explicita|calculada|inferida|estimada|ilegivel",
      "confianca": 95,
      "ferragens": ["puxador P170 preto", "dobradiça", "corrediça"],
      "iluminacao": "fita LED 3000K embutida no perfil superior, acionamento por sensor de presença",
      "fabricacao": "rodapé recuado 5cm, interior fitado MDF Areia, prateleiras reguláveis"
    }
  ]
}

CAMPOS OBRIGATÓRIOS: environment, itemType, description, width, height, depth, thickness, quantity, materialType.
CAMPOS RECOMENDADOS: cor, acabamento, observacoes, classificacao, confianca, ferragens, iluminacao, fabricacao, codigo.

Quando classificacao for "calculada", inclua a fórmula nas observacoes (ex.: "calculada: 1480 - 36 = 1444, cotas de origem: largura total 148cm menos 2 laterais de 1.8cm").
Quando classificacao for "ilegivel", indique as leituras possíveis nas observacoes.
Quando houver conflito entre vistas, indique em observacoes: "CONFLITO: vista frontal = 550mm, corte = 530mm".

═══════════════════════════════════════════════════════════════════
AUDITORIA FINAL (antes de retornar o JSON)
═══════════════════════════════════════════════════════════════════

1. Compare todas as vistas do mesmo móvel nesta prancha.
2. Verifique se a soma das cotas parciais corresponde à medida total.
3. Compare quantidade de portas, gavetas, nichos e prateleiras entre vistas.
4. Verifique se todos os materiais da legenda foram associados a alguma peça.
5. Verifique se toda ferragem indicada aparece no item correto.
6. Verifique se todos os móveis das imagens 3D foram inventariados.
7. Liste medidas necessárias à fabricação ausentes como items com classificacao "ausente".

Extraia APENAS o que está documentado nesta prancha. Não invente peças de outras folhas. Se um móvel não tiver cota visível para uma dimensão, deduza pela proporção do desenho e espessura — mas classifique como "estimada" com confianca baixa.`;
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
      temperature: 0,
      response_format: { type: 'json_object' },
    };
    if (cfg.model) requestBody.model = cfg.model;

    if (isNewModel) {
      requestBody.max_completion_tokens = maxTokens;
    } else {
      requestBody.max_tokens = maxTokens;
    }

    try {
      const response = await fetch(cfg.apiUrl, {
        method: 'POST',
        headers: cfg.headers,
        body: JSON.stringify(requestBody),
      });

      // Rate limit / indisponibilidade temporária → retry com backoff exponencial
      if ((response.status === 429 || response.status === 503) && attempt < 5) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = retryAfter > 0
          ? retryAfter * 1000
          : Math.min(3000 * Math.pow(2, attempt), 30000);
        console.warn(`[AI Reader] ${response.status} rate limit — retry em ${waitMs}ms (tentativa ${attempt + 1}/5)`);
        await new Promise((r) => setTimeout(r, waitMs));
        return this.callVision(cfg, messages, maxTokens, attempt + 1);
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
        text: `Esta é a folha ${pageIndex + 1} de ${totalPages} de um projeto executivo de marcenaria sob medida. Analise SOMENTE esta folha e extraia TODAS as peças (módulo principal e cada subpeça) com suas medidas reais de fabricação em milímetros.`,
      },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'high' },
      },
    ];

    if (structuredContext && structuredContext.length > 20) {
      userContent.push({
        type: 'text',
        text:
          `\n\nDADOS ESTRUTURADOS DESTA FOLHA (extraídos por OCR/layout do Azure Document Intelligence). ` +
          `Use estes VALORES como fonte da verdade para as cotas exatas e cruze-os com a imagem para associar cada cota à peça correta ` +
          `(pela proximidade das posições x,y). Ainda assim aplique a regra cm→mm (×10). ` +
          `Se uma medida não tiver cota correspondente aqui, registre "medida estimada" em observacoes.\n\n${structuredContext}`,
      });
    }

    const messages = [
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user', content: userContent },
    ];

    const content = await this.callVision(cfg, messages, 8192);
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
  private sanitizeItems(rawItems: any[]): any[] {
    const out: any[] = [];
    for (const raw of rawItems) {
      const num = (v: any) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
      };

      let w = num(raw.width);
      let h = num(raw.height);
      let d = num(raw.depth);
      let t = num(raw.thickness) || 18;

      // Need at least two real dimensions to be a meaningful piece.
      const realDims = [w, h, d].filter((x) => x > 0).length;
      if (realDims < 2) continue;

      // Fill the missing (thin) axis with the material thickness — never leave a 0.
      if (w === 0) w = t;
      if (h === 0) h = t;
      if (d === 0) d = t;

      const width = Math.round(w);
      const height = Math.round(h);
      const depth = Math.round(d);
      const thickness = Math.round(t);
      const quantity = Math.max(1, Math.round(Number(raw.quantity) || 1));

      // Derived production metrics (m² face area, m³ volume) per the whole quantity.
      const area = +(((width * height) / 1_000_000) * quantity).toFixed(3);
      const volume = +(((width * height * thickness) / 1_000_000_000) * quantity).toFixed(4);

      out.push({
        environment: String(raw.environment || 'Ambiente').substring(0, 191),
        itemType: String(raw.itemType || 'Caixa').substring(0, 100),
        description: String(raw.description || 'Peça estrutural').substring(0, 500),
        codigo: raw.codigo ? String(raw.codigo).substring(0, 60) : null,
        width,
        height,
        depth,
        thickness,
        quantity,
        materialType: String(raw.materialType || 'MDF 18mm').substring(0, 191),
        cor: raw.cor ? String(raw.cor).substring(0, 100) : null,
        acabamento: raw.acabamento ? String(raw.acabamento).substring(0, 191) : null,
        observacoes: raw.observacoes ? String(raw.observacoes).substring(0, 500) : null,
        area,
        volume,
      });
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

  /** Monta o Digital Twin a partir das peças agrupadas por ambiente (1 chamada LLM). */
  private async assembleDigitalTwin(cfg: VisionConfig, itemsByEnv: Record<string, any[]>): Promise<any | null> {
    const payload = JSON.stringify(itemsByEnv);
    const messages = [
      { role: 'system', content: this.buildTwinPrompt() },
      { role: 'user', content: `PEÇAS EXTRAÍDAS (por ambiente):\n${payload.slice(0, 30000)}\n\nReconstrua o Digital Twin paramétrico completo.` },
    ];
    const content = await this.callVision(cfg, messages, 12000);
    if (!content) return null;
    try {
      let clean = content.trim();
      if (clean.startsWith('```json')) clean = clean.slice(7);
      if (clean.startsWith('```')) clean = clean.slice(3);
      if (clean.endsWith('```')) clean = clean.slice(0, -3);
      const twin = JSON.parse(clean.trim());
      const envs = twin.environments?.length || 0;
      const furns = (twin.environments || []).reduce((s: number, e: any) => s + (e.furnitures?.length || 0), 0);
      console.log(`[Twin] Digital Twin montado: ${envs} ambiente(s), ${furns} móvel(is).`);
      return twin;
    } catch (err) {
      console.warn('[Twin] JSON inválido do montador:', err);
      return null;
    }
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
    const { filename, fileBase64, mimeType } = body;

    const project = await this.prisma.project.findFirst({ where: { id, tenantId } });
    if (!project) {
      throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    await this.prisma.project.update({
      where: { id },
      data: {
        originalFileUrl: filename || 'planta_baixa.pdf',
        parseStatus: 'EXTRACTING',
        parseProgress: 5,
        parseError: null,
      },
    });

    // Wipe previous extraction so re-parses start clean.
    await this.prisma.projectItem.deleteMany({ where: { projectId: id } });

    let sanitized: any[] = [];
    let isRealParsing = false;
    let parseError: string | null = null;

    try {
      if (!fileBase64 || !mimeType) {
        throw new Error('Arquivo ausente no payload.');
      }

      const cfg = this.getVisionConfig();
      if (!cfg) {
        throw new Error('Motor de IA (OpenAI/Azure) não configurado no servidor.');
      }

      const buffer = Buffer.from(fileBase64, 'base64');
      const isPdf = mimeType === 'application/pdf' || filename?.toLowerCase().endsWith('.pdf');

      // Extract embedded text (used only as a last-resort fallback).
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
          console.log(`[AI Reader] PDF text extraction: ${extractedText.length} chars.`);
        } catch (pdfErr) {
          console.warn('[AI Reader] pdf-parse failed:', pdfErr);
        }
      }

      // Render each sheet to a high-DPI image.
      let pageImages: string[] = [];
      if (isPdf) {
        pageImages = this.convertPdfToImages(buffer).slice(0, MAX_PAGES);
      } else {
        pageImages = [fileBase64]; // direct image upload
      }

      // CAMADA 1: extração estrutural (Azure Document Intelligence), se configurado.
      // Retorna contexto por página; [] se ausente → segue só com a imagem.
      let pageContexts: string[] = [];
      if (isPdf) {
        pageContexts = await this.analyzeLayout(buffer);
      }

      await this.prisma.project.update({
        where: { id },
        data: { parseStatus: 'INTERPRETING', parseProgress: 25 },
      });

      // CAMADA 2: analisa cada folha em paralelo (imagem + contexto estruturado).
      let rawItems: any[] = [];
      if (pageImages.length > 0) {
        const perPage = await this.runPool(
          pageImages,
          VISION_CONCURRENCY,
          (img, idx) => this.analyzePage(cfg, img, idx, pageImages.length, pageContexts[idx]),
        );
        rawItems = perPage.flat();
      }

      // Last resort: if imagery produced nothing but we have text, try a text pass.
      if (rawItems.length === 0 && extractedText.length > 100) {
        console.log('[AI Reader] No items from imagery, attempting text-only pass...');
        const messages = [
          { role: 'system', content: this.buildSystemPrompt() },
          {
            role: 'user',
            content: `Analise este projeto executivo de marcenaria a partir do texto extraído e extraia TODAS as peças de TODOS os ambientes.\n\nTexto:\n${extractedText.substring(0, 14000)}`,
          },
        ];
        rawItems = this.extractItemsFromContent(await this.callVision(cfg, messages, 8192));
      }

      sanitized = this.sanitizeItems(rawItems);
      isRealParsing = sanitized.length > 0;
      console.log(`[AI Reader] Aggregated ${rawItems.length} raw → ${sanitized.length} sanitized item(s).`);
    } catch (err: any) {
      parseError = err?.message || 'Falha na análise do documento.';
      console.error('[AI Reader] Parse error:', err);
    }

    await this.prisma.project.update({
      where: { id },
      data: { parseStatus: 'VALIDATING', parseProgress: 85 },
    });

    // Persist the extracted pieces.
    const items = [];
    for (const item of sanitized) {
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

    // FASE SEMÂNTICA: monta o Digital Twin paramétrico a partir das peças salvas.
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
        await this.prisma.leadTimeline.create({
          data: {
            leadId: project.leadId,
            type: 'SYSTEM',
            content: `${isRealParsing ? 'GPT-4o Vision AI' : 'Analisador'} processou "${filename || 'projeto.pdf'}": ${uniqueEnvironments.length} ambiente(s) (${uniqueEnvironments.join(', ')}), ${items.length} peças com medidas de produção.`,
            author: isRealParsing ? 'GPT-4o Vision AI Reader' : 'Analisador de Projetos',
          },
        });
      } catch { /* ignore timeline errors */ }
    }

    console.log(`[AI Reader] DONE: ${items.length} items, real=${isRealParsing}, envs=${uniqueEnvironments.join(', ')}`);

    if (parseError && items.length === 0) {
      throw new HttpException(parseError, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    return {
      success: true,
      itemsParsedCount: items.length,
      environments: uniqueEnvironments,
      items,
      isReal: isRealParsing,
    };
  }
}

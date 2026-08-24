export type ProjectSourceFile = {
  filename: string;
  mimeType?: string;
  pages: number;
  hasStructuredContext: boolean;
};

export type ValidationSeverity = 'INFO' | 'WARNING' | 'BLOCKER';

export type ValidationIssue = {
  code: string;
  severity: ValidationSeverity;
  message: string;
  itemRef?: string;
  environment?: string;
};

export type InterpretationItem = {
  id: string;
  environment: string;
  itemType: string;
  description: string;
  codigo?: string | null;
  dimensions: {
    width: number | null;
    height: number | null;
    depth: number | null;
    thickness: number | null;
  };
  quantity: number;
  materialType: string;
  color?: string | null;
  finish?: string | null;
  quoteStatus: 'READY' | 'PENDING_MEASUREMENTS' | 'REVIEW_REQUIRED';
  confidence: number;
  evidence: {
    source: 'vision' | 'ocr_layout' | 'manual' | 'unknown';
    sourcePage?: number | null;
    sourceText?: string | null;
    notes?: string | null;
  };
  validation: {
    issues: ValidationIssue[];
  };
};

export type ProjectInterpretation = {
  schemaVersion: 'project-interpretation/v1';
  generatedAt: string;
  pipeline: {
    mode: 'hybrid_ocr_vision_v1';
    stages: string[];
  };
  sourceFiles: ProjectSourceFile[];
  summary: {
    environments: number;
    furnitureItems: number;
    completeMeasurements: number;
    readyToQuote: number;
    pendingMeasurements: number;
    blockers: number;
    warnings: number;
  };
  environments: Array<{
    name: string;
    items: InterpretationItem[];
  }>;
  validation: {
    status: 'READY_TO_QUOTE' | 'NEEDS_REVIEW' | 'BLOCKED';
    issues: ValidationIssue[];
    requiredQuestions: string[];
  };
};

const QUOTEABLE_TYPES = [
  'aereo',
  'armario',
  'balcao',
  'bancada',
  'base',
  'torre',
  'ilha',
  'painel',
  'guarda',
  'roupeiro',
  'mesa',
  'penteadeira',
  'estante',
  'rack',
  'nicho',
  'coluna',
  'despensa',
];

function norm(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toNullableDimension(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function itemId(item: any, index: number): string {
  const env = norm(item.environment || 'ambiente').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const type = norm(item.itemType || 'movel').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const rawCode = norm(item.codigo || '');
  const meaningfulCode = rawCode && !/^(sem codigo|vazio|nao identificado|null|n\/a)$/.test(rawCode);
  const code = meaningfulCode ? rawCode.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
  const description = norm(item.description || '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44);
  // The ordinal is intentional. Executive drawings often contain several
  // no-code cabinets of the same type; duplicate IDs made the PDF review mix
  // dimensions belonging to different modules.
  return [
    env || 'ambiente',
    type || 'movel',
    code || description || 'sem-codigo',
    String(index + 1).padStart(2, '0'),
  ].join('-');
}

function isLikelyQuoteableFurniture(item: any): boolean {
  const text = norm([item.itemType, item.description, item.observacoes].filter(Boolean).join(' '));
  return QUOTEABLE_TYPES.some((token) => text.includes(token));
}

/**
 * Reject dimension combinations that are numerically valid but conflict with
 * the furniture type. This catches room heights assigned to base cabinets and
 * appliance-void dimensions assigned to tall cabinets without hiding the raw
 * evidence from the review UI.
 */
export function dimensionSemanticConflict(item: any): string | null {
  const width = toNullableDimension(item.width ?? item.dimensions?.width);
  const height = toNullableDimension(item.height ?? item.dimensions?.height);
  const depth = toNullableDimension(item.depth ?? item.dimensions?.depth);
  if (!width || !height || !depth) return null;

  const text = norm([item.itemType, item.description].filter(Boolean).join(' '));
  if (width > 12000 || height > 4000 || depth > 1800) {
    return 'Dimensoes externas excedem os limites tecnicos gerais de um movel planejado.';
  }
  if (/\b(balcao|gabinete|base|bancada|ilha|peninsula)\b/.test(text) && (height < 300 || height > 1500)) {
    return 'Altura incompativel com balcao, bancada ou ilha; pode ser uma cota do ambiente.';
  }
  if (/\b(aereo|armario superior|movel superior)\b/.test(text) && (height < 200 || height > 1800 || depth > 800)) {
    return 'Dimensoes incompativeis com um movel aereo; conferir se a cota pertence a outro modulo.';
  }
  if (/\b(torre|coluna|armario alto|movel alto|roupeiro|guarda roupa|guarda-roupa)\b/.test(text)
    && (height < 1200 || height > 3500 || width > 2000 || depth > 800)) {
    return 'Dimensoes incompativeis com torre ou armario alto; pode ser um vao ou uma cota total da parede.';
  }
  return null;
}

function buildItemIssues(item: any, ref: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const width = toNullableDimension(item.width);
  const height = toNullableDimension(item.height);
  const depth = toNullableDimension(item.depth);
  const missing = [
    !width && 'largura',
    !height && 'altura',
    !depth && 'profundidade',
  ].filter(Boolean) as string[];

  if (missing.length) {
    issues.push({
      code: 'MISSING_DIMENSIONS',
      severity: missing.length === 3 ? 'BLOCKER' : 'WARNING',
      itemRef: ref,
      environment: String(item.environment || 'Ambiente'),
      message: `Medidas ausentes: ${missing.join(', ')}.`,
    });
  }

  if (!isLikelyQuoteableFurniture(item)) {
    issues.push({
      code: 'TYPE_REVIEW_REQUIRED',
      severity: 'WARNING',
      itemRef: ref,
      environment: String(item.environment || 'Ambiente'),
      message: 'Tipo de movel exige revisao antes de orcar.',
    });
  }

  if (!item.materialType || norm(item.materialType) === 'mdf 18mm' || norm(item.materialType).includes('nao especificado')) {
    issues.push({
      code: 'MISSING_MATERIAL',
      severity: 'WARNING',
      itemRef: ref,
      environment: String(item.environment || 'Ambiente'),
      message: 'Material/cor nao confirmado no documento.',
    });
  }

  const dims = [width, height, depth].filter((n): n is number => Boolean(n));
  if (dims.some((n) => n > 6000 || n < 30)) {
    issues.push({
      code: 'SUSPICIOUS_DIMENSION',
      severity: 'WARNING',
      itemRef: ref,
      environment: String(item.environment || 'Ambiente'),
      message: 'Uma ou mais medidas parecem fora da faixa usual de marcenaria e devem ser conferidas.',
    });
  }

  const semanticConflict = dimensionSemanticConflict(item);
  if (semanticConflict) {
    issues.push({
      code: 'DIMENSION_SEMANTIC_CONFLICT',
      severity: 'BLOCKER',
      itemRef: ref,
      environment: String(item.environment || 'Ambiente'),
      message: semanticConflict,
    });
  }

  return issues;
}

export function buildProjectInterpretation(
  items: any[],
  sourceFiles: ProjectSourceFile[],
): ProjectInterpretation {
  const interpretedItems: InterpretationItem[] = items.map((item, index) => {
    const id = itemId(item, index);
    const width = toNullableDimension(item.width);
    const height = toNullableDimension(item.height);
    const depth = toNullableDimension(item.depth);
    const thickness = toNullableDimension(item.thickness) || 18;
    const issues = buildItemIssues(item, id);
    const hasAllMainDimensions = Boolean(width && height && depth);
    const hasBlocker = issues.some((issue) => issue.severity === 'BLOCKER');
    const hasWarning = issues.some((issue) => issue.severity === 'WARNING');
    const visualOnly = !width && !height && !depth;

    return {
      id,
      environment: String(item.environment || 'Ambiente'),
      itemType: String(item.itemType || 'Movel'),
      description: String(item.description || item.itemType || 'Movel planejado'),
      codigo: item.codigo || null,
      dimensions: { width, height, depth, thickness },
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      materialType: String(item.materialType || 'Nao especificado'),
      color: item.cor || null,
      finish: item.acabamento || null,
      quoteStatus: hasAllMainDimensions && !hasBlocker ? (hasWarning ? 'REVIEW_REQUIRED' : 'READY') : 'PENDING_MEASUREMENTS',
      confidence: visualOnly ? 30 : hasWarning ? 70 : 90,
      evidence: {
        source: item.source || 'vision',
        sourcePage: item.sourcePage || null,
        sourceText: item.sourceText || null,
        notes: item.observacoes || null,
      },
      validation: { issues },
    };
  });

  const envMap = new Map<string, InterpretationItem[]>();
  for (const item of interpretedItems) {
    const key = item.environment || 'Ambiente';
    envMap.set(key, [...(envMap.get(key) || []), item]);
  }

  const issues: ValidationIssue[] = interpretedItems.flatMap((item) => item.validation.issues);
  const blockers = issues.filter((issue) => issue.severity === 'BLOCKER').length;
  const warnings = issues.filter((issue) => issue.severity === 'WARNING').length;
  const readyToQuote = interpretedItems.filter((item) => item.quoteStatus === 'READY').length;
  const completeMeasurements = interpretedItems.filter((item) =>
    Boolean(item.dimensions.width && item.dimensions.height && item.dimensions.depth)
    && !item.validation.issues.some((issue) => issue.code === 'DIMENSION_SEMANTIC_CONFLICT'),
  ).length;
  const pendingMeasurements = interpretedItems.filter((item) => item.quoteStatus === 'PENDING_MEASUREMENTS').length;

  const requiredQuestions: string[] = [];
  const pendingByEnv = new Map<string, number>();
  for (const item of interpretedItems.filter((it) => it.quoteStatus === 'PENDING_MEASUREMENTS')) {
    pendingByEnv.set(item.environment, (pendingByEnv.get(item.environment) || 0) + 1);
  }
  for (const [environment, count] of pendingByEnv) {
    requiredQuestions.push(`Confirmar medidas completas de ${count} movel(is) em ${environment}.`);
  }
  if (interpretedItems.some((item) => norm(item.materialType).includes('nao especificado'))) {
    requiredQuestions.push('Confirmar material/cor dos moveis sem especificacao.');
  }

  return {
    schemaVersion: 'project-interpretation/v1',
    generatedAt: new Date().toISOString(),
    pipeline: {
      mode: 'hybrid_ocr_vision_v1',
      stages: ['upload', 'pdf_render', 'ocr_layout', 'vision_furniture_detection', 'normalization', 'validation', 'structured_json'],
    },
    sourceFiles,
    summary: {
      environments: envMap.size,
      furnitureItems: interpretedItems.length,
      completeMeasurements,
      readyToQuote,
      pendingMeasurements,
      blockers,
      warnings,
    },
    environments: Array.from(envMap.entries()).map(([name, envItems]) => ({ name, items: envItems })),
    validation: {
      status: blockers > 0 ? 'BLOCKED' : warnings > 0 || pendingMeasurements > 0 ? 'NEEDS_REVIEW' : 'READY_TO_QUOTE',
      issues,
      requiredQuestions,
    },
  };
}

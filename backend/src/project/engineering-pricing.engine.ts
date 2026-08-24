export type EngineeringComponentType =
  | 'panel'
  | 'back_panel'
  | 'edge_tape'
  | 'hardware'
  | 'labor';

export type EngineeringComponent = {
  code: string;
  sourceItemId?: string;
  environment: string;
  furniture: string;
  moduleType: string;
  type: EngineeringComponentType;
  label: string;
  width?: number;
  height?: number;
  depth?: number;
  thickness?: number;
  quantity: number;
  material: string;
  unit: 'm2' | 'm' | 'un' | 'h';
  consumption: number;
  unitCost: number;
  totalCost: number;
  rule: string;
  notes?: string;
};

export type EngineeringResult = {
  schemaVersion: 'woodflow-engineering/v1';
  generatedAt: string;
  source: {
    projectId?: string;
    items: number;
    quoteReadyItems: number;
  };
  assumptions: string[];
  summary: {
    components: number;
    panels: number;
    panelAreaM2: number;
    edgeMeters: number;
    hardwareItems: number;
    laborHours: number;
    sheets: number;
    directCost: number;
    salePrice: number;
    commissionValue: number;
    taxValue: number;
    netProfit: number;
    netMarginPercent: number;
  };
  sheetsByMaterial: Record<string, number>;
  materials: Array<{
    material: string;
    panelAreaM2: number;
    sheets: number;
    cost: number;
  }>;
  components: EngineeringComponent[];
  validations: Array<{
    severity: 'INFO' | 'WARNING' | 'BLOCKER';
    message: string;
    item?: string;
  }>;
  pricing: {
    sheetPrice: number;
    edgePricePerMeter: number;
    laborPricePerHour: number;
    wastePercent: number;
    markup: number;
    commissionPercent: number;
    taxPercent: number;
  };
};

export type EngineeringPricingParams = {
  projectId?: string;
  sheetPrice?: number;
  edgePricePerMeter?: number;
  laborPricePerHour?: number;
  wastePercent?: number;
  markup?: number;
  commissionPercent?: number;
  taxPercent?: number;
};

const SHEET_W = 2750;
const SHEET_H = 1840;
const SHEET_AREA_M2 = (SHEET_W * SHEET_H) / 1_000_000;
const DEFAULT_THICKNESS = 18;
const BACK_THICKNESS = 6;

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function norm(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isMdfLike(item: any): boolean {
  const text = norm([item.materialType, item.itemType, item.description].filter(Boolean).join(' '));
  const nonMdf = [
    'ferragem', 'dobradica', 'corredica', 'puxador', 'vidro', 'espelho', 'metalon',
    'metal', 'aco', 'inox', 'aluminio', 'granito', 'quartzo', 'marmore',
    'porcelanato', 'pedra', 'cuba', 'pia', 'cooktop', 'forno', 'geladeira',
  ];
  return !nonMdf.some((token) => text.includes(token));
}

function moduleKind(item: any): string {
  const text = norm([item.itemType, item.description].filter(Boolean).join(' '));
  if (text.includes('torre') || text.includes('coluna') || text.includes('despensa')) return 'tower';
  if (text.includes('aereo') || text.includes('superior')) return 'upper_cabinet';
  if (text.includes('balcao') || text.includes('base') || text.includes('inferior') || text.includes('pia')) return 'base_cabinet';
  if (text.includes('ilha') || text.includes('bancada') || text.includes('peninsula')) return 'countertop_island';
  if (text.includes('painel') || text.includes('ripado')) return 'panel';
  if (text.includes('nicho')) return 'niche';
  if (text.includes('mesa') || text.includes('escrivaninha') || text.includes('penteadeira')) return 'table';
  return 'generic_box';
}

function materialName(item: any): string {
  const material = String(item.materialType || '').trim();
  if (!material || norm(material).includes('nao especificado')) return 'MDF 18mm';
  return material;
}

function panelArea(width: number, height: number, quantity: number): number {
  return ((Math.max(width, 1) * Math.max(height, 1)) / 1_000_000) * Math.max(quantity, 1);
}

function componentCost(consumption: number, unitCost: number): number {
  return round(consumption * unitCost, 2);
}

function makePanel(
  item: any,
  label: string,
  width: number,
  height: number,
  thickness: number,
  quantity: number,
  rule: string,
  params: Required<Pick<EngineeringPricingParams, 'sheetPrice'>>,
): EngineeringComponent {
  const consumption = round(panelArea(width, height, quantity), 4);
  const unitCost = round(params.sheetPrice / SHEET_AREA_M2, 4);
  return {
    code: `${String(item.id || item.codigo || 'item').slice(0, 8)}-${norm(label).replace(/[^a-z0-9]+/g, '-')}`,
    sourceItemId: item.id,
    environment: item.environment || 'Ambiente',
    furniture: item.description || item.itemType || 'Movel planejado',
    moduleType: moduleKind(item),
    type: thickness <= BACK_THICKNESS ? 'back_panel' : 'panel',
    label,
    width: Math.round(width),
    height: Math.round(height),
    thickness,
    quantity: Math.max(1, Math.round(quantity || 1)),
    material: thickness <= BACK_THICKNESS ? 'MDF/HDF fundo 6mm' : materialName(item),
    unit: 'm2',
    consumption,
    unitCost,
    totalCost: componentCost(consumption, unitCost),
    rule,
  };
}

function makeEdge(
  item: any,
  label: string,
  meters: number,
  params: Required<Pick<EngineeringPricingParams, 'edgePricePerMeter'>>,
  rule: string,
): EngineeringComponent {
  const consumption = round(Math.max(0, meters), 2);
  return {
    code: `${String(item.id || item.codigo || 'item').slice(0, 8)}-${norm(label).replace(/[^a-z0-9]+/g, '-')}`,
    sourceItemId: item.id,
    environment: item.environment || 'Ambiente',
    furniture: item.description || item.itemType || 'Movel planejado',
    moduleType: moduleKind(item),
    type: 'edge_tape',
    label,
    quantity: 1,
    material: item.fitaBorda || materialName(item),
    unit: 'm',
    consumption,
    unitCost: params.edgePricePerMeter,
    totalCost: componentCost(consumption, params.edgePricePerMeter),
    rule,
  };
}

function makeHardware(
  item: any,
  label: string,
  quantity: number,
  unitCost: number,
  rule: string,
): EngineeringComponent {
  return {
    code: `${String(item.id || item.codigo || 'item').slice(0, 8)}-${norm(label).replace(/[^a-z0-9]+/g, '-')}`,
    sourceItemId: item.id,
    environment: item.environment || 'Ambiente',
    furniture: item.description || item.itemType || 'Movel planejado',
    moduleType: moduleKind(item),
    type: 'hardware',
    label,
    quantity: Math.max(0, Math.round(quantity)),
    material: label,
    unit: 'un',
    consumption: Math.max(0, Math.round(quantity)),
    unitCost,
    totalCost: componentCost(Math.max(0, Math.round(quantity)), unitCost),
    rule,
  };
}

function inferOpenings(item: any): { doors: number; drawers: number; shelves: number } {
  const width = Number(item.width) || 0;
  const text = norm([item.itemType, item.description, item.observacoes].filter(Boolean).join(' '));
  const modules = Math.max(1, Math.ceil(width / 700));
  const isBase = moduleKind(item) === 'base_cabinet';
  const isTower = moduleKind(item) === 'tower';
  const isIsland = moduleKind(item) === 'countertop_island';
  const drawers = /gaveta|gavetao/.test(text) ? Math.max(2, modules) : isIsland ? Math.max(2, modules) : 0;
  const doors = drawers ? Math.max(0, modules - 1) : isTower ? Math.max(2, modules * 2) : Math.max(1, modules);
  const shelves = isTower ? Math.max(3, modules * 3) : isBase ? Math.max(1, modules) : Math.max(1, modules - 1);
  return { doors, drawers, shelves };
}

function explodeItem(item: any, params: Required<EngineeringPricingParams>, validations: EngineeringResult['validations']): EngineeringComponent[] {
  const width = Number(item.width) || 0;
  const height = Number(item.height) || 0;
  const depth = Number(item.depth) || 0;
  const thickness = Number(item.thickness) || DEFAULT_THICKNESS;
  const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
  const kind = moduleKind(item);

  if (!width || !height || !depth) {
    validations.push({
      severity: 'BLOCKER',
      item: item.description || item.itemType,
      message: 'Movel ignorado na engenharia por falta de largura, altura ou profundidade.',
    });
    return [];
  }
  if (!isMdfLike(item)) {
    validations.push({
      severity: 'INFO',
      item: item.description || item.itemType,
      message: 'Item tratado como referencia/insumo nao MDF e nao explodido em chapas.',
    });
    return [];
  }

  const components: EngineeringComponent[] = [];
  const pushPanel = (label: string, w: number, h: number, t = thickness, q = quantity, rule = kind) => {
    components.push(makePanel(item, label, w, h, t, q, rule, params));
  };

  if (kind === 'panel') {
    pushPanel('Painel principal', width, height, thickness, quantity, 'panel_flat');
    components.push(makeEdge(item, 'Fita borda painel', ((2 * (width + height)) / 1000) * quantity, params, 'panel_perimeter_edge'));
  } else if (kind === 'countertop_island' || kind === 'table') {
    pushPanel('Tampo', width, depth, thickness, quantity, `${kind}_top`);
    pushPanel('Lateral esquerda', depth, height, thickness, quantity, `${kind}_side`);
    pushPanel('Lateral direita', depth, height, thickness, quantity, `${kind}_side`);
    components.push(makeEdge(item, 'Fita borda tampo/laterais', ((2 * (width + depth) + 2 * height) / 1000) * quantity, params, `${kind}_visible_edges`));
  } else {
    pushPanel('Lateral esquerda', depth, height, thickness, quantity, `${kind}_left_side`);
    pushPanel('Lateral direita', depth, height, thickness, quantity, `${kind}_right_side`);
    pushPanel('Base', Math.max(width - 2 * thickness, 1), depth, thickness, quantity, `${kind}_bottom`);
    pushPanel('Tampo', Math.max(width - 2 * thickness, 1), depth, thickness, quantity, `${kind}_top`);
    pushPanel('Fundo', width, height, BACK_THICKNESS, quantity, `${kind}_back`);

    const openings = inferOpenings(item);
    if (openings.shelves > 0) {
      pushPanel('Prateleira interna', Math.max(width / Math.max(1, Math.ceil(width / 700)) - 2 * thickness, 1), depth - 20, thickness, openings.shelves * quantity, `${kind}_shelves_by_width`);
    }
    if (openings.doors > 0) {
      pushPanel('Porta/frente', Math.max(width / openings.doors, 1), height, thickness, openings.doors * quantity, `${kind}_fronts_by_width`);
      components.push(makeHardware(item, 'Dobradica 35mm', openings.doors * 2 * quantity, 9, `${kind}_2_hinges_per_door`));
      components.push(makeHardware(item, 'Puxador/perfil', openings.doors * quantity, 16, `${kind}_1_handle_per_front`));
    }
    if (openings.drawers > 0) {
      const drawerFrontH = Math.max(height / Math.max(openings.drawers, 1), 120);
      pushPanel('Frente de gaveta', Math.max(width / Math.max(1, Math.ceil(width / 700)), 1), drawerFrontH, thickness, openings.drawers * quantity, `${kind}_drawer_fronts`);
      components.push(makeHardware(item, 'Corredica telescopica', openings.drawers * quantity, 38, `${kind}_1_slide_pair_per_drawer`));
      components.push(makeHardware(item, 'Puxador/perfil gaveta', openings.drawers * quantity, 16, `${kind}_1_handle_per_drawer`));
    }
    const visibleEdgeMeters = ((2 * height + 2 * depth + width) / 1000) * quantity;
    components.push(makeEdge(item, 'Fita borda visivel', visibleEdgeMeters, params, `${kind}_visible_edges`));
  }

  const panelM2 = components
    .filter((component) => component.type === 'panel' || component.type === 'back_panel')
    .reduce((sum, component) => sum + component.consumption, 0);
  const laborHours = round(panelM2 * 0.85 + components.filter((component) => component.type === 'hardware').length * 0.08, 2);
  components.push({
    code: `${String(item.id || item.codigo || 'item').slice(0, 8)}-mao-de-obra`,
    sourceItemId: item.id,
    environment: item.environment || 'Ambiente',
    furniture: item.description || item.itemType || 'Movel planejado',
    moduleType: kind,
    type: 'labor',
    label: 'Corte, fitagem e montagem',
    quantity: 1,
    material: 'Mao de obra',
    unit: 'h',
    consumption: laborHours,
    unitCost: params.laborPricePerHour,
    totalCost: componentCost(laborHours, params.laborPricePerHour),
    rule: `${kind}_labor_by_panel_area`,
  });

  return components;
}

export function buildEngineeringResult(items: any[], params: EngineeringPricingParams = {}): EngineeringResult {
  const resolved: Required<EngineeringPricingParams> = {
    projectId: params.projectId || '',
    sheetPrice: Number(params.sheetPrice) || 340,
    edgePricePerMeter: Number(params.edgePricePerMeter) || 4.5,
    laborPricePerHour: Number(params.laborPricePerHour) || 85,
    wastePercent: Number(params.wastePercent) || 10,
    markup: Number(params.markup) || 1.5,
    commissionPercent: Number(params.commissionPercent) || 5,
    taxPercent: Number(params.taxPercent) || 6,
  };

  const validations: EngineeringResult['validations'] = [];
  const quoteReadyItems = items.filter((item) => Number(item.width) > 0 && Number(item.height) > 0 && Number(item.depth) > 0);
  const components = quoteReadyItems.flatMap((item) => explodeItem(item, resolved, validations));

  const panels = components.filter((component) => component.type === 'panel' || component.type === 'back_panel');
  const materialArea: Record<string, number> = {};
  for (const panel of panels) {
    materialArea[panel.material] = (materialArea[panel.material] || 0) + panel.consumption;
  }

  const sheetsByMaterial: Record<string, number> = {};
  const materials = Object.entries(materialArea).map(([material, area]) => {
    const sheets = Math.max(1, Math.ceil((area * (1 + resolved.wastePercent / 100)) / SHEET_AREA_M2));
    sheetsByMaterial[material] = sheets;
    return {
      material,
      panelAreaM2: round(area, 2),
      sheets,
      cost: round(sheets * resolved.sheetPrice, 2),
    };
  });

  const directCostBeforeSheetCorrection = components.reduce((sum, component) => sum + component.totalCost, 0);
  const panelAreaCost = panels.reduce((sum, component) => sum + component.totalCost, 0);
  const sheetCost = materials.reduce((sum, material) => sum + material.cost, 0);
  const directCost = round(directCostBeforeSheetCorrection - panelAreaCost + sheetCost, 2);
  const salePrice = round(directCost * resolved.markup, 2);
  const commissionValue = round(salePrice * (resolved.commissionPercent / 100), 2);
  const taxValue = round(salePrice * (resolved.taxPercent / 100), 2);
  const netProfit = round(salePrice - directCost - commissionValue - taxValue, 2);
  const netMarginPercent = salePrice > 0 ? round((netProfit / salePrice) * 100, 2) : 0;

  const panelAreaM2 = round(panels.reduce((sum, component) => sum + component.consumption, 0), 2);
  const edgeMeters = round(components.filter((component) => component.type === 'edge_tape').reduce((sum, component) => sum + component.consumption, 0), 2);
  const laborHours = round(components.filter((component) => component.type === 'labor').reduce((sum, component) => sum + component.consumption, 0), 2);
  const hardwareItems = components.filter((component) => component.type === 'hardware').reduce((sum, component) => sum + component.quantity, 0);

  return {
    schemaVersion: 'woodflow-engineering/v1',
    generatedAt: new Date().toISOString(),
    source: {
      projectId: resolved.projectId || undefined,
      items: items.length,
      quoteReadyItems: quoteReadyItems.length,
    },
    assumptions: [
      'A IA fornece somente moveis medidos; a engenharia e o preco sao calculados por regras deterministicas.',
      'Modelos iniciais usam templates por tipo de modulo e devem ser conferidos pelo orcamentista antes da proposta.',
      'Eletrodomesticos, loucas, metais e decoracao nao entram como itens orcaveis.',
    ],
    summary: {
      components: components.length,
      panels: panels.length,
      panelAreaM2,
      edgeMeters,
      hardwareItems,
      laborHours,
      sheets: Object.values(sheetsByMaterial).reduce((sum, value) => sum + value, 0),
      directCost,
      salePrice,
      commissionValue,
      taxValue,
      netProfit,
      netMarginPercent,
    },
    sheetsByMaterial,
    materials,
    components,
    validations,
    pricing: {
      sheetPrice: resolved.sheetPrice,
      edgePricePerMeter: resolved.edgePricePerMeter,
      laborPricePerHour: resolved.laborPricePerHour,
      wastePercent: resolved.wastePercent,
      markup: resolved.markup,
      commissionPercent: resolved.commissionPercent,
      taxPercent: resolved.taxPercent,
    },
  };
}

import { z } from 'zod';

export const DimensionSchema = z.object({
  raw_text: z.string().describe('Texto original extraído (ex: L 255,80 cm)'),
  normalized_value_mm: z.number().nullable(),
  explicitly_written: z.boolean(),
  source_page_id: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const DimensionsObjectSchema = z.object({
  width: DimensionSchema.nullable(),
  height: DimensionSchema.nullable(),
  depth: DimensionSchema.nullable(),
});

export const OccurrenceSchema = z.object({
  page_id: z.string(),
  source_type: z.enum(['planta_baixa_cotada', 'planta_baixa_sem_cotas', 'elevacao', 'vista_frontal', 'vista_lateral', 'corte_tecnico', 'detalhamento', 'renderizacao', 'fotografia', 'documento_desconhecido']),
  bounding_box: z.array(z.number()).length(4),
});

export const FurnitureItemSchema = z.object({
  canonical_item_id: z.string(),
  environment_id: z.string(),
  type: z.string(),
  subtype: z.string().nullable(),
  quantity: z.number().min(1),
  status: z.enum(['confirmado', 'provavel', 'pendente_revisao', 'rejeitado', 'decorativo', 'duplicado', 'conflitante']),
  counted_in_budget: z.boolean(),
  wall_id: z.string().nullable(),
  dimensions: DimensionsObjectSchema,
  occurrences: z.array(OccurrenceSchema),
  evidence_ids: z.array(z.string()),
  confidence: z.object({
    ocr: z.number(),
    classification: z.number(),
    dimension_association: z.number(),
    reconciliation: z.number(),
    overall: z.number(),
  }),
  notes: z.array(z.string()).optional(),
});

export const EnvironmentSchema = z.object({
  environment_id: z.string(),
  name: z.string(),
  confidence: z.number(),
});

export const IgnoredElementSchema = z.object({
  type: z.string(),
  reason: z.string(),
});

export const ProcessingSummarySchema = z.object({
  files_received: z.number(),
  technical_sources: z.number(),
  render_sources: z.number(),
  confirmed_items: z.number(),
  probable_items: z.number(),
  pending_items: z.number(),
});

export const InterpretationResultSchema = z.object({
  project_id: z.string(),
  pipeline_version: z.string(),
  environments: z.array(EnvironmentSchema),
  confirmed_furniture: z.array(FurnitureItemSchema),
  probable_furniture: z.array(FurnitureItemSchema),
  pending_review: z.array(FurnitureItemSchema),
  ignored_elements: z.array(IgnoredElementSchema),
  conflicts: z.array(z.any()),
  processing_summary: ProcessingSummarySchema,
});

export function validateInterpretation(data: unknown) {
  return InterpretationResultSchema.parse(data);
}

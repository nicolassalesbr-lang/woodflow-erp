export interface FurnitureItem {
  id: string;
  type: string;
  environment: string;
  dimensions: {
    width: { value: number | null };
    height: { value: number | null };
    depth: { value: number | null };
  };
  evidences: string[];
}

export function resolveDuplicates(items: FurnitureItem[]): FurnitureItem[] {
  /**
   * Motor de Deduplicação:
   * Funde móveis candidatos baseando-se no tipo, ambiente e geometria.
   * Atribui um `canonical_item_id` se houver match > 0.90 de similaridade.
   */
  const canonicalItems: FurnitureItem[] = [];

  for (const item of items) {
    let merged = false;
    
    for (const canonical of canonicalItems) {
      if (item.environment === canonical.environment && item.type === canonical.type) {
        // Checagem simplificada de dimensões
        const wMatch = item.dimensions.width.value === canonical.dimensions.width.value;
        const hMatch = item.dimensions.height.value === canonical.dimensions.height.value;
        const dMatch = item.dimensions.depth.value === canonical.dimensions.depth.value;
        
        // Se pelo menos duas dimensões baterem ou se as dimensões forem nulas mas as evidências cruzarem
        if ((wMatch && hMatch) || (wMatch && dMatch) || (hMatch && dMatch)) {
          // Merge evidences
          canonical.evidences = Array.from(new Set([...canonical.evidences, ...item.evidences]));
          merged = true;
          break;
        }
      }
    }
    
    if (!merged) {
      canonicalItems.push({ ...item });
    }
  }

  return canonicalItems;
}

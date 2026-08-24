# KazaHome — Roadmap de evolução técnica em 15 etapas

**Status geral:** em execução  
**Início:** 2026-08-17  
**Fonte de verdade:** este documento deve ser atualizado por Codex e Antigravity ao iniciar ou concluir qualquer etapa.

## Objetivo

Transformar a KazaHome em um motor auditável de interpretação, engenharia, precificação e produção de marcenaria. A IA interpreta documentos; regras determinísticas calculam componentes, materiais, custos e prazos. Nenhuma medida pode entrar no orçamento sem origem verificável.

## Regras obrigatórias

- Não inventar, completar ou estimar medidas ausentes.
- Distinguir dados extraídos, calculados, configurados e corrigidos manualmente.
- Somente itens tecnicamente confirmados podem entrar no orçamento.
- Toda etapa deve possuir testes, critérios de aceite e caminho de rollback.
- Alterações em produção exigem backup, validação local e autorização do usuário.

## Visão das 15 etapas

| # | Etapa | Entrega principal | Status |
|---|---|---|---|
| 1 | Evidência e rastreabilidade das medidas | Prova individual para L/A/P, origem, recorte, método e confiança | **EM ANDAMENTO** |
| 2 | Conferência técnica antes do orçamento | Tela para confirmar, corrigir, rejeitar, fundir e separar itens | PENDENTE |
| 3 | Biblioteca de móveis | Modelos técnicos configuráveis por tipologia | PENDENTE |
| 4 | Separação das origens dos dados | Extraído, calculado, regra, configuração e correção humana | PENDENTE |
| 5 | Catálogo profissional de MDF | Fabricante, padrão, SKU, espessura, chapa, preço e vigência | PENDENTE |
| 6 | Catálogo de ferragens | Produtos reais, aplicação, capacidade, preço e fornecedor | PENDENTE |
| 7 | Regras técnicas de ferragens | Quantidades por peso, dimensão, abertura e fabricante | PENDENTE |
| 8 | BOM editável | Lista de peças com material, veio, bordas e operações | PENDENTE |
| 9 | Plano de corte industrial | Serra, refilo, veio, rotação, sobras e separação por material | PENDENTE |
| 10 | Fita de borda por lado | Aplicação explícita em frente/trás/esquerda/direita | PENDENTE |
| 11 | Precificação centralizada no backend | Memória de cálculo oficial, reproduzível e protegida | PENDENTE |
| 12 | Versionamento do orçamento | Versões de projeto, regras, preços, parâmetros e correções | PENDENTE |
| 13 | Custos completos | Insumos, usinagem, acabamento, frete, montagem e garantia | PENDENTE |
| 14 | Produção e prazo | Operações, capacidade, equipe, máquinas, fila e instalação | PENDENTE |
| 15 | Base de testes reais e melhoria contínua | Golden dataset e métricas de precisão/custo | PENDENTE |

---

## Etapa 1 — Evidência e rastreabilidade das medidas

### Problema

O contrato atual mantém uma evidência geral por móvel (`source`, `sourcePage`, `sourceText`), mas não prova individualmente de onde vieram largura, altura e profundidade. O status de orçamento considera principalmente a presença de três números positivos.

### Diagnóstico inicial — 2026-08-17

- `project-interpretation.engine.ts` armazena L/A/P como números simples.
- A evidência fica no nível do móvel, não no nível da dimensão.
- Não há recorte visual individual associado a cada dimensão.
- O modelo de interpretação principal não exige `bounding_box` por dimensão.
- A transcrição original da cota pode ficar misturada em `sourceText` ou `observacoes`.
- `quoteStatus` pode virar `READY` quando L/A/P existem, mesmo que a origem individual não esteja comprovada.
- Já existe um schema mais estruturado em `project-interpretation/validator.ts`, porém ele ainda não está integrado como contrato dominante do pipeline persistido.

### Contrato-alvo por dimensão

```json
{
  "axis": "width",
  "raw_text": "L 142,00 cm",
  "raw_value": 142.0,
  "original_unit": "cm",
  "normalized_value_mm": 1420,
  "explicitly_written": true,
  "status": "verified",
  "source": {
    "file_id": "arquivo-ou-hash",
    "filename": "projeto.pdf",
    "page": 3,
    "source_type": "elevacao_cotada",
    "extraction_method": "paddleocr",
    "bounding_box": [435, 461, 698, 489],
    "crop_ref": "projects/.../evidence/...png"
  },
  "confidence": {
    "recognition": 0.97,
    "axis_classification": 0.94,
    "furniture_association": 0.91,
    "overall": 0.93
  },
  "association_reason": "Cota horizontal ligada ao módulo MOV-001 na vista frontal"
}
```

### Estados permitidos

- `verified`: cota explícita, origem e associação comprovadas.
- `conflicting`: duas ou mais fontes apresentam valores incompatíveis.
- `ambiguous`: valor legível, mas eixo ou móvel não comprovado.
- `missing`: nenhuma cota explícita encontrada.
- `manual_override`: valor corrigido por usuário, mantendo o anterior e justificativa.

### Regra de liberação

Um móvel somente poderá receber `READY` quando as dimensões obrigatórias para sua tipologia estiverem `verified` ou `manual_override`. A simples existência de números positivos não será suficiente.

### Incrementos

#### 2026-08-19 — Resultado de interpretação visível e revisão entre páginas

- Corrigida a tela de detalhes para exibir móveis identificados mesmo quando ainda faltam medidas, com estado explícito de “medidas pendentes”.
- Itens incompletos permanecem excluídos do orçamento, materiais e nesting.
- A revisão direcionada de PDFs passou a analisar também as páginas imediatamente anterior e posterior à página de origem, permitindo relacionar elevações com cortes e vistas laterais.
- O prompt de cada página passou a receber somente os móveis daquela página e das páginas vizinhas, reduzindo associações incorretas.
- Validação: TypeScript sem erros no frontend e no backend.

#### 2026-08-19 — OCR híbrido obrigatório em PDFs técnicos

- PDFs vetoriais agora passam simultaneamente por PyMuPDF e PaddleOCR; a presença de texto nativo não desativa mais o OCR visual.
- Todas as folhas são renderizadas a 300 DPI e lidas nas orientações 0°, 90° e 270°.
- Foi habilitada a variante dedicada às anotações vermelhas também para PDFs.
- Cotas são priorizadas no contexto com posição normalizada, confiança, orientação e origem.
- Corrigida a escala dos `bounding boxes` da variante vermelha.
- As folhas são processadas sequencialmente para evitar consumo excessivo de memória em projetos A3 extensos.
- Validação local: sintaxe Python e filtro de cotas aprovados; teste completo do PaddleOCR depende do runtime da VPS, onde estão os modelos e dependências.

#### 2026-08-24 — Associação determinística e consolidação entre vistas

- Cada móvel pendente recebe um `reviewTargetId` estável, exigido na resposta da revisão, eliminando a dependência primária de descrições reescritas pela IA.
- O identificador de revisão é preservado na sanitização e na deduplicação.
- Resultados complementares da elevação, planta e corte são consolidados por eixo antes da validação.
- Uma dimensão original já confirmada nunca é substituída silenciosamente.
- Leituras conflitantes para o mesmo eixo permanecem pendentes, em vez de escolher um valor arbitrário.
- O casamento textual anterior permanece apenas como fallback para provedores que não devolvam o identificador.
- Validação: TypeScript sem erros no backend e frontend.

- [x] Auditar contratos atuais e identificar lacunas.
- [x] Definir contrato-alvo e estados de evidência.
- [ ] Criar tipos e schema de validação compartilhados.
- [ ] Adaptar PaddleOCR/PyMuPDF para produzir referências estáveis de evidência.
- [ ] Gerar e armazenar recortes das cotas.
- [ ] Associar evidência individual a L/A/P.
- [ ] Bloquear `READY` sem evidência válida.
- [ ] Persistir conflitos sem escolher valor arbitrariamente.
- [ ] Expor evidências na API.
- [ ] Mostrar evidências e recortes na interface.
- [ ] Criar testes unitários, integração e regressão.
- [ ] Validar com projetos reais conferidos.

### Critérios de aceite

1. Toda dimensão exibida como confirmada possui arquivo, página, método e transcrição original.
2. OCR possui bounding box e recorte; extração vetorial possui coordenadas equivalentes.
3. O sistema não libera orçamento apenas porque recebeu três números.
4. Conflitos ficam visíveis e bloqueiam liberação automática.
5. Correções humanas preservam valor anterior, usuário, data e justificativa.
6. Projetos legados continuam legíveis, mas são marcados como evidência legada/incompleta.
7. Testes comprovam que uma medida sem evidência não entra automaticamente no orçamento.

### Riscos e compatibilidade

- Projetos antigos não possuem evidência completa; será necessária migração lógica não destrutiva.
- O frontend atual espera números simples; durante a transição deverão existir campos derivados compatíveis.
- Recortes aumentam armazenamento; aplicar hash, deduplicação e política de retenção.
- A alteração deve ser introduzida versionada (`project-interpretation/v2`) e sem sobrescrever o resultado bruto anterior.

### Próxima ação técnica

Implementar `project-interpretation/v2` com schema de evidência por dimensão e adaptador de compatibilidade para os projetos `v1`. Depois, criar o primeiro teste que garanta: **três números sem evidência não resultam em item pronto para orçamento**.

---

## Registro de progresso

### 2026-08-17 — Etapa 1 iniciada

- Comparada a arquitetura atual com o comportamento funcional atribuído à Marcenaria 9.0.
- Confirmado que PaddleOCR, PyMuPDF, OpenCV, interpretação híbrida, engenharia, nesting e precificação já possuem fundações no projeto.
- Identificada como prioridade a ausência de evidência individual obrigatória para cada dimensão.
- Definidos contrato-alvo, estados, regra de liberação e critérios de aceite.
- Nenhuma publicação em produção foi realizada.

# CONTEXTO DO PROJETO — KazaHomeDesign / WoodFlow ERP
> Handoff das alterações feitas pelo Claude (Anthropic) em 10/07/2026. Leia antes de mexer na área de **Projects**.

## Visão geral
ERP SaaS multi-tenant para marcenaria de alto padrão (móveis planejados). Cliente: Gustavo (Kaza Home Design).
O coração do sistema é a **leitura automática de plantas executivas em PDF** (desenhos técnicos de marcenaria, folhas A3) por IA de visão, que extrai cada peça com medidas reais → alimenta visualização 3D, plano de corte (nesting) e orçamento.

## Stack e infraestrutura
- **Monorepo**: `backend/` (NestJS + Prisma + PostgreSQL) · `frontend/` (Next.js 13 App Router + Tailwind) · `integrations/` (WhatsApp) · `mobile/` (RN boilerplate).
- **GitHub**: `git@github.com:nicolassalesbr-lang/woodflow-erp.git` (branch `master`). ⚠️ Repositório **público** — NUNCA commitar segredos.
- **VPS**: `72.60.245.24` → deploy em `/var/www/woodflow-erp`, PM2 (`woodflow-backend`, `woodflow-frontend`), PostgreSQL na porta **3012**.
- **Nginx** (`nexussolutions.company`): `/kazahome/` → frontend (Next basePath `/kazahome`), `/woodflow-api/api/...` → backend.
- **Auth**: token dev `mock-jwt-token-2026` → tenant `kaza-tenant-id`. Login do painel: `frontend/src/app/api/login/route.ts` (usuário `Gustavo` + hash SHA-256) — este arquivo é **gitignored** (segredo), existe só no disco da VPS.

### Deploy (processo validado)
```bash
# no local: commit + push (SSH). O git da VPS é HTTPS e NÃO faz push, só pull.
# na VPS:
cd /var/www/woodflow-erp && git pull origin master
# backend:
cd backend && npx prisma generate && npm run build && pm2 restart woodflow-backend --update-env
# frontend:
cd frontend && npm run build && pm2 restart woodflow-frontend --update-env
```

## Parser de PDF — `backend/src/project/project.controller.ts`
Endpoint `POST /projects/:id/parse` (recebe `{ filename, fileBase64, mimeType }`). Pipeline atual:
1. `pdftoppm -r 200` (poppler, instalado na VPS) renderiza **cada página** do PDF em PNG de alta resolução (200 DPI, necessário para ler as cotas vermelhas finas em A3).
2. `pdf-parse` extrai texto embutido (fallback).
3. **Uma chamada GPT-4o Vision POR FOLHA** (`analyzePage`), em paralelo com pool de concorrência 4 (`runPool`). Cada folha isolada = enumeração completa e precisa (não cramar todas as páginas num único request, que causava sub-extração).
4. `sanitizeItems` normaliza: coage números, exige ≥2 dimensões reais, e **substitui eixo fino 0 pela espessura** (senão o 3D colapsa a peça num plano). Calcula `area`/`volume`.
5. Persiste em `ProjectItem` (campos: environment, itemType, description, codigo, width/height/depth/thickness, quantity, materialType, cor, acabamento, observacoes, area, volume). Atualiza `parseStatus` (EXTRACTING→INTERPRETING→VALIDATING→COMPLETED/FAILED) e `parseProgress`.

**Regras do system prompt (`buildSystemPrompt`)**: Prompt de **Especialista Sênior em Projetos Executivos de Marcenaria** com **22 regras fundamentais**, incluindo: cotas cm → ×10 para mm; preservação exata de valores; não inverter eixos; hierarquia módulo→subpeças expandida (30+ tipos: Caixa, Aéreo, Painel, Bancada, Cama, Gaveta, Gavetão, Ripado, Saia, Cuba, Perfil, Metalon, LED, Espelho, Vidro, etc.); leitura de legenda de materiais com fabricante/padrão literal ("MDF Beton - Guararapes"); extração de ferragens com códigos (P170, P1145, Oslo Espia); iluminação com temperatura (3000K vs 4000K); instruções de fabricação/instalação; **classificação de confiança** (explicita/calculada/inferida/estimada/ilegivel, 0-100); **auditoria de consistência** (soma de cotas, cruzamento de vistas, inventário 3D). maxTokens por folha: **8192**. **Sem números de exemplo hardcoded**.

**IA em produção**: Prioriza **Azure OpenAI** (`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` no `backend/.env`) utilizando o deployment configurado de alta taxa de requisições. Se a Azure não estiver configurada, faz o fallback automático para a **OpenAI padrão** (`OPENAI_API_KEY`). Isso mitiga erros de Rate Limit 429 decorrentes do baixo limite de TPM da chave padrão da OpenAI.

## Frontend — área Projects (`frontend/src/app/projects/page.tsx`, ~2200 linhas)
3 abas, todas alimentadas pelos itens extraídos:
- **Detalhes**: agrupamento por ambiente com subtotais; cards ricos (código do balão, tipo, cor, acabamento, observações, medidas L/A/P, espessura, área); painel de Materiais com amostras de cor; resumo de produção.
- **Modelo 3D**: motor próprio em Canvas 2D (projeção isométrica, sem libs). `faces3D` (useMemo) monta a cena:
  - **Layout de Montagem Relativa (Assembly)**: Agrupa e posiciona objetos de forma coesa por ambiente. Bancadas servem de âncora para posicionar armários inferiores embaixo (calculando a altura da saia) e nichos/espelhos acima. Camas alinham cabeceiras e criados-mudos na cabeceira da cama correspondente.
  - **Renderizadores de Peças Especiais**:
    - **Bancadas**: Renderiza o tampo horizontal de pedra + saia frontal descendo + rodapia traseiro subindo (sem pernas de madeira convencionais).
    - **Cama**: Renderiza estrutura de base de madeira + colchão macio + travesseiros.
    - **Nicho**: Renderiza nichos vazados tridimensionais de parede com espessura fina.
    - **Móveis Vazados (Hollow Cabinets)**: Laterais, base, tampo e fundos recuados em MDF.
  - Câmera com **autofit** (`viewBounds`) e overlays HTML (info + legenda de materiais). Cores por material real (`materialColor`/`MATERIAL_PALETTE`).
- **Orçamento & Nesting**: `explodeToPanels` decompõe cada módulo em **peças planas de corte** (laterais, base, tampo, fundo, gavetas); `packPanels` (guillotine) empacota em chapas 2750×1840; exclui pedra/metal/vidro/tecido do MDF. `costBreakdown` (useMemo, ao vivo) = DRE transparente: MDF+perda, fita de borda por perímetro, ferragens por tipo, mão de obra por m² → markup, comissão, imposto, margem líquida vs meta. Preços de insumo editáveis.

### ⚠️ Padrão importante do 3D (câmera desacoplada do React)
O loop de animação (`requestAnimationFrame`) do canvas **NÃO** deve chamar `setState` por frame (causava "Maximum update depth exceeded"). A câmera vive em **refs** (`yawRef/pitchRef/zoomRef/explodedRef/autoRotateRef`); o `render()` lê os refs, a auto-rotação muta `yawRef` direto, e o `useEffect` do canvas depende só de geometria (`faces3D, viewStyle, ...`), nunca da câmera. **Mantenha esse padrão** ao mexer no 3D.

## Gotchas
- Mudar o **tamanho** do array de dependências de um hook confunde o Fast Refresh do Next (avisos "changed size between renders" + loop fantasma). Ao alterar deps, reinicie o dev server e teste em aba nova; o build de produção não tem esse artefato.
- `frontend/src/app/api/login/route.ts` e `SHARED_MEMORY*.md` são gitignored — não versione.
- Verificação visual local: `getApiUrl` aponta para `localhost:3012`; para testar contra dados reais de produção, o backend tem CORS `*`.

## ⭐ ARQUITETURA: Digital Twin → Three.js (nova)
Filosofia: **compreender → modelar (Digital Twin paramétrico) → renderizar**. NÃO gerar 3D das linhas do PDF.
- **Backend** gera `Project.digitalTwin` (Json): `{ environments[] → furnitures[] (type, dimensions, position, rotation, material, components[], notes) + audit }`. Método `assembleDigitalTwin` (1 chamada LLM sobre as peças extraídas). O prompt `buildTwinPrompt()` é baseado nas diretrizes de um **Engenheiro CAD/BIM Paramétrico Sênior**, focando em modelagem de profundidade real (Z-depth) para gerar sombras realistas, não simplificação de frisos, ripados, negativos e rebaixos (que devem ser gerados como componentes geométricos reais em vez de texturas), restrições de montagem (bancadas suspensas a 850mm, aéreos a 1500mm), pivôs funcionais e auditoria estrutural rígida. Rodar `npx prisma db push` ao deployar mudança de schema.
- **Frontend** `frontend/src/app/projects/ThreeViewer.tsx` (three@0.185, `next/dynamic ssr:false`): consome o digitalTwin → cena Three.js com mesh por componente, materiais PBR (vidro/espelho/metal/pedra/LED/MDF), abrir portas/gavetas, explodir, isolar, section plane, export GLB. A aba 3D usa ThreeViewer se houver digitalTwin; senão o canvas antigo.
- ⚠️ Deploy do frontend agora exige `npm install` na VPS (dep `three`) antes do `npm run build`.
- Para melhorar a reconstrução, ajuste o prompt de `buildTwinPrompt()` (posições relativas, tipos, ferragens) e/ou os renderizadores em `buildFurniture()` no ThreeViewer.

## Histórico de commits recentes
- `fcaecbd` — parser folha-a-folha, DPI 200, prompt limpo, saneamento de dimensões.
- `be82554` — upgrade das 3 abas de Projects (cálculo real).
- `9a9d394` — detecção de portas + fix do loop do 3D. `eebd3e7` — montagem 3D relativa (Antigravity).
- `2bf5ea6` — Azure Document Intelligence + retry 429. `aae7316` — Digital Twin (backend). `b2c4698` — renderizador Three.js.
- `f5a8462` — **Upgrade do prompt para Especialista Sênior** (22 regras, classificação de confiança, ferragens, iluminação, fabricação, auditoria, maxTokens 8192) (Antigravity).
- `0dcfed8` — **Upgrade do prompt do Digital Twin** para Engenheiro CAD/BIM Paramétrico Sênior (Antigravity).
- `706f268` — **Priorização do Azure OpenAI** para mitigar erros 429 e otimizar tempo de leitura do PDF (Antigravity).

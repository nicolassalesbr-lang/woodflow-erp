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

**Regras do system prompt (`buildSystemPrompt`)**: cotas em **cm → ×10 para mm**; não inverter eixos (largura=horizontal, altura=vertical, profundidade=corte lateral); hierarquia módulo→subpeças; ler ambiente do título da folha; ler legenda de MATERIAIS. **Sem números de exemplo hardcoded** (evita o modelo ecoar o prompt).

**IA em produção**: usa **OpenAI padrão** (`OPENAI_API_KEY=sk-proj-...`, `OPENAI_MODEL` no `backend/.env`). As chaves da Azure existem no `.env` mas **ainda não são usadas** por este controller (ver prompt de melhoria Azure).

## Frontend — área Projects (`frontend/src/app/projects/page.tsx`, ~2200 linhas)
3 abas, todas alimentadas pelos itens extraídos:
- **Detalhes**: agrupamento por ambiente com subtotais; cards ricos (código do balão, tipo, cor, acabamento, observações, medidas L/A/P, espessura, área); painel de Materiais com amostras de cor; resumo de produção.
- **Modelo 3D**: motor próprio em Canvas 2D (projeção isométrica, sem libs). `faces3D` (useMemo) monta a cena: caixas ocas, prateleiras, gavetas, portas com dobradiça/correr/basculante, mesas, painéis, cabeceiras. Cores por material real (`materialColor`/`MATERIAL_PALETTE`). Câmera com **autofit** (`viewBounds`) e overlays HTML (info + legenda de materiais).
- **Orçamento & Nesting**: `explodeToPanels` decompõe cada módulo em **peças planas de corte** (laterais, base, tampo, fundo, gavetas); `packPanels` (guillotine) empacota em chapas 2750×1840; exclui pedra/metal/vidro/tecido do MDF. `costBreakdown` (useMemo, ao vivo) = DRE transparente: MDF+perda, fita de borda por perímetro, ferragens por tipo, mão de obra por m² → markup, comissão, imposto, margem líquida vs meta. Preços de insumo editáveis.

### ⚠️ Padrão importante do 3D (câmera desacoplada do React)
O loop de animação (`requestAnimationFrame`) do canvas **NÃO** deve chamar `setState` por frame (causava "Maximum update depth exceeded"). A câmera vive em **refs** (`yawRef/pitchRef/zoomRef/explodedRef/autoRotateRef`); o `render()` lê os refs, a auto-rotação muta `yawRef` direto, e o `useEffect` do canvas depende só de geometria (`faces3D, viewStyle, ...`), nunca da câmera. **Mantenha esse padrão** ao mexer no 3D.

## Gotchas
- Mudar o **tamanho** do array de dependências de um hook confunde o Fast Refresh do Next (avisos "changed size between renders" + loop fantasma). Ao alterar deps, reinicie o dev server e teste em aba nova; o build de produção não tem esse artefato.
- `frontend/src/app/api/login/route.ts` e `SHARED_MEMORY*.md` são gitignored — não versione.
- Verificação visual local: `getApiUrl` aponta para `localhost:3012`; para testar contra dados reais de produção, o backend tem CORS `*`.

## Histórico de commits recentes
- `fcaecbd` — parser folha-a-folha, DPI 200, prompt limpo, saneamento de dimensões.
- `e41cae1` — resgate de páginas do frontend que só existiam na VPS para o git; login route gitignored.
- `be82554` — upgrade completo das 3 abas de Projects (cálculo real).
- `9a9d394` — detecção de portas (expansão de qty, puxadores, correr/vidro) + fix do loop infinito do 3D.

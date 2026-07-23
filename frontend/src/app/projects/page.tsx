"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ArrowRight, 
  CheckCircle, 
  FileUp, 
  Layers, 
  Maximize2, 
  Plus, 
  Sparkles,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize,
  DollarSign,
  Package,
  Settings,
  Percent
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { getApiUrl } from '../../utils/api';

// Three.js (Digital Twin) — client-only
const ThreeViewer = dynamic(() => import('./ThreeViewer'), { ssr: false });

const statusLabel: Record<string, string> = {
  DRAFT: "Briefing",
  REVIEW: "Em revisao",
  BUDGET: "Orcamento",
  APPROVED: "Aprovado"
};

// 3D projection structures
interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface Face3D {
  vertices: Point3D[];
  color: string;
  type: string;
  normal: Point3D;
  center: Point3D;
  offset: Point3D;
  item: any;
}

// 2D Nesting structures
interface PackedRect {
  x: number;
  y: number;
  w: number;
  h: number;
  item: any;
}

interface Sheet {
  width: number;
  height: number;
  packed: PackedRect[];
  freeSpaces: { x: number; y: number; w: number; h: number }[];
  material?: string;
}

// ── Materiais → cor realista (3D texturizado + legenda) ───────────────────────
const MATERIAL_PALETTE: { match: string[]; color: string; label: string }[] = [
  { match: ["preto trama", "preto", "black", "grafite"], color: "#2b2622", label: "MDF Preto" },
  { match: ["beton", "concreto", "cimento", "cinza"], color: "#8f867a", label: "MDF Beton" },
  { match: ["truffel", "tabaco", "conhaque", "chocolate", "café", "cafe", "marrom"], color: "#5b4634", label: "MDF Truffel" },
  { match: ["freij", "carval", "nogueira", "cinamomo", "ripado", "madeira natural", "natural", "amêndoa", "amendoa"], color: "#8a5a34", label: "Madeira/Freijó" },
  { match: ["canela", "tamarindo", "mel", "avelã", "avela", "nature"], color: "#a06a3a", label: "MDF Canela" },
  { match: ["areia", "linho", "fendi", "cru", "off", "sahara", "camurça", "camurca"], color: "#c9b590", label: "MDF Areia" },
  { match: ["branco", "white", "neve", "gelo", "polar"], color: "#e7e1d6", label: "Branco" },
  { match: ["rosa", "sal", "nude", "blush"], color: "#c9a79b", label: "Rosé" },
  { match: ["espelho", "mirror"], color: "#aebfc6", label: "Espelho" },
  { match: ["vidro", "reflecta", "fum", "glass", "cristal"], color: "#5c6b72", label: "Vidro Fumê" },
  { match: ["couro", "leather"], color: "#6b4a2f", label: "Couro" },
];
function materialColor(name?: string): string {
  const n = (name || "").toLowerCase();
  for (const p of MATERIAL_PALETTE) if (p.match.some((m) => n.includes(m))) return p.color;
  return "#8c6c50";
}
function isGlassy(name?: string): boolean {
  const n = (name || "").toLowerCase();
  return ["espelho", "vidro", "reflecta", "fum", "mirror", "glass", "cristal"].some((m) => n.includes(m));
}
const HANDLE_COLOR = "#cfc8bb"; // puxador alumínio/perfil

// Classifica o tipo de abertura da porta a partir da descrição
function classifyDoor(desc: string) {
  const d = (desc || "").toLowerCase();
  return {
    sliding: /correr|desliza|deslizante|perfil\s*p?\s*1?70|s150/.test(d),
    basculante: /basculante|pist[aã]o|abertura para cima|aramada/.test(d),
    // sem puxador saliente: tip-on/toque, cava ou perfil embutido (J/tipo perfil)
    noHandle: /fecho e toque|toque|cava|push|tip.?on|puxador tipo perfil|perfil p\s?11?45/.test(d),
  };
}

const SUB_COMPONENT_TYPES = [
  "porta", "gaveta", "gavetão", "gavetao", "prateleira", "lateral", "divisória", 
  "divisoria", "fundo", "saia", "rodapé", "rodape", "led", "aramado", "cuba", 
  "revestimento", "corrediça", "puxador", "dobradiça", "rodateto"
];

function isMainFurnitureModule(item: any): boolean {
  const type = (item.itemType || "").toLowerCase();
  const desc = (item.description || item.name || "").toLowerCase();
  
  if (SUB_COMPONENT_TYPES.some(t => type === t || type.startsWith(t))) {
    return false;
  }
  if (SUB_COMPONENT_TYPES.some(t => desc.startsWith(t)) && !type.includes("caixa") && !type.includes("balcão") && !type.includes("aéreo") && !type.includes("guarda-roupa") && !type.includes("armário")) {
    return false;
  }
  return true;
}

// ── Decomposição de um móvel em peças planas de corte ─────────────────────────
interface Panel {
  w: number;
  h: number;
  thickness: number;
  material: string;
  label: string;
  parent: any;
}
const BACK_THICKNESS = 6; // fundos/costas em 6mm
function explodeToPanels(item: any): Panel[] {
  const W = Math.max(1, Number(item.width) || 0);
  const H = Math.max(1, Number(item.height) || 0);
  const D = Math.max(1, Number(item.depth) || 0);
  const t = Number(item.thickness) || 18;
  const mat = item.materialType || "MDF 18mm";
  const qty = Math.max(1, Number(item.quantity) || 1);
  const type = (item.itemType || "").toLowerCase();
  const desc = (item.description || "").toLowerCase();
  // Só entra no nesting o que é chapa de MDF/madeira. Pedra, metal, vidro,
  // tecido, couro e ferragens são insumos separados — não viram chapa.
  const NON_MDF = [
    "espelho", "vidro", "reflecta", "fum", "mirror", "glass", "cristal",
    "silestone", "granito", "quartzo", "mármore", "marmore", "porcelanato", "pedra",
    "metalon", "metal", "aço", "inox", "alumínio", "aluminio",
    "couro", "suede", "suedi", "tecido", "veludo", "led", "ferragem",
  ];
  const matTypeDesc = `${mat} ${type} ${desc}`.toLowerCase();
  if (NON_MDF.some((k) => matTypeDesc.includes(k))) return [];

  const mk = (w: number, h: number, thk: number, label: string): Panel => ({
    w: Math.max(w, 1),
    h: Math.max(h, 1),
    thickness: thk,
    material: mat,
    label,
    parent: item,
  });

  const base: Panel[] = [];
  const isDrawer = type.includes("gaveta");
  const isBox = ["caixa", "aéreo", "aereo", "estante", "armário", "armario", "gabinete", "balcão", "balcao", "roupeiro"].some(
    (k) => type.includes(k),
  );
  const isFurnitureLike = type.includes("mesa") || type.includes("bancada");

  if (isDrawer) {
    base.push(mk(W, H, t, "Frente gaveta"));
    base.push(mk(W - 2 * t, H, t, "Traseira gaveta"));
    base.push(mk(D, H, t, "Lateral gaveta"));
    base.push(mk(D, H, t, "Lateral gaveta"));
    base.push(mk(W - 2 * t, D, BACK_THICKNESS, "Fundo gaveta"));
  } else if (isBox) {
    base.push(mk(D, H, t, "Lateral"));
    base.push(mk(D, H, t, "Lateral"));
    base.push(mk(W - 2 * t, D, t, "Base"));
    base.push(mk(W - 2 * t, D, t, "Tampo"));
    base.push(mk(W, H, BACK_THICKNESS, "Fundo/costa"));
  } else if (isFurnitureLike) {
    base.push(mk(W, D, t, "Tampo"));
    base.push(mk(D, H, t, "Lateral/Pé"));
    base.push(mk(D, H, t, "Lateral/Pé"));
  } else {
    // Peça plana (porta, prateleira, painel, nicho, cabeceira, tampo, divisória…)
    const dims = [W, H, D].sort((a, b) => b - a);
    base.push(mk(dims[0], dims[1], t, item.itemType || "Painel"));
  }

  const out: Panel[] = [];
  for (let q = 0; q < qty; q++) out.push(...base.map((p) => ({ ...p })));
  return out;
}

// ── Guillotine/shelf packing de peças em chapas padrão ────────────────────────
const SHEET_W = 2750;
const SHEET_H = 1840;
const SAW_KERF = 5;
function packPanels(panels: Panel[]): Sheet[] {
  const rects = panels.map((p, i) => ({
    id: `${p.parent?.id || "p"}-${i}`,
    w: Math.max(p.w, p.h),
    h: Math.min(p.w, p.h),
    parent: p.parent,
    panel: p,
  }));
  rects.sort((a, b) => b.w * b.h - a.w * a.h);

  const sheets: Sheet[] = [];
  rects.forEach((rect) => {
    let placed = false;
    for (const sheet of sheets) {
      for (let i = 0; i < sheet.freeSpaces.length; i++) {
        const space = sheet.freeSpaces[i];
        const fitsNormal = rect.w <= space.w && rect.h <= space.h;
        const fitsRotated = rect.h <= space.w && rect.w <= space.h;
        if (fitsNormal || fitsRotated) {
          const w = fitsNormal ? rect.w : rect.h;
          const h = fitsNormal ? rect.h : rect.w;
          sheet.packed.push({ x: space.x, y: space.y, w, h, item: rect.panel });
          const remW = space.w - w;
          const remH = space.h - h;
          sheet.freeSpaces.splice(i, 1);
          if (remW > remH) {
            if (remW > SAW_KERF) sheet.freeSpaces.push({ x: space.x + w + SAW_KERF, y: space.y, w: remW - SAW_KERF, h: space.h });
            if (remH > SAW_KERF) sheet.freeSpaces.push({ x: space.x, y: space.y + h + SAW_KERF, w, h: remH - SAW_KERF });
          } else {
            if (remH > SAW_KERF) sheet.freeSpaces.push({ x: space.x, y: space.y + h + SAW_KERF, w: space.w, h: remH - SAW_KERF });
            if (remW > SAW_KERF) sheet.freeSpaces.push({ x: space.x + w + SAW_KERF, y: space.y, w: remW - SAW_KERF, h });
          }
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      // clampa peças maiores que a chapa (seccionadas na prática) para não estourar
      const pw = Math.min(rect.w, SHEET_W);
      const ph = Math.min(rect.h, SHEET_H);
      const newSheet: Sheet = {
        width: SHEET_W,
        height: SHEET_H,
        packed: [{ x: 0, y: 0, w: pw, h: ph, item: rect.panel }],
        freeSpaces: [],
        material: rect.panel.material,
      };
      const remW = SHEET_W - pw;
      const remH = SHEET_H - ph;
      if (remW > SAW_KERF) newSheet.freeSpaces.push({ x: pw + SAW_KERF, y: 0, w: remW - SAW_KERF, h: SHEET_H });
      if (remH > SAW_KERF) newSheet.freeSpaces.push({ x: 0, y: ph + SAW_KERF, w: pw, h: remH - SAW_KERF });
      sheets.push(newSheet);
    }
  });
  return sheets;
}

export default function Projects() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProj, setSelectedProj] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [parseStage, setParseStage] = useState("");
  const [newProjName, setNewProjName] = useState("");
  const [newProjDesc, setNewProjDesc] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  // Tabs navigation
  const [activeTab, setActiveTab] = useState<"details" | "model3d" | "budgeting">("details");

  // Budget calculations
  const [calculating, setCalculating] = useState(false);
  const [budget, setBudget] = useState<any>(null);
  const [markup, setMarkup] = useState(1.5);
  const [margin, setMargin] = useState(30.0);
  const [commission, setCommission] = useState(5.0);
  const [taxPercent, setTaxPercent] = useState(6.0);
  const [wastePercent, setWastePercent] = useState(10.0);

  // Preços de insumos (R$) — parametrizáveis para orçamento real
  const [sheetPrice, setSheetPrice] = useState(340);   // R$ por chapa 2,75 x 1,84m
  const [edgePrice, setEdgePrice] = useState(4.5);     // R$ por metro de fita de borda
  const [laborPrice, setLaborPrice] = useState(210);   // R$ por m² de painel (corte + montagem)

  // 3D visualizer rotation and zoom controls
  const [yaw, setYaw] = useState<number>(-0.6);
  const [pitch, setPitch] = useState<number>(-0.4);
  const [zoom, setZoom] = useState<number>(0.12);
  const [exploded, setExploded] = useState<number>(0); // 0 (assembled) to 1 (exploded)
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [hovered3DItem, setHovered3DItem] = useState<any>(null);
  const [selected3DItem, setSelected3DItem] = useState<any>(null);

  // 3D Canvas element reference
  const canvas3DRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Nesting visualizer sheet selector
  const [selectedSheetIndex, setSelectedSheetIndex] = useState<number>(0);
  const [selectedMaterial, setSelectedMaterial] = useState<string>("Todos");

  // 3D visualizer filters & styles
  const [selected3DEnv, setSelected3DEnv] = useState<string>("Todas");
  const [selected3DItemId, setSelected3DItemId] = useState<string>("Todos");
  const [viewStyle, setViewStyle] = useState<string>("textured");
  const [doorOpenAngle, setDoorOpenAngle] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'raw' | 'all'>('raw');

  const canvasNestingRef = useRef<HTMLCanvasElement>(null);

  const selectedItems = selectedProj?.items || [];
  
  const environments = useMemo(() => {
    const names = selectedItems.map((item: any) => item.environment);
    return Array.from(new Set(names)) as string[];
  }, [selectedItems]);

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/projects`, {
        headers: {
          Authorization: "Bearer mock-jwt-token-2026"
        }
      });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setProjects(list);
      setSelectedProj((current: any) => {
        const updated = list.find((p) => p.id === current?.id) || list[0] || null;
        return updated;
      });
    } catch (err) {
      console.error("Error fetching projects:", err);
      setProjects([]);
      setSelectedProj(null);
    }
  };

  const fetchBudget = async (projectId: string) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/budgets/project/${projectId}`, {
        headers: {
          Authorization: "Bearer mock-jwt-token-2026"
        }
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setBudget(data[0]);
        setMarkup(data[0].markup);
        setMargin(data[0].margin);
        setCommission(data[0].commission);
        setTaxPercent(data[0].taxPercent);
        setWastePercent(data[0].wastePercent);
      } else {
        setBudget(null);
      }
    } catch {
      setBudget(null);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (selectedProj?.id) {
      fetchBudget(selectedProj.id);
      setSelectedSheetIndex(0);
      setSelected3DItem(null);
    }
  }, [selectedProj]);

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newProjName.trim()) return;
    try {
      const res = await fetch(`${getApiUrl()}/api/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mock-jwt-token-2026"
        },
        body: JSON.stringify({
          name: newProjName,
          description: newProjDesc
        })
      });
      if (res.ok) {
        setNewProjName("");
        setNewProjDesc("");
        setShowAddForm(false);
        fetchProjects();
      }
    } catch (err) {
      console.error("Error creating project:", err);
      alert("Erro ao conectar com o servidor para criar o projeto.");
    }
  };

  const STAGE_LABEL: Record<string, string> = {
    EXTRACTING: "Lendo folhas...",
    QUEUE: "Na fila...",
    INTERPRETING: "Interpretando desenhos...",
    VALIDATING: "Montando modelo 3D...",
  };

  // Parse assíncrono: acompanha parseStatus/parseProgress até concluir (evita 504 do nginx).
  const pollParseStatus = async (projectId: string) => {
    const terminal = ["COMPLETED", "FAILED", "IDLE"];
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const res = await fetch(`${getApiUrl()}/api/projects`, {
          headers: { Authorization: "Bearer mock-jwt-token-2026" },
        });
        const list = await res.json();
        const proj = Array.isArray(list) ? list.find((p: any) => p.id === projectId) : null;
        if (!proj) continue;
        setProjects(list);
        setSelectedProj((cur: any) => (cur?.id === projectId ? proj : cur));
        setParseStage(STAGE_LABEL[proj.parseStatus] || "");
        if (terminal.includes(proj.parseStatus)) {
          if (proj.parseStatus === "FAILED") {
            alert("Falha no processamento: " + (proj.parseError || "erro desconhecido"));
          }
          return;
        }
      } catch {
        /* rede instável — continua tentando */
      }
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>, projectId: string) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setParseStage(`Preparando ${fileList.length} arquivo(s)...`);

    // Coleta todos os arquivos em base64 ANTES de enviar
    const files: { filename: string; fileBase64: string; mimeType: string }[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setParseStage(`Lendo arquivo ${i + 1} de ${fileList.length}...`);
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = (reader.result as string).split(",")[1];
          resolve(result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      files.push({ filename: file.name, fileBase64: base64, mimeType: file.type });
    }

    // Envia TODOS os arquivos em uma única chamada batch
    setParseStage(`Enviando ${files.length} documento(s) para análise...`);
    try {
      await fetch(`${getApiUrl()}/api/projects/${projectId}/parse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mock-jwt-token-2026"
        },
        body: JSON.stringify({ files })
      });
    } catch (err) {
      console.error("Erro no upload batch:", err);
    }

    setParseStage("Analisando documentos...");
    await pollParseStatus(projectId);
    setUploading(false);
    setParseStage("");
  };

  const calculateBudget = async () => {
    if (!selectedProj) return;
    setCalculating(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/budgets/calculate/${selectedProj.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mock-jwt-token-2026"
        },
        body: JSON.stringify({
          markup,
          margin,
          commission,
          taxPercent,
          wastePercent
        })
      });
      if (res.ok) {
        const data = await res.json();
        setBudget(data);
        fetchProjects(); // refresh projects to sync lead status
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCalculating(false);
    }
  };

  // 3D Model Generation
  const faces3D: Face3D[] = useMemo(() => {
    if (!selectedItems.length) return [];
    
    // Filter items based on selected environment and selected item ID
    let itemsToRender = selectedItems;
    if (selected3DEnv !== "Todas") {
      itemsToRender = itemsToRender.filter((i: any) => (i.environment || "Geral") === selected3DEnv);
    }
    if (selected3DItemId !== "Todos") {
      itemsToRender = itemsToRender.filter((i: any) => i.id === selected3DItemId);
    }

    if (!itemsToRender.length) return [];

    const list: Face3D[] = [];
    const envGroups: Record<string, any[]> = {};
    
    itemsToRender.forEach((item: any) => {
      const env = item.environment || "Geral";
      if (!envGroups[env]) envGroups[env] = [];
      envGroups[env].push(item);
    });

    let envOffset = 0;

    Object.entries(envGroups).forEach(([env, envItems]) => {
      // 1. Classify cabinets (base objects)
      const cabinets = envItems.filter((i) => {
        const itemType = (i.itemType || "").toLowerCase();
        const desc = (i.description || "").toLowerCase();
        return itemType.includes("caixa") || itemType.includes("aéreo") || itemType.includes("armário") || itemType.includes("roupeiro") || itemType.includes("módulo") ||
               desc.includes("armário") || desc.includes("gabinete") || desc.includes("balcão") || desc.includes("roupeiro") || desc.includes("guarda-roupa") || desc.includes("aéreo");
      });

      // 2. Classify other structural objects
      const mesas = envItems.filter((i) => {
        const itemType = (i.itemType || "").toLowerCase();
        const desc = (i.description || "").toLowerCase();
        return itemType.includes("mesa") || itemType.includes("bancada") || desc.includes("mesa") || desc.includes("bancada") || desc.includes("escrivaninha");
      });

      const cabeceiras = envItems.filter((i) => {
        const itemType = (i.itemType || "").toLowerCase();
        const desc = (i.description || "").toLowerCase();
        return itemType.includes("cabeceira") || desc.includes("cabeceira");
      });

      const paineis = envItems.filter((i) => {
        const itemType = (i.itemType || "").toLowerCase();
        const desc = (i.description || "").toLowerCase();
        return (itemType.includes("painel") || desc.includes("painel")) && (i.width || 0) > 200 && (i.height || 0) > 200;
      });

      const camas = envItems.filter((i) => {
        const itemType = (i.itemType || "").toLowerCase();
        const desc = (i.description || "").toLowerCase();
        return itemType.includes("cama") || desc.includes("cama");
      });

      const niches = envItems.filter((i) => {
        const itemType = (i.itemType || "").toLowerCase();
        const desc = (i.description || "").toLowerCase();
        return itemType.includes("nicho") || desc.includes("nicho");
      });

      // 3. Classify sub-parts
      const subParts = envItems.filter((i) => {
        const itemType = (i.itemType || "").toLowerCase();
        const desc = (i.description || "").toLowerCase();
        const isHardware = itemType.includes("ferragem") || desc.includes("ferragem");
        if (isHardware) return false;
        
        const isDoor = itemType.includes("porta") || desc.includes("porta") || desc.includes("frente");
        const isDrawer = itemType.includes("gaveta") || desc.includes("gaveta");
        const isShelf = itemType.includes("prateleira") || desc.includes("prateleira") || desc.includes("divisória");
        return isDoor || isDrawer || isShelf;
      });

      // 4. Collect other standalone items
      const otherBaseObjects = envItems.filter((i) => {
        const itemType = (i.itemType || "").toLowerCase();
        const desc = (i.description || "").toLowerCase();
        if (itemType.includes("ferragem") || desc.includes("ferragem")) return false;
        
        const isCab = cabinets.includes(i);
        const isMesa = mesas.includes(i);
        const isCabec = cabeceiras.includes(i);
        const isPainel = paineis.includes(i);
        const isCama = camas.includes(i);
        const isNiche = niches.includes(i);
        const isSub = subParts.includes(i);
        
        return !isCab && !isMesa && !isCabec && !isPainel && !isCama && !isNiche && !isSub && (i.width || 0) > 100 && (i.height || 0) > 100;
      });

      // 5. Build base objects array
      const baseObjects: any[] = [];
      cabinets.forEach((c) => baseObjects.push({ ...c, baseType: "cabinet", subParts: [] }));
      mesas.forEach((m) => baseObjects.push({ ...m, baseType: "table" }));
      cabeceiras.forEach((cb) => baseObjects.push({ ...cb, baseType: "headboard" }));
      paineis.forEach((p) => baseObjects.push({ ...p, baseType: "panel" }));
      camas.forEach((cm) => baseObjects.push({ ...cm, baseType: "bed" }));
      niches.forEach((n) => baseObjects.push({ ...n, baseType: "niche" }));
      otherBaseObjects.forEach((o) => baseObjects.push({ ...o, baseType: "other" }));

      // 6. Associate sub-parts to parent cabinets
      subParts.forEach((sub) => {
        let bestCab: any = null;
        let bestScore = -999999;
        const candidateCabs = baseObjects.filter((b) => b.baseType === "cabinet");

        candidateCabs.forEach((cab) => {
          const hDiff = Math.abs((cab.height || 0) - (sub.height || 0));
          
          let wDiff = Math.abs((cab.width || 0) - (sub.width || 0));
          wDiff = Math.min(wDiff, Math.abs(((cab.width || 0) / 2) - (sub.width || 0)));
          wDiff = Math.min(wDiff, Math.abs(((cab.width || 0) / 3) - (sub.width || 0)));
          wDiff = Math.min(wDiff, Math.abs(((cab.width || 0) / 4) - (sub.width || 0)));

          let score = 10000 - hDiff * 2 - wDiff;

          const cabDesc = (cab.description || "").toLowerCase();
          const subDesc = (sub.description || "").toLowerCase();
          
          if (cabDesc.includes("aéreo") && subDesc.includes("aéreo")) score += 2000;
          if (cabDesc.includes("inferior") && subDesc.includes("inferior")) score += 2000;
          if (cabDesc.includes("gaveta") && subDesc.includes("gaveta")) score += 1000;

          if (score > bestScore) {
            bestScore = score;
            bestCab = cab;
          }
        });

        if (bestCab && bestScore > 0) {
          bestCab.subParts.push(sub);
        } else {
          baseObjects.push({
            ...sub,
            baseType: "standalone_sub",
            subParts: []
          });
        }
      });

      // 7. Calculate relative positions for layout assembly
      const positions = new Map<any, { cx: number; cy: number; cz: number }>();
      const positioned = new Set<any>();
      let currentX = envOffset;

      const countertops = baseObjects.filter(
        (o) =>
          o.baseType === "table" &&
          ((o.itemType || "").toLowerCase().includes("bancada") ||
            (o.description || "").toLowerCase().includes("bancada"))
      );
      const beds = baseObjects.filter((o) => o.baseType === "bed");

      // 7.1 Assemble Countertop-based layouts
      countertops.forEach((top) => {
        const tw = top.width || 1200;
        const th = top.height || 200;
        const td = top.depth || 600;

        const tcx = currentX + tw / 2;
        const tcy = 850 - th / 2;
        const tcz = td / 2;

        positions.set(top, { cx: tcx, cy: tcy, cz: tcz });
        positioned.add(top);

        // Find associated under-counter items
        baseObjects.forEach((obj) => {
          if (positioned.has(obj)) return;
          const desc = (obj.description || "").toLowerCase();
          const type = (obj.itemType || "").toLowerCase();

          const isUnderCabinet =
            type.includes("caixa") ||
            type.includes("gaveta") ||
            desc.includes("inferior") ||
            desc.includes("gabinete") ||
            desc.includes("balcão");
          const isMetalon = desc.includes("metalon") || desc.includes("ferro") || desc.includes("suporte");

          if (isUnderCabinet || isMetalon) {
            const ow = obj.width || 800;
            const oh = obj.height || 700;
            const od = obj.depth || 500;

            let ocx = tcx;
            let ocy = 850 - th - oh / 2;
            if (isMetalon) {
              ocy = 850 / 2;
            }
            let ocz = od / 2;

            if (isUnderCabinet) {
              ocx = currentX + ow / 2;
            } else if (isMetalon) {
              ocx = currentX + tw - ow / 2;
            }

            positions.set(obj, { cx: ocx, cy: ocy, cz: ocz });
            positioned.add(obj);
          }
        });

        // Find associated above-counter items (niches, mirrors, aéreos)
        baseObjects.forEach((obj) => {
          if (positioned.has(obj)) return;
          const desc = (obj.description || "").toLowerCase();
          const type = (obj.itemType || "").toLowerCase();

          const isAboveItem =
            type.includes("nicho") ||
            type.includes("aéreo") ||
            desc.includes("espelho") ||
            desc.includes("nicho") ||
            desc.includes("aéreo") ||
            desc.includes("armário superior");

          if (isAboveItem) {
            const ow = obj.width || 800;
            const oh = obj.height || 600;
            const od = obj.depth || 300;

            const ocx = tcx;
            const ocy = 850 + 600 + oh / 2; // 600mm gap above countertop
            const ocz = od / 2;

            positions.set(obj, { cx: ocx, cy: ocy, cz: ocz });
            positioned.add(obj);
          }
        });

        currentX += tw + 400;
      });

      // 7.2 Assemble Bed-based layouts
      beds.forEach((bed) => {
        const bw = bed.width || 900;
        const bh = bed.height || 400;
        const bd = bed.depth || 2000;

        const bcx = currentX + bw / 2;
        const bcy = bh / 2;
        const bcz = bd / 2 + 100;

        positions.set(bed, { cx: bcx, cy: bcy, cz: bcz });
        positioned.add(bed);

        baseObjects.forEach((obj) => {
          if (positioned.has(obj)) return;
          const type = (obj.itemType || "").toLowerCase();
          const desc = (obj.description || "").toLowerCase();

          if (type.includes("cabeceira") || desc.includes("cabeceira")) {
            const ow = obj.width || bw;
            const oh = obj.height || 1000;
            const od = obj.depth || 50;

            const ocx = bcx;
            const ocy = oh / 2;
            const ocz = od / 2;

            positions.set(obj, { cx: ocx, cy: ocy, cz: ocz });
            positioned.add(obj);
          } else if (desc.includes("criado") || desc.includes("mesinha") || desc.includes("cabeceira")) {
            const ow = obj.width || 400;
            const oh = obj.height || 500;
            const od = obj.depth || 400;

            const ocx = currentX - ow / 2 - 50;
            const ocy = oh / 2;
            const ocz = od / 2;

            positions.set(obj, { cx: ocx, cy: ocy, cz: ocz });
            positioned.add(obj);
          }
        });

        currentX += bw + 500;
      });

      // 7.3 Position remaining items sequentially
      baseObjects.forEach((obj) => {
        if (positioned.has(obj)) return;

        const w = obj.width || 800;
        const h = obj.height || 800;
        const d = obj.depth || 600;

        const cx = currentX + w / 2;
        const cy = h / 2;
        const cz = d / 2;

        positions.set(obj, { cx, cy, cz });
        positioned.add(obj);

        currentX += w + 400;
      });

      envOffset = currentX + 1000;

      // 8. Render objects
      baseObjects.forEach((obj) => {
        const w = obj.width || 800;
        const h = obj.height || 800;
        const d = obj.depth || 600;

        const pos = positions.get(obj) || { cx: currentX + w / 2, cy: h / 2, cz: d / 2 };
        const cx = pos.cx;
        const cy = pos.cy;
        const cz = pos.cz;

        let baseColor = materialColor(obj.materialType); // cor do material real
        if (viewStyle === "solid") {
          baseColor = "#0d9488"; // teal
        } else if (viewStyle === "wireframe") {
          baseColor = "rgba(13, 148, 136, 0.18)";
        }

        if (obj.baseType === "cabinet") {
          // Render hollow box shell
          addHollowCabinet(list, cx, cy, cz, w, h, d, 18, baseColor, obj);

          // Render shelves, drawers, doors
          const cabinetShelves = obj.subParts.filter((p: any) => (p.itemType || "").toLowerCase().includes("prateleira") || (p.description || "").toLowerCase().includes("prateleira") || (p.description || "").toLowerCase().includes("divisória"));
          const cabinetDrawers = obj.subParts.filter((p: any) => (p.itemType || "").toLowerCase().includes("gaveta") || (p.description || "").toLowerCase().includes("gaveta"));
          const cabinetDoors = obj.subParts.filter((p: any) => {
            const t = (p.itemType || "").toLowerCase();
            const d = (p.description || "").toLowerCase();
            const isDrawer = t.includes("gaveta") || d.includes("gaveta");
            return !isDrawer && (t.includes("porta") || d.includes("porta"));
          });

          cabinetShelves.forEach((shelf: any, sIdx: number) => {
            const sw = shelf.width || (w - 36);
            const sd = shelf.depth || (d - 20);
            const sy = cy - h / 2 + (h / (cabinetShelves.length + 1)) * (sIdx + 1);

            let shelfColor = materialColor(shelf.materialType || obj.materialType);
            if (viewStyle === "solid") shelfColor = "#0f766e";
            else if (viewStyle === "wireframe") shelfColor = "rgba(15, 118, 110, 0.15)";

            addBoxFaces(list, cx, sy, cz, sw, 18, sd, shelfColor, "Prateleira", shelf);
          });

          // Expande a quantidade de gavetas em frentes empilhadas
          const drawerLeaves: any[] = [];
          cabinetDrawers.forEach((dr: any) => {
            const q = Math.max(1, Number(dr.quantity) || 1);
            for (let k = 0; k < q; k++) drawerLeaves.push(dr);
          });
          drawerLeaves.forEach((drawer: any, dIdx: number) => {
            const dw = drawer.width || (w - 10);
            const dh = drawer.height || (h / (drawerLeaves.length || 1));
            const dd = drawer.depth || (d - 40);
            const dyVal = cy - h / 2 + (dh / 2) + (dIdx * dh);

            const slideOffset = doorOpenAngle * 250;
            const drawerZ = cz + slideOffset;
            const frontZ = drawerZ + dd / 2;

            let drawerColor = materialColor(drawer.materialType || obj.materialType);
            if (viewStyle === "solid") drawerColor = "#6366f1";
            else if (viewStyle === "wireframe") drawerColor = "rgba(99, 102, 241, 0.15)";

            addBoxFaces(list, cx, dyVal, frontZ, dw - 4, dh - 4, 18, drawerColor, "Frente Gaveta", drawer);
            addBoxFaces(list, cx, dyVal - 10, drawerZ, dw - 40, dh - 40, dd, "#3e2723", "Gaveta Interna", drawer);
            // Puxador horizontal (exceto fecho e toque / perfil)
            if (viewStyle !== "wireframe" && !classifyDoor(drawer.description || "").noHandle) {
              addBoxFaces(list, cx, dyVal + dh / 2 - 24, frontZ + 18, Math.min(dw * 0.5, 500), 20, 14, HANDLE_COLOR, "Puxador", drawer);
            }
          });

          // Expande a quantidade de cada porta em folhas individuais
          const doorLeaves: any[] = [];
          cabinetDoors.forEach((door: any) => {
            const q = Math.max(1, Number(door.quantity) || 1);
            for (let k = 0; k < q; k++) doorLeaves.push(door);
          });

          if (doorLeaves.length) {
            const leafWidths = doorLeaves.map((dr) => dr.width || w / doorLeaves.length);
            const totalLeafW = leafWidths.reduce((a, b) => a + b, 0);
            // Centraliza o conjunto de folhas na frente do módulo
            let cursor = (cx - w / 2) + Math.max(0, (w - totalLeafW) / 2);
            const angle = doorOpenAngle * (Math.PI / 2);

            doorLeaves.forEach((door: any, dIdx: number) => {
              const leafW = leafWidths[dIdx];
              const dh = Math.min(door.height || h, h);
              const dd = Math.min(door.depth || 18, 30);
              const drawW = Math.max(leafW - 6, 10); // fresta de 6mm entre folhas
              const leafCenterX = cursor + leafW / 2;
              const doorY = cy - h / 2 + dh / 2;
              const doorZ = cz + d / 2 + dd / 2;

              const desc = (door.description || "").toLowerCase();
              const glass = isGlassy(door.materialType) || /vidro|espelho|reflecta/.test(desc);
              const kind = classifyDoor(desc);

              let doorColor = materialColor(door.materialType || obj.materialType);
              if (viewStyle === "solid") doorColor = glass ? "#38bdf8" : "#f59e0b";
              else if (viewStyle === "wireframe") doorColor = "rgba(245, 158, 11, 0.25)";

              const showHandle = !kind.noHandle && !glass && viewStyle !== "wireframe";
              const handleH = Math.min(dh * 0.55, 950);

              if (kind.sliding) {
                // Duas folhas em trilhas separadas (frente/trás), deslizam em sentidos opostos
                const slideDir = dIdx % 2 === 0 ? 1 : -1;
                const zLayer = dIdx % 2 === 0 ? doorZ : doorZ + dd + 5;
                const slideOffset = doorOpenAngle * leafW * 0.9 * slideDir;
                addBoxFaces(list, leafCenterX + slideOffset, doorY, zLayer, drawW, dh - 4, dd, doorColor, glass ? "Porta Vidro (correr)" : "Porta de Correr", door);
                if (showHandle) {
                  const hx = leafCenterX + slideOffset - slideDir * (drawW / 2 - 24);
                  addBoxFaces(list, hx, doorY, zLayer + dd, 22, handleH, 14, HANDLE_COLOR, "Puxador", door);
                }
              } else if (kind.basculante) {
                const hingeY = doorY + dh / 2;
                addBoxFacesWithVerticalRotation(list, leafCenterX, doorY, doorZ, drawW, dh - 4, dd, doorColor, "Porta Basculante", door, hingeY, cz + d / 2, -angle);
                if (showHandle) addBoxFacesWithVerticalRotation(list, leafCenterX, doorY - dh / 2 + 40, doorZ + dd, drawW * 0.5, 22, 16, HANDLE_COLOR, "Puxador", door, hingeY, cz + d / 2, -angle);
              } else {
                // Porta de giro — dobradiça alterna esquerda/direita entre folhas vizinhas
                const isLeftHinge = dIdx % 2 === 0;
                const hingeX = isLeftHinge ? leafCenterX - drawW / 2 : leafCenterX + drawW / 2;
                const sgn = isLeftHinge ? -1 : 1;
                addBoxFacesWithRotation(list, leafCenterX, doorY, doorZ, drawW, dh - 4, dd, doorColor, glass ? "Porta de Vidro" : "Porta de Giro", door, hingeX, cz + d / 2, sgn * angle);
                if (showHandle) {
                  const handleX = isLeftHinge ? leafCenterX + drawW / 2 - 26 : leafCenterX - drawW / 2 + 26;
                  addBoxFacesWithRotation(list, handleX, doorY, doorZ + dd, 22, handleH, 16, HANDLE_COLOR, "Puxador", door, hingeX, cz + d / 2, sgn * angle);
                }
              }
              cursor += leafW;
            });
          }

        } else if (obj.baseType === "table") {
          const isCountertop = (obj.itemType || "").toLowerCase().includes("bancada") || (obj.description || "").toLowerCase().includes("bancada");
          let tableColor = materialColor(obj.materialType);
          if (viewStyle === "solid") tableColor = isCountertop ? "#d97706" : "#4f46e5";
          else if (viewStyle === "wireframe") tableColor = "rgba(79, 70, 229, 0.15)";

          if (isCountertop) {
            // Render Countertop: slab + front skirt (saia) + back splash (rodapia)
            const slabTh = 30; // 3cm slab
            const saiaH = 200; // 20cm front skirt
            const rodapiaH = 200; // 20cm back splash

            // 1. Main slab
            addBoxFaces(list, cx, cy + h / 2 - slabTh / 2, cz, w, slabTh, d, tableColor, "Bancada (Tampo)", obj);
            // 2. Front skirt
            addBoxFaces(list, cx, cy + h / 2 - saiaH / 2, cz + d / 2 - 10, w, saiaH, 20, tableColor, "Bancada (Saia)", obj);
            // 3. Back splash
            addBoxFaces(list, cx, cy + h / 2 + rodapiaH / 2, cz - d / 2 + 10, w, rodapiaH, 20, tableColor, "Bancada (Rodapia)", obj);
          } else {
            addBoxFaces(list, cx, cy + h / 2 - 15, cz, w, 30, d, tableColor, "Tampo Mesa", obj);

            const legW = 40;
            const legH = h - 30;
            const legXOffset = w / 2 - 30;
            const legZOffset = d / 2 - 30;

            addBoxFaces(list, cx - legXOffset, cy - h / 2 + legH / 2, cz - legZOffset, legW, legH, legW, tableColor, "Pé Mesa", obj);
            addBoxFaces(list, cx + legXOffset, cy - h / 2 + legH / 2, cz - legZOffset, legW, legH, legW, tableColor, "Pé Mesa", obj);
            addBoxFaces(list, cx - legXOffset, cy - h / 2 + legH / 2, cz + legZOffset, legW, legH, legW, tableColor, "Pé Mesa", obj);
            addBoxFaces(list, cx + legXOffset, cy - h / 2 + legH / 2, cz + legZOffset, legW, legH, legW, tableColor, "Pé Mesa", obj);
          }

        } else if (obj.baseType === "headboard") {
          let headColor = materialColor(obj.materialType);
          if (viewStyle === "solid") headColor = "#b45309";
          else if (viewStyle === "wireframe") headColor = "rgba(180, 83, 9, 0.15)";

          addBoxFaces(list, cx, cy, cz, w, h, d, headColor, "Cabeceira", obj);

        } else if (obj.baseType === "panel") {
          let panelColor = materialColor(obj.materialType);
          if (viewStyle === "solid") panelColor = "#d97706";
          else if (viewStyle === "wireframe") panelColor = "rgba(217, 119, 6, 0.15)";

          addBoxFaces(list, cx, cy, cz, w, h, d, panelColor, "Painel", obj);

        } else if (obj.baseType === "bed") {
          let bedColor = materialColor(obj.materialType);
          if (viewStyle === "solid") bedColor = "#d97706";
          else if (viewStyle === "wireframe") bedColor = "rgba(217, 119, 6, 0.15)";

          // 1. Bed base frame (wood/material)
          const baseH = Math.min(300, h * 0.7);
          addBoxFaces(list, cx, cy - h / 2 + baseH / 2, cz, w, baseH, d, bedColor, "Cama (Base)", obj);

          // 2. Mattress (white/gray)
          let matColor = "#f3f4f6";
          if (viewStyle === "wireframe") matColor = "rgba(240, 240, 240, 0.15)";
          const mattressH = Math.min(200, h - baseH);
          addBoxFaces(list, cx, cy - h / 2 + baseH + mattressH / 2, cz, w - 20, mattressH, d - 20, matColor, "Cama (Colchão)", obj);

          // 3. Pillow
          let pillowColor = "#ffffff";
          if (viewStyle === "wireframe") pillowColor = "rgba(255, 255, 255, 0.1)";
          addBoxFaces(list, cx, cy - h / 2 + baseH + mattressH + 20, cz - d / 2 + 250, w - 100, 50, 300, pillowColor, "Cama (Travesseiro)", obj);

        } else if (obj.baseType === "niche") {
          let nicheColor = materialColor(obj.materialType);
          if (viewStyle === "solid") nicheColor = "#b45309";
          else if (viewStyle === "wireframe") nicheColor = "rgba(180, 83, 9, 0.15)";

          addHollowNiche(list, cx, cy, cz, w, h, d, 15, nicheColor, obj);

        } else {
          let otherColor = materialColor(obj.materialType);
          if (viewStyle === "solid") otherColor = "#6366f1";
          else if (viewStyle === "wireframe") otherColor = "rgba(99, 102, 241, 0.15)";

          if (obj.baseType === "standalone_sub" && ((obj.itemType || "").toLowerCase().includes("porta") || (obj.description || "").toLowerCase().includes("porta"))) {
            const angle = doorOpenAngle * (Math.PI / 2);
            const dd = Math.min(d || 18, 30);
            const glass = isGlassy(obj.materialType) || /vidro|espelho|reflecta/.test((obj.description || "").toLowerCase());
            const kind = classifyDoor(obj.description || "");
            const dcolor = viewStyle === "solid" ? (glass ? "#38bdf8" : otherColor) : otherColor;
            const hingeX = cx - w / 2;
            addBoxFacesWithRotation(list, cx, cy, cz, w, h, dd, dcolor, glass ? "Porta de Vidro" : "Porta Individual", obj, hingeX, cz, -angle);
            if (!kind.noHandle && !glass && viewStyle !== "wireframe") {
              addBoxFacesWithRotation(list, cx + w / 2 - 26, cy, cz + dd, 22, Math.min(h * 0.55, 950), 16, HANDLE_COLOR, "Puxador", obj, hingeX, cz, -angle);
            }
          } else {
            addBoxFaces(list, cx, cy, cz, w, h, d || 50, otherColor, obj.itemType || "Peça", obj);
          }
        }
      });
    });

    return list;
  }, [selectedItems, selected3DEnv, selected3DItemId, viewStyle, doorOpenAngle]);

  // Limites do conteúdo 3D (centro + tamanho) para centralizar e enquadrar a câmera
  const viewBounds = useMemo(() => {
    if (!faces3D.length) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    faces3D.forEach((f) =>
      f.vertices.forEach((v) => {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      }),
    );
    return {
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
      size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    };
  }, [faces3D]);

  const centerRef = useRef({ x: 0, y: 0, z: 0 });
  useEffect(() => {
    if (viewBounds) centerRef.current = viewBounds.center;
  }, [viewBounds]);

  // Autofit do zoom apenas quando muda a seleção (não ao abrir portas/explodir)
  useEffect(() => {
    if (!viewBounds) return;
    const spanX = Math.max(viewBounds.size.x, viewBounds.size.z) || 1;
    const spanY = viewBounds.size.y || 1;
    const fit = Math.min(680 / spanX, 460 / spanY);
    setZoom(Math.max(0.02, Math.min(0.4, fit)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected3DEnv, selected3DItemId, selectedProj?.id, activeTab]);

  // Refs de câmera — desacoplam a animação do ciclo de render do React
  // (evita setState por frame no loop de auto-rotação → sem "max update depth")
  const yawRef = useRef(yaw);
  const pitchRef = useRef(pitch);
  const zoomRef = useRef(zoom);
  const explodedRef = useRef(exploded);
  const autoRotateRef = useRef(autoRotate);
  useEffect(() => { yawRef.current = yaw; }, [yaw]);
  useEffect(() => { pitchRef.current = pitch; }, [pitch]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { explodedRef.current = exploded; }, [exploded]);
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);

  // Metadados do item selecionado no 3D (para overlay de informações)
  const selected3DMeta = useMemo(() => {
    if (selected3DItemId === "Todos") return null;
    return selectedItems.find((i: any) => i.id === selected3DItemId) || null;
  }, [selected3DItemId, selectedItems]);

  // Legenda de materiais presentes na cena 3D atual
  const scene3DMaterials = useMemo(() => {
    const set = new Set<string>();
    faces3D.forEach((f) => {
      const m = f.item?.materialType;
      if (m) set.add(m);
    });
    return Array.from(set).slice(0, 8);
  }, [faces3D]);

  function addBoxFaces(
    list: Face3D[],
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    color: string,
    type: string,
    item: any
  ) {
    const dx = w / 2;
    const dy = h / 2;
    const dz = d / 2;

    const v = [
      { x: cx - dx, y: cy - dy, z: cz - dz },
      { x: cx + dx, y: cy - dy, z: cz - dz },
      { x: cx + dx, y: cy + dy, z: cz - dz },
      { x: cx - dx, y: cy + dy, z: cz - dz },
      { x: cx - dx, y: cy - dy, z: cz + dz },
      { x: cx + dx, y: cy - dy, z: cz + dz },
      { x: cx + dx, y: cy + dy, z: cz + dz },
      { x: cx - dx, y: cy + dy, z: cz + dz }
    ];

    const faceDefs = [
      { indices: [0, 1, 2, 3], normal: { x: 0, y: 0, z: -1 }, offset: { x: 0, y: 0, z: -1.2 } },
      { indices: [1, 5, 6, 2], normal: { x: 1, y: 0, z: 0 }, offset: { x: 1.2, y: 0, z: 0 } },
      { indices: [5, 4, 7, 6], normal: { x: 0, y: 0, z: 1 }, offset: { x: 0, y: 0, z: 1.5 } },
      { indices: [4, 0, 3, 7], normal: { x: -1, y: 0, z: 0 }, offset: { x: -1.2, y: 0, z: 0 } },
      { indices: [3, 2, 6, 7], normal: { x: 0, y: 1, z: 0 }, offset: { x: 0, y: 1.2, z: 0 } },
      { indices: [4, 5, 1, 0], normal: { x: 0, y: -1, z: 0 }, offset: { x: 0, y: -1.2, z: 0 } }
    ];

    faceDefs.forEach((fd) => {
      list.push({
        vertices: fd.indices.map((idx) => ({ ...v[idx] })),
        color,
        type,
        normal: fd.normal,
        center: { x: cx, y: cy, z: cz },
        offset: fd.offset,
        item
      });
    });
  }

  function addHollowCabinet(
    list: Face3D[],
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    thickness: number,
    color: string,
    item: any
  ) {
    const th = thickness;
    addBoxFaces(list, cx - w / 2 + th / 2, cy, cz, th, h, d, color, "Lateral Esquerda", item);
    addBoxFaces(list, cx + w / 2 - th / 2, cy, cz, th, h, d, color, "Lateral Direita", item);
    addBoxFaces(list, cx, cy - h / 2 + th / 2, cz, w - 2 * th, th, d, color, "Base", item);
    addBoxFaces(list, cx, cy + h / 2 - th / 2, cz, w - 2 * th, th, d, color, "Tampo Superior", item);
    addBoxFaces(list, cx, cy, cz - d / 2 + 3, w - 2 * th, h - 2 * th, 6, "#2d2016", "Fundo", item);
  }

  function addHollowNiche(
    list: Face3D[],
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    thickness: number,
    color: string,
    item: any
  ) {
    const th = thickness;
    addBoxFaces(list, cx - w / 2 + th / 2, cy, cz, th, h, d, color, "Nicho Lateral Esquerda", item);
    addBoxFaces(list, cx + w / 2 - th / 2, cy, cz, th, h, d, color, "Nicho Lateral Direita", item);
    addBoxFaces(list, cx, cy - h / 2 + th / 2, cz, w - 2 * th, th, d, color, "Nicho Base", item);
    addBoxFaces(list, cx, cy + h / 2 - th / 2, cz, w - 2 * th, th, d, color, "Nicho Topo", item);
    addBoxFaces(list, cx, cy, cz - d / 2 + 2, w - 2 * th, h - 2 * th, 4, color, "Nicho Fundo", item);
  }

  function addBoxFacesWithRotation(
    list: Face3D[],
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    color: string,
    type: string,
    item: any,
    hingeX: number,
    hingeZ: number,
    angle: number
  ) {
    const dx = w / 2;
    const dy = h / 2;
    const dz = d / 2;

    const localV = [
      { x: -dx, y: -dy, z: -dz },
      { x: +dx, y: -dy, z: -dz },
      { x: +dx, y: +dy, z: -dz },
      { x: -dx, y: +dy, z: -dz },
      { x: -dx, y: -dy, z: +dz },
      { x: +dx, y: -dy, z: +dz },
      { x: +dx, y: +dy, z: +dz },
      { x: -dx, y: +dy, z: +dz }
    ];

    const v = localV.map((lv) => {
      const gx = cx + lv.x;
      const gz = cz + lv.z;
      
      const rx = gx - hingeX;
      const rz = gz - hingeZ;
      
      const rotatedX = hingeX + rx * Math.cos(angle) - rz * Math.sin(angle);
      const rotatedZ = hingeZ + rx * Math.sin(angle) + rz * Math.cos(angle);
      
      return {
        x: rotatedX,
        y: cy + lv.y,
        z: rotatedZ
      };
    });

    const faceDefs = [
      { indices: [0, 1, 2, 3], normal: { x: 0, y: 0, z: -1 }, offset: { x: 0, y: 0, z: -1.2 } },
      { indices: [1, 5, 6, 2], normal: { x: 1, y: 0, z: 0 }, offset: { x: 1.2, y: 0, z: 0 } },
      { indices: [5, 4, 7, 6], normal: { x: 0, y: 0, z: 1 }, offset: { x: 0, y: 0, z: 1.5 } },
      { indices: [4, 0, 3, 7], normal: { x: -1, y: 0, z: 0 }, offset: { x: -1.2, y: 0, z: 0 } },
      { indices: [3, 2, 6, 7], normal: { x: 0, y: 1, z: 0 }, offset: { x: 0, y: 1.2, z: 0 } },
      { indices: [4, 5, 1, 0], normal: { x: 0, y: -1, z: 0 }, offset: { x: 0, y: -1.2, z: 0 } }
    ];

    faceDefs.forEach((fd) => {
      const rotatedNormal = {
        x: fd.normal.x * Math.cos(angle) - fd.normal.z * Math.sin(angle),
        y: fd.normal.y,
        z: fd.normal.x * Math.sin(angle) + fd.normal.z * Math.cos(angle)
      };

      list.push({
        vertices: fd.indices.map((idx) => ({ ...v[idx] })),
        color,
        type,
        normal: rotatedNormal,
        center: { x: cx, y: cy, z: cz },
        offset: fd.offset,
        item
      });
    });
  }

  function addBoxFacesWithVerticalRotation(
    list: Face3D[],
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    color: string,
    type: string,
    item: any,
    hingeY: number,
    hingeZ: number,
    angle: number
  ) {
    const dx = w / 2;
    const dy = h / 2;
    const dz = d / 2;

    const localV = [
      { x: -dx, y: -dy, z: -dz },
      { x: +dx, y: -dy, z: -dz },
      { x: +dx, y: +dy, z: -dz },
      { x: -dx, y: +dy, z: -dz },
      { x: -dx, y: -dy, z: +dz },
      { x: +dx, y: -dy, z: +dz },
      { x: +dx, y: +dy, z: +dz },
      { x: -dx, y: +dy, z: +dz }
    ];

    const v = localV.map((lv) => {
      const gy = cy + lv.y;
      const gz = cz + lv.z;
      
      const ry = gy - hingeY;
      const rz = gz - hingeZ;
      
      const rotatedY = hingeY + ry * Math.cos(angle) - rz * Math.sin(angle);
      const rotatedZ = hingeZ + ry * Math.sin(angle) + rz * Math.cos(angle);
      
      return {
        x: cx + lv.x,
        y: rotatedY,
        z: rotatedZ
      };
    });

    const faceDefs = [
      { indices: [0, 1, 2, 3], normal: { x: 0, y: 0, z: -1 }, offset: { x: 0, y: 0, z: -1.2 } },
      { indices: [1, 5, 6, 2], normal: { x: 1, y: 0, z: 0 }, offset: { x: 1.2, y: 0, z: 0 } },
      { indices: [5, 4, 7, 6], normal: { x: 0, y: 0, z: 1 }, offset: { x: 0, y: 0, z: 1.5 } },
      { indices: [4, 0, 3, 7], normal: { x: -1, y: 0, z: 0 }, offset: { x: -1.2, y: 0, z: 0 } },
      { indices: [3, 2, 6, 7], normal: { x: 0, y: 1, z: 0 }, offset: { x: 0, y: 1.2, z: 0 } },
      { indices: [4, 5, 1, 0], normal: { x: 0, y: -1, z: 0 }, offset: { x: 0, y: -1.2, z: 0 } }
    ];

    faceDefs.forEach((fd) => {
      const rotatedNormal = {
        x: fd.normal.x,
        y: fd.normal.y * Math.cos(angle) - fd.normal.z * Math.sin(angle),
        z: fd.normal.y * Math.sin(angle) + fd.normal.z * Math.cos(angle)
      };

      list.push({
        vertices: fd.indices.map((idx) => ({ ...v[idx] })),
        color,
        type,
        normal: rotatedNormal,
        center: { x: cx, y: cy, z: cz },
        offset: fd.offset,
        item
      });
    });
  }

  // 3D Canvas Rendering Engine
  useEffect(() => {
    const canvas = canvas3DRef.current;
    if (!canvas || activeTab !== "model3d" || !faces3D.length) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      // Lê a câmera dos refs (não do state) — loop roda sem re-render do React
      const yaw = yawRef.current;
      const pitch = pitchRef.current;
      const zoom = zoomRef.current;
      const exploded = explodedRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw background grid plane
      ctx.strokeStyle = "#ead5ba12";
      ctx.lineWidth = 1;
      const gridSize = 120;
      const gridCount = 20;

      for (let i = -gridCount; i <= gridCount; i++) {
        // Line along Z
        const p1 = project3D({ x: i * gridSize, y: 0, z: -gridCount * gridSize }, yaw, pitch, zoom, canvas.width, canvas.height);
        const p2 = project3D({ x: i * gridSize, y: 0, z: gridCount * gridSize }, yaw, pitch, zoom, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // Line along X
        const p3 = project3D({ x: -gridCount * gridSize, y: 0, z: i * gridSize }, yaw, pitch, zoom, canvas.width, canvas.height);
        const p4 = project3D({ x: gridCount * gridSize, y: 0, z: i * gridSize }, yaw, pitch, zoom, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.moveTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.stroke();
      }

      // Project vertices and calculate depth
      const projectedFaces = faces3D.map((face) => {
        const offsetFactor = exploded * 160;
        
        const vertices = face.vertices.map((v) => {
          const ev = {
            x: v.x + face.offset.x * offsetFactor,
            y: v.y + face.offset.y * offsetFactor,
            z: v.z + face.offset.z * offsetFactor
          };
          return project3D(ev, yaw, pitch, zoom, canvas.width, canvas.height);
        });

        // Calculate average Z (depth) for painters sorting
        let sumZ = 0;
        face.vertices.forEach((v) => {
          const ev = {
            x: v.x + face.offset.x * offsetFactor,
            y: v.y + face.offset.y * offsetFactor,
            z: v.z + face.offset.z * offsetFactor
          };
          // Transform rotation to get exact camera Z depth
          const x1 = ev.x * Math.cos(yaw) - ev.z * Math.sin(yaw);
          const z1 = ev.x * Math.sin(yaw) + ev.z * Math.cos(yaw);
          const z2 = ev.y * Math.sin(pitch) + z1 * Math.cos(pitch);
          sumZ += z2;
        });

        return {
          ...face,
          projectedVertices: vertices,
          depth: sumZ / face.vertices.length
        };
      });

      // Sort faces by depth descending (Painter's algorithm)
      projectedFaces.sort((a, b) => b.depth - a.depth);

      // Light direction vector (from top-right-front)
      const lightDir = { x: 0.5, y: 0.8, z: -0.4 };
      const mag = Math.sqrt(lightDir.x*lightDir.x + lightDir.y*lightDir.y + lightDir.z*lightDir.z);
      lightDir.x /= mag;
      lightDir.y /= mag;
      lightDir.z /= mag;

      projectedFaces.forEach((face) => {
        const vertices = face.projectedVertices;

        // Calculate dot product of light vector and normal
        const normal = face.normal;
        const dot = normal.x * lightDir.x + normal.y * lightDir.y + normal.z * lightDir.z;
        const shade = Math.max(0.4, (dot + 1) / 2); // shade factor between 0.4 and 1.0

        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
          ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        ctx.closePath();

        // Colors
        let fillStyle = "#ead5ba";
        
        const isHovered = hovered3DItem?.id === face.item?.id;
        const isSelected = selected3DItem?.id === face.item?.id;

        if (isHovered) {
          fillStyle = "#e0a96d";
        } else if (isSelected) {
          fillStyle = "#ffe4bf";
        } else {
          // Normal shading
          fillStyle = blendColors(face.color, "#0b0907", 1 - shade);
        }

        ctx.fillStyle = fillStyle;
        ctx.fill();

        // Stroke wireframe
        ctx.strokeStyle = isSelected ? "#fff8f0" : isHovered ? "#ead5ba" : "#00000030";
        ctx.lineWidth = isSelected || isHovered ? 1.5 : 0.8;
        ctx.stroke();
      });

      // Auto-rotação: mutação direta do ref (sem setState → sem re-render por frame)
      if (autoRotateRef.current && !isDraggingRef.current) {
        yawRef.current += 0.003;
      }
    };

    const animate = () => {
      render();
      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faces3D, viewStyle, hovered3DItem, selected3DItem, activeTab, selected3DItemId, selectedItems]);

  function project3D(v: Point3D, yaw: number, pitch: number, zoom: number, width: number, height: number) {
    // Centraliza sempre no centro geométrico do conteúdo em cena
    const c = centerRef.current;
    const px = v.x - c.x;
    const py = v.y - c.y;
    const pz = v.z - c.z;

    // Rotate Y (Yaw)
    const x1 = px * Math.cos(yaw) - pz * Math.sin(yaw);
    const z1 = px * Math.sin(yaw) + pz * Math.cos(yaw);

    // Rotate X (Pitch)
    const y2 = py * Math.cos(pitch) - z1 * Math.sin(pitch);

    // Orthographic projection
    return {
      x: x1 * zoom + width / 2,
      y: -y2 * zoom + height / 2 // invert Y for screen space
    };
  }

  function blendColors(c1: string, c2: string, ratio: number): string {
    // Simple helper to darken hex colors
    const r1 = parseInt(c1.substring(1, 3), 16);
    const g1 = parseInt(c1.substring(3, 5), 16);
    const b1 = parseInt(c1.substring(5, 7), 16);

    const r2 = parseInt(c2.substring(1, 3), 16);
    const g2 = parseInt(c2.substring(3, 5), 16);
    const b2 = parseInt(c2.substring(5, 7), 16);

    const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
    const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
    const b = Math.round(b1 * (1 - ratio) + b2 * ratio);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  // 3D Canvas mouse event handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    // Atualiza o ref (resposta imediata no loop) e sincroniza o state
    const nextYaw = yawRef.current + dx * 0.007;
    const nextPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitchRef.current - dy * 0.007));
    yawRef.current = nextYaw;
    pitchRef.current = nextPitch;
    setYaw(nextYaw);
    setPitch(nextPitch);

    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const nextZoom = Math.max(0.02, Math.min(0.5, zoomRef.current - e.deltaY * 0.0001));
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  };

  // Todas as peças planas de corte, decompostas dos módulos extraídos
  const productionPanels: Panel[] = useMemo(
    () => selectedItems.flatMap((item: any) => explodeToPanels(item)),
    [selectedItems],
  );

  // Peças por material (para nesting por material)
  const panelsByMaterial = useMemo(() => {
    const groups: Record<string, Panel[]> = {};
    productionPanels.forEach((p) => {
      const m = p.material || "MDF 18mm";
      (groups[m] = groups[m] || []).push(p);
    });
    return groups;
  }, [productionPanels]);

  // Materiais que viram chapa de MDF (para o filtro do plano de corte)
  const projectMaterials = useMemo(
    () => ["Todos", ...Object.keys(panelsByMaterial)],
    [panelsByMaterial],
  );

  // 2D Nesting — chapas do material selecionado no visualizador
  const nestingSheets: Sheet[] = useMemo(() => {
    if (!productionPanels.length) return [];
    const mats = selectedMaterial && selectedMaterial !== "Todos"
      ? [selectedMaterial]
      : Object.keys(panelsByMaterial);
    const sheets: Sheet[] = [];
    mats.forEach((m) => {
      const packed = packPanels(panelsByMaterial[m] || []);
      packed.forEach((s) => (s.material = m));
      sheets.push(...packed);
    });
    return sheets;
  }, [productionPanels, panelsByMaterial, selectedMaterial]);

  // Orçamento real e transparente (DRE) — recalcula ao vivo com os parâmetros
  const costBreakdown = useMemo(() => {
    const panels = productionPanels;
    if (!panels.length) return null;

    // Chapas reais por material (independe do filtro do visualizador)
    let totalSheets = 0;
    const sheetsPerMaterial: Record<string, number> = {};
    Object.entries(panelsByMaterial).forEach(([m, ps]) => {
      const n = packPanels(ps).length;
      sheetsPerMaterial[m] = n;
      totalSheets += n;
    });

    // Área de painéis (m²) e fita de borda (m lineares nas bordas expostas)
    let panelAreaM2 = 0;
    let edgeMeters = 0;
    panels.forEach((p) => {
      panelAreaM2 += (p.w * p.h) / 1_000_000;
      // fita nas 2 maiores arestas (frentes recebem perímetro cheio)
      const isFront = /porta|frente|gaveta|tampo|prateleira/i.test(p.label);
      const perimeter = (2 * (p.w + p.h)) / 1000;
      edgeMeters += isFront ? perimeter : perimeter * 0.5;
    });

    // Ferragens estimadas a partir dos tipos de peça
    let hinges = 0, slides = 0, handles = 0;
    selectedItems.forEach((it: any) => {
      const t = (it.itemType || "").toLowerCase();
      const d = (it.description || "").toLowerCase();
      const q = Math.max(1, Number(it.quantity) || 1);
      if (t.includes("porta") || d.includes("porta")) {
        if (!/correr|desliza|perfil p1?7?0/.test(d)) hinges += 2 * q; // dobradiças (giro)
        handles += q;
      }
      if (t.includes("gaveta") || d.includes("gaveta")) { slides += q; handles += q; }
    });
    const HINGE = 9, SLIDE = 38, HANDLE = 16;
    const hardwareCost = hinges * HINGE + slides * SLIDE + handles * HANDLE;

    const mdfBase = totalSheets * sheetPrice;
    const mdfCost = mdfBase * (1 + wastePercent / 100); // perda/refilo
    const edgeCost = edgeMeters * edgePrice;
    const laborCost = panelAreaM2 * laborPrice;

    const custoDireto = mdfCost + edgeCost + hardwareCost + laborCost;
    const precoVenda = custoDireto * markup;
    const comissaoRS = precoVenda * (commission / 100);
    const impostoRS = precoVenda * (taxPercent / 100);
    const lucroLiquido = precoVenda - custoDireto - comissaoRS - impostoRS;
    const margemLiquidaPct = precoVenda > 0 ? (lucroLiquido / precoVenda) * 100 : 0;

    return {
      totalSheets, sheetsPerMaterial, panelAreaM2, edgeMeters,
      hinges, slides, handles,
      mdfCost, edgeCost, hardwareCost, laborCost,
      custoDireto, precoVenda, comissaoRS, impostoRS, lucroLiquido, margemLiquidaPct,
      panelCount: panels.length,
    };
  }, [productionPanels, panelsByMaterial, selectedItems, sheetPrice, edgePrice, laborPrice, wastePercent, markup, commission, taxPercent]);

  // Nesting Canvas renderer
  useEffect(() => {
    const canvas = canvasNestingRef.current;
    if (!canvas || activeTab !== "budgeting" || !nestingSheets.length) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sheet = nestingSheets[selectedSheetIndex] || nestingSheets[0];
    if (!sheet) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Padding settings
    const pad = 20;
    const drawW = canvas.width - pad * 2;
    const drawH = canvas.height - pad * 2;

    // Scale calculation
    const scaleX = drawW / sheet.width;
    const scaleY = drawH / sheet.height;
    const scale = Math.min(scaleX, scaleY);

    // Draw main sheet board border
    const boardW = sheet.width * scale;
    const boardH = sheet.height * scale;
    const startX = (canvas.width - boardW) / 2;
    const startY = (canvas.height - boardH) / 2;

    ctx.fillStyle = "#211811";
    ctx.fillRect(startX, startY, boardW, boardH);
    ctx.strokeStyle = "#ead5ba50";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(startX, startY, boardW, boardH);

    // Draw grid pattern on the board
    ctx.strokeStyle = "#ffffff04";
    ctx.lineWidth = 0.5;
    const spacing = 100 * scale;
    for (let x = startX; x < startX + boardW; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, startY + boardH); ctx.stroke();
    }
    for (let y = startY; y < startY + boardH; y += spacing) {
      ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(startX + boardW, y); ctx.stroke();
    }

    // Draw packed parts
    sheet.packed.forEach((rect) => {
      const rx = startX + rect.x * scale;
      const ry = startY + rect.y * scale;
      const rw = rect.w * scale;
      const rh = rect.h * scale;

      // Cor da peça pelo material real
      const pmat = (rect.item as any)?.material || (sheet as any).material;
      ctx.fillStyle = materialColor(pmat) + "44";
      ctx.fillRect(rx, ry, rw, rh);

      ctx.strokeStyle = "#ead5bac0";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(rx, ry, rw, rh);

      // Texto dentro da peça se couber
      if (rw > 46 && rh > 22) {
        ctx.fillStyle = "#fff8f0";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const label = `${(rect.item as any)?.label || "Peça"}`;
        const dims = `${Math.round(rect.w)}x${Math.round(rect.h)}`;

        ctx.fillText(label.slice(0, Math.floor(rw / 6)), rx + rw / 2, ry + rh / 2 - 5);
        ctx.fillStyle = "#cdbca7";
        ctx.fillText(dims, rx + rw / 2, ry + rh / 2 + 6);
      }
    });

    // Outer sheet dimensions texts
    ctx.fillStyle = "#bba890";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("2750 mm", startX + boardW / 2, startY - 6);

    ctx.save();
    ctx.translate(startX - 10, startY + boardH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("1840 mm", 0, 0);
    ctx.restore();

    // Draw sheet material label at top right
    if ((sheet as any).material) {
      ctx.fillStyle = "#fb923c";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "right";
      ctx.fillText((sheet as any).material, startX + boardW - 5, startY - 6);
    }
  }, [nestingSheets, selectedSheetIndex, activeTab]);

  const nestingEfficiency: number = useMemo(() => {
    if (!nestingSheets.length) return 0;
    const sheetArea = 2750 * 1840;
    const currentSheet = nestingSheets[selectedSheetIndex] || nestingSheets[0];
    if (!currentSheet) return 0;

    let partsArea = 0;
    currentSheet.packed.forEach((r) => {
      partsArea += r.w * r.h;
    });

    return Math.round((partsArea / sheetArea) * 100);
  }, [nestingSheets, selectedSheetIndex]);

  return (
    <div className="space-y-6">
      {/* Upper Hero Card */}
      <section className="overflow-hidden rounded-2xl border border-[#e8d4b8]/12 bg-[#211811]/78">
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="p-6 md:p-8">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#d6ad79]/28 bg-[#d6ad79]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#ead5ba]">
              <Sparkles className="h-3.5 w-3.5" />
              Projetos sob medida
            </div>
            <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-[#fff8f0] md:text-4xl">
              Cada ambiente organizado do briefing ate a entrega.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#cdbca7]">
              Cadastre o cliente, acompanhe arquivos, ambientes, medidas e status em uma tela simples para vender e executar melhor.
            </p>
          </div>

          <div className="border-t border-[#e8d4b8]/10 bg-[#fff7ed]/[0.035] p-6 md:p-8 lg:border-l lg:border-t-0">
            <button
              onClick={() => setShowAddForm((value) => !value)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ead5ba] px-5 py-3 text-sm font-bold text-[#20170f] transition hover:bg-[#ffe4bf]"
            >
              <Plus className="h-4 w-4" />
              Novo projeto
            </button>
            
            {showAddForm ? (
              <form onSubmit={createProject} className="mt-4 space-y-3">
                <input
                  value={newProjName}
                  onChange={(event) => setNewProjName(event.target.value)}
                  className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#211811] px-4 py-3 text-sm text-[#fff8f0] outline-none placeholder:text-[#7f705f] focus:border-[#d6ad79]/60"
                  placeholder="Nome do projeto"
                />
                <textarea
                  value={newProjDesc}
                  onChange={(event) => setNewProjDesc(event.target.value)}
                  className="min-h-[92px] w-full rounded-xl border border-[#e8d4b8]/12 bg-[#211811] px-4 py-3 text-sm text-[#fff8f0] outline-none placeholder:text-[#7f705f] focus:border-[#d6ad79]/60"
                  placeholder="Ambientes, estilo, prazo ou observacoes"
                />
                <button className="w-full rounded-xl border border-[#d6ad79]/30 bg-[#d6ad79]/12 px-4 py-3 text-sm font-bold text-[#ead5ba]">
                  Criar projeto
                </button>
              </form>
            ) : (
              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                <Metric value={projects.length} label="Projetos" />
                <Metric value={environments.length || "-"} label="Ambientes" />
                <Metric value={selectedItems.length || "-"} label="Itens" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Main Grid */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left projects list */}
        <aside className="space-y-3 lg:col-span-4 xl:col-span-4">
          {projects.map((project) => {
            const active = selectedProj?.id === project.id;
            return (
              <button
                key={project.id}
                onClick={() => setSelectedProj(project)}
                className={`w-full rounded-2xl border p-5 text-left transition ${
                  active 
                    ? "border-[#d6ad79]/38 bg-[#d6ad79]/12" 
                    : "border-[#e8d4b8]/12 bg-[#fff7ed]/[0.04] hover:border-[#d6ad79]/28"
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="rounded-full border border-[#e8d4b8]/12 bg-[#211811]/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#d6ad79]">
                    {statusLabel[project.status] || project.status}
                  </span>
                  <span className="text-xs text-[#a99680]">
                    {project.items.length} itens
                  </span>
                </div>
                <h3 className="font-semibold tracking-tight text-[#fff8f0]">
                  {project.name}
                </h3>
                <p className="mt-2 line-clamp-2 text-sm leading-5 text-[#bba890]">
                  {project.description}
                </p>
              </button>
            );
          })}
        </aside>

        {/* Right selected project details */}
        <main className="min-h-[520px] rounded-2xl border border-[#e8d4b8]/12 bg-[#211811]/70 p-5 md:p-7 lg:col-span-8 xl:col-span-8">
          {selectedProj ? (
            <div className="space-y-7">
              {/* Selected Project Header */}
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#d6ad79]/14 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[#ead5ba]">
                      {statusLabel[selectedProj.status] || selectedProj.status}
                    </span>
                    {selectedProj.originalFileUrl && (
                      <span className="rounded-full border border-[#e8d4b8]/12 px-3 py-1 text-xs text-[#bba890]">
                        {selectedProj.originalFileUrl}
                      </span>
                    )}
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-[#fff8f0] md:text-3xl">
                    {selectedProj.name}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[#cdbca7]">
                    {selectedProj.description}
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <label
                    className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#d6ad79]/30 bg-[#d6ad79]/10 px-4 py-3 text-sm font-bold text-[#ead5ba] transition hover:bg-[#d6ad79]/16 ${
                      uploading ? "pointer-events-none opacity-60" : ""
                    }`}
                  >
                    <FileUp className="h-4 w-4" />
                    {uploading ? (parseStage || "Enviando...") : "Subir Arquivos"}
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      onChange={(event) => handleFileChange(event, selectedProj.id)}
                    />
                  </label>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex border-b border-[#e8d4b8]/10">
                <button
                  onClick={() => setActiveTab("details")}
                  className={`border-b-2 px-5 py-3 text-sm font-bold transition ${
                    activeTab === "details"
                      ? "border-[#d6ad79] text-[#fff8f0]"
                      : "border-transparent text-[#cdbca7] hover:text-[#fff8f0]"
                  }`}
                >
                  📋 Detalhes
                </button>
                <button
                  onClick={() => setActiveTab("model3d")}
                  className={`border-b-2 px-5 py-3 text-sm font-bold transition ${
                    activeTab === "model3d"
                      ? "border-[#d6ad79] text-[#fff8f0]"
                      : "border-transparent text-[#cdbca7] hover:text-[#fff8f0]"
                  }`}
                >
                  📐 Modelo 3D
                </button>
                <button
                  onClick={() => setActiveTab("budgeting")}
                  className={`border-b-2 px-5 py-3 text-sm font-bold transition ${
                    activeTab === "budgeting"
                      ? "border-[#d6ad79] text-[#fff8f0]"
                      : "border-transparent text-[#cdbca7] hover:text-[#fff8f0]"
                  }`}
                >
                  💰 Orçamento & Nesting
                </button>
              </div>

              {/* Selected Project Stats (Always visible in all tabs) */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <ProjectStat label="Ambientes" value={environments.length || 0} />
                <ProjectStat label="Itens planejados" value={selectedItems.length || 0} />
                <ProjectStat
                  label="Qtd. total"
                  value={selectedItems.reduce((sum: number, item: any) => sum + item.quantity, 0)}
                />
              </div>

              {/* TAB 1: DETAILS */}
              {activeTab === "details" && (
                <div className="space-y-5">
                  {/* Resumo de produção */}
                  {selectedItems.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <MiniStat label="Área de painéis" value={`${(costBreakdown?.panelAreaM2 || 0).toFixed(1)} m²`} />
                      <MiniStat label="Chapas MDF (est.)" value={costBreakdown?.totalSheets ?? 0} />
                      <MiniStat label="Peças de corte" value={costBreakdown?.panelCount ?? 0} />
                      <MiniStat label="Materiais" value={new Set(selectedItems.map((i: any) => i.materialType)).size} />
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
                    {/* Left: Ambientes e Medidas agrupados */}
                    <div>
                      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#e8d4b8]/10 pb-3">
                        <div>
                          <h3 className="text-lg font-semibold tracking-tight text-[#fff8f0]">
                            Ambientes e medidas
                          </h3>
                          <p className="text-xs text-[#bba890] mt-0.5">
                            {viewMode === 'raw' 
                              ? "Visão Simplificada: Medidas brutas dos móveis (sem gavetas e portas)" 
                              : "Visão Detalhada: Todas as peças e componentes fracionados"}
                          </p>
                        </div>

                        {/* Toggle Mode Button */}
                        <div className="flex items-center gap-1 bg-[#18120d] p-1 rounded-xl border border-[#e8d4b8]/15 shrink-0">
                          <button
                            onClick={() => setViewMode('raw')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              viewMode === 'raw'
                                ? "bg-[#ead5ba] text-[#20170f] shadow"
                                : "text-[#bba890] hover:text-[#ead5ba]"
                            }`}
                          >
                            📦 Medidas Brutas
                          </button>
                          <button
                            onClick={() => setViewMode('all')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              viewMode === 'all'
                                ? "bg-[#ead5ba] text-[#20170f] shadow"
                                : "text-[#bba890] hover:text-[#ead5ba]"
                            }`}
                          >
                            📋 Todas as Peças ({selectedItems.length})
                          </button>
                        </div>
                      </div>

                      {selectedItems.length ? (
                        <div className="space-y-6">
                          {environments.map((env) => {
                            let envItems = selectedItems.filter((i: any) => i.environment === env);
                            if (viewMode === 'raw') {
                              const rawOnly = envItems.filter(isMainFurnitureModule);
                              if (rawOnly.length > 0) envItems = rawOnly;
                            }
                            const envArea = envItems.reduce((s: number, i: any) => s + (i.area || 0), 0);
                            const envQty = envItems.reduce((s: number, i: any) => s + (i.quantity || 1), 0);
                            return (
                              <div key={env}>
                                <div className="mb-2.5 flex items-center justify-between gap-3 border-b border-[#e8d4b8]/10 pb-2">
                                  <h4 className="text-sm font-bold uppercase tracking-[0.14em] text-[#c89a63]">{env}</h4>
                                  <span className="shrink-0 text-[11px] text-[#a99680]">
                                    {envItems.length} móveis · {envQty} un · {envArea.toFixed(1)} m²
                                  </span>
                                </div>
                                <div className="space-y-2.5">
                                  {envItems.map((item: any) => (
                                    <ItemDetailCard key={item.id} item={item} />
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-[#e8d4b8]/18 bg-[#fff7ed]/[0.035] p-8 text-center">
                          <Maximize2 className="mx-auto h-7 w-7 text-[#d6ad79]" />
                          <h4 className="mt-4 font-semibold text-[#fff8f0]">
                            Nenhum ambiente organizado ainda
                          </h4>
                          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#bba890]">
                            Suba uma planta executiva em PDF para iniciar a extração automática.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right: Materiais + Fluxo */}
                    <aside className="space-y-5">
                      {selectedItems.length > 0 && (
                        <div className="rounded-xl border border-[#e8d4b8]/12 bg-[#fff7ed]/[0.04] p-5">
                          <h3 className="mb-3 font-semibold tracking-tight text-[#fff8f0]">Materiais</h3>
                          <div className="space-y-2.5">
                            {Object.entries(
                              selectedItems.reduce((acc: Record<string, number>, i: any) => {
                                const m = i.materialType || "MDF 18mm";
                                acc[m] = (acc[m] || 0) + (i.quantity || 1);
                                return acc;
                              }, {}),
                            )
                              .sort((a: any, b: any) => b[1] - a[1])
                              .map(([mat, qty]: any) => (
                                <div key={mat} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="flex min-w-0 items-center gap-2 text-[#e8d9c6]">
                                    <span
                                      className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-white/10"
                                      style={{ background: materialColor(mat) }}
                                    />
                                    <span className="truncate">{mat}</span>
                                  </span>
                                  <span className="shrink-0 text-[#a99680]">
                                    {qty} pç
                                    {costBreakdown?.sheetsPerMaterial[mat]
                                      ? ` · ${costBreakdown.sheetsPerMaterial[mat]} ch`
                                      : ""}
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl border border-[#d6ad79]/18 bg-[#d6ad79]/10 p-5">
                        <h3 className="font-semibold tracking-tight text-[#fff8f0]">Fluxo do projeto</h3>
                        <div className="mt-5 space-y-4">
                          {[
                            { step: "Briefing recebido", done: true },
                            { step: "Ambientes definidos", done: environments.length > 0 },
                            { step: "Medidas revisadas", done: selectedItems.length > 0 },
                            { step: "Orçamento pronto", done: !!costBreakdown },
                          ].map((s, index) => (
                            <div key={s.step} className="flex gap-3">
                              <div
                                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                                  s.done ? "bg-[#ead5ba] text-[#20170f]" : "bg-[#211811] text-[#7f705f] ring-1 ring-[#e8d4b8]/15"
                                }`}
                              >
                                <CheckCircle className="h-3.5 w-3.5" />
                              </div>
                              <div>
                                <p className={`text-sm font-semibold ${s.done ? "text-[#fff8f0]" : "text-[#8c7c68]"}`}>{s.step}</p>
                                <p className="text-xs text-[#bba890]">Etapa {index + 1}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </aside>
                  </div>

                  {/* Resumo Simplificado de Cotas & Módulos (Colapsado por padrão ao final da página) */}
                  <SimplifiedSummaryTable items={selectedItems} />
                </div>
              )}

              {/* TAB 2: 3D MODEL */}
              {activeTab === "model3d" && (selectedProj?.digitalTwin ? (
                <ThreeViewer project={selectedProj} />
              ) : (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
                  {/* Visualizer Canvas */}
                  <div className="relative rounded-2xl border border-[#e8d4b8]/10 bg-[#0b0907] p-1 flex flex-col justify-between">
                    {faces3D.length ? (
                      <>
                        <canvas
                          ref={canvas3DRef}
                          width={760}
                          height={520}
                          className="h-[520px] w-full cursor-grab rounded-xl active:cursor-grabbing"
                          onMouseDown={handleMouseDown}
                          onMouseMove={handleMouseMove}
                          onMouseUp={handleMouseUp}
                          onMouseLeave={handleMouseUp}
                          onWheel={handleWheel}
                        />
                        {/* Info overlay (top-left) */}
                        <div className="pointer-events-none absolute left-4 top-4 max-w-[280px] rounded-xl border border-[#e8d4b8]/12 bg-[#0b0907]/85 px-3.5 py-2.5 backdrop-blur">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#c89a63]">
                            {selected3DEnv === "Todas" ? "Todos os ambientes" : selected3DEnv}
                          </p>
                          <p className="mt-0.5 text-sm font-semibold leading-snug text-[#fff8f0]">
                            {selected3DMeta ? selected3DMeta.description : "Ambiente completo"}
                          </p>
                          {selected3DMeta && (
                            <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-[#fb923c]">
                              <span>L {selected3DMeta.width}</span>
                              <span className="text-[#e8d4b8]/30">×</span>
                              <span>A {selected3DMeta.height}</span>
                              <span className="text-[#e8d4b8]/30">×</span>
                              <span>P {selected3DMeta.depth}</span>
                              <span className="text-[#8c7c68]">mm</span>
                            </div>
                          )}
                        </div>

                        {/* Materials legend (top-right) */}
                        {scene3DMaterials.length > 0 && viewStyle === "textured" && (
                          <div className="pointer-events-none absolute right-4 top-4 rounded-xl border border-[#e8d4b8]/12 bg-[#0b0907]/85 px-3 py-2 backdrop-blur">
                            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[#8c7c68]">Materiais</p>
                            <div className="space-y-1">
                              {scene3DMaterials.map((m) => (
                                <div key={m} className="flex items-center gap-2 text-[10px] text-[#cdbca7]">
                                  <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-white/10" style={{ background: materialColor(m) }} />
                                  <span className="max-w-[130px] truncate">{m}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Overlay Controls */}
                        <div className="absolute bottom-5 left-5 flex gap-2">
                          <button
                            onClick={() => { setYaw(-0.6); setPitch(-0.4); }}
                            className="rounded-lg bg-[#211811]/90 border border-[#e8d4b8]/20 px-3 py-1.5 text-xs text-[#ead5ba] hover:bg-[#382b20]"
                          >
                            Reset
                          </button>
                          <button
                            onClick={() => setAutoRotate(!autoRotate)}
                            className={`rounded-lg border px-3 py-1.5 text-xs flex items-center gap-1 ${
                              autoRotate
                                ? "bg-[#ead5ba] border-transparent text-[#20170f]"
                                : "bg-[#211811]/90 border-[#e8d4b8]/20 text-[#ead5ba] hover:bg-[#382b20]"
                            }`}
                          >
                            <RotateCw className={`h-3 w-3 ${autoRotate ? 'animate-spin' : ''}`} />
                            Giro Auto
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex h-[520px] items-center justify-center text-center">
                        <div>
                          <Maximize2 className="mx-auto h-8 w-8 text-[#d6ad79]" />
                          <h4 className="mt-4 font-semibold text-[#fff8f0]">Modelo 3D indisponível</h4>
                          <p className="mt-2 text-xs text-[#bba890]">Extraia peças do PDF primeiro para visualizar em 3D.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sidebar controls for 3D View */}
                  <aside className="rounded-xl border border-[#e8d4b8]/10 bg-[#211811]/50 p-5 space-y-5">
                    <h3 className="font-semibold tracking-tight text-[#fff8f0]">
                      Controles de Visualização
                    </h3>

                    <div className="space-y-4">
                      {/* Environment Filter */}
                      <div>
                        <label className="text-xs text-[#bba890] block mb-1.5">Ambiente</label>
                        <select
                          value={selected3DEnv}
                          onChange={(e) => {
                            setSelected3DEnv(e.target.value);
                            setSelected3DItemId("Todos"); // Reset selected item when env changes
                          }}
                          className="w-full rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-3 py-2 text-xs text-[#fff8f0] outline-none focus:border-[#fb923c]/50"
                        >
                          <option value="Todas">Todos os Ambientes</option>
                          {environments.map((env) => (
                            <option key={env} value={env}>{env}</option>
                          ))}
                        </select>
                      </div>

                      {/* Item Selector */}
                      <div>
                        <label className="text-xs text-[#bba890] block mb-1.5">Módulo / Peça</label>
                        <select
                          value={selected3DItemId}
                          onChange={(e) => setSelected3DItemId(e.target.value)}
                          className="w-full rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-3 py-2 text-xs text-[#fff8f0] outline-none focus:border-[#fb923c]/50"
                        >
                          <option value="Todos">Todos os Módulos</option>
                          {selectedItems
                            .filter((item: any) => {
                              const matchEnv = selected3DEnv === "Todas" || (item.environment || "Geral") === selected3DEnv;
                              const hasSize = item.width > 0 && item.height > 0;
                              const isNotHardware = !item.itemType.toLowerCase().includes("ferragem");
                              return matchEnv && hasSize && isNotHardware;
                            })
                            .map((item: any) => (
                              <option key={item.id} value={item.id}>
                                {item.description} ({item.width}x{item.height}x{item.depth})
                              </option>
                            ))}
                        </select>
                      </div>

                      {/* Visual Style Selection */}
                      <div>
                        <label className="text-xs text-[#bba890] block mb-1.5">Estilo Visual</label>
                        <div className="grid grid-cols-3 gap-1">
                          {[
                            { value: "textured", label: "Textura" },
                            { value: "solid", label: "Sólido" },
                            { value: "wireframe", label: "Técnico" }
                          ].map((style) => (
                            <button
                              key={style.value}
                              onClick={() => setViewStyle(style.value)}
                              className={`rounded-lg px-2 py-1.5 text-[10px] font-bold border transition ${
                                viewStyle === style.value
                                  ? "bg-[#ead5ba] border-transparent text-[#20170f]"
                                  : "bg-[#18120d]/80 border-[#e8d4b8]/10 text-[#bba890] hover:text-[#ead5ba]"
                              }`}
                            >
                              {style.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Preset Angle Buttons */}
                      <div>
                        <label className="text-xs text-[#bba890] block mb-1.5">Ângulo da Câmera</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            { label: "Isométrica", yaw: -0.6, pitch: -0.4 },
                            { label: "Frontal (L)", yaw: 0, pitch: 0 },
                            { label: "Superior (A)", yaw: 0, pitch: -Math.PI / 2 },
                            { label: "Lateral (P)", yaw: Math.PI / 2, pitch: 0 }
                          ].map((camera) => (
                            <button
                              key={camera.label}
                              onClick={() => {
                                setYaw(camera.yaw);
                                setPitch(camera.pitch);
                                setAutoRotate(false); // Pause auto rotation
                              }}
                              className="rounded-lg bg-[#18120d]/80 border border-[#e8d4b8]/10 px-2 py-1 text-[10px] text-[#bba890] hover:text-[#ead5ba] hover:bg-[#382b20] font-bold"
                            >
                              {camera.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Doors & Drawers Open Angle Slider */}
                      <div>
                        <div className="flex justify-between text-xs font-semibold text-[#bba890] mb-1.5">
                          <span>Abertura Portas/Frentes</span>
                          <span>{Math.round(doorOpenAngle * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={doorOpenAngle}
                          onChange={(e) => {
                            setDoorOpenAngle(parseFloat(e.target.value));
                            setAutoRotate(false); // Stop rotation to let them adjust opening
                          }}
                          className="w-full accent-[#fb923c]"
                        />
                      </div>

                      {/* Exploded View Slider */}
                      <div>
                        <div className="flex justify-between text-xs font-semibold text-[#bba890] mb-1.5">
                          <span>Vista Explodida</span>
                          <span>{Math.round(exploded * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={exploded}
                          onChange={(e) => setExploded(parseFloat(e.target.value))}
                          className="w-full accent-[#fb923c]"
                        />
                      </div>

                      {/* Info block */}
                      <div className="rounded-xl bg-[#fff7ed]/[0.03] p-4 text-xs leading-5 text-[#bba890] border border-[#e8d4b8]/10">
                        <p className="font-bold text-[#ead5ba] mb-1">Dicas de Uso:</p>
                        <ul className="list-disc pl-4 space-y-1">
                          <li>Arraste para girar a visualização 3D.</li>
                          <li>Role o scroll do mouse para ajustar o zoom.</li>
                          <li>Clique em "Reset" para restaurar a câmera original.</li>
                        </ul>
                      </div>
                    </div>
                  </aside>
                </div>
              ))}

              {/* TAB 3: BUDGET & CUTTING LAYOUT */}
              {activeTab === "budgeting" && (
                <div className="space-y-6">
                  {/* Calculations setup */}
                  <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]">
                    {/* Left: Interactive nesting canvas */}
                    <div className="rounded-2xl border border-[#e8d4b8]/10 bg-[#0b0907] p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[#e8d4b8]/10">
                        <div>
                          <h3 className="font-semibold text-[#fff8f0]">Plano de Corte (Nesting 2D)</h3>
                          <p className="text-xs text-[#bba890] mt-0.5">Acomodação geométrica em chapas padrão 2.75m x 1.84m.</p>
                        </div>
                        {/* Material Filter */}
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-[#bba890] font-bold">Material:</label>
                          <select
                            value={selectedMaterial}
                            onChange={(e) => {
                              setSelectedMaterial(e.target.value);
                              setSelectedSheetIndex(0); // Reset index
                            }}
                            className="rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-2 py-1 text-xs text-[#fff8f0] outline-none"
                          >
                            {projectMaterials.map((mat) => (
                              <option key={mat} value={mat}>{mat}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {nestingSheets.length ? (
                        <div className="space-y-4">
                          <div className="relative">
                            <canvas
                              ref={canvasNestingRef}
                              width={720}
                              height={400}
                              className="w-full h-[380px] bg-[#100b08] rounded-xl border border-[#e8d4b8]/5"
                            />
                            <div className="absolute top-3 left-3 rounded-md bg-[#000000a0] border border-[#e8d4b8]/20 px-2 py-1 text-[10px] text-[#ead5ba]">
                              Eficiência: <span className="font-bold text-[#fb923c]">{nestingEfficiency}%</span>
                            </div>
                          </div>

                          {/* Selector */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-[#cdbca7]">
                              Chapa <span className="font-bold text-[#ead5ba]">{selectedSheetIndex + 1}</span> de <span className="font-bold text-[#ead5ba]">{nestingSheets.length}</span>
                            </span>
                            <div className="flex gap-2">
                              <button
                                disabled={selectedSheetIndex === 0}
                                onClick={() => setSelectedSheetIndex((i) => i - 1)}
                                className="rounded-lg border border-[#e8d4b8]/12 bg-[#211811]/90 px-3 py-1.5 text-xs text-[#ead5ba] hover:bg-[#382b20] disabled:opacity-40"
                              >
                                Anterior
                              </button>
                              <button
                                disabled={selectedSheetIndex === nestingSheets.length - 1}
                                onClick={() => setSelectedSheetIndex((i) => i + 1)}
                                className="rounded-lg border border-[#e8d4b8]/12 bg-[#211811]/90 px-3 py-1.5 text-xs text-[#ead5ba] hover:bg-[#382b20] disabled:opacity-40"
                              >
                                Próxima
                              </button>
                            </div>
                          </div>

                          {/* Detail of items packed on the current sheet */}
                          <div className="rounded-xl border border-[#e8d4b8]/10 bg-[#18120d]/50 p-4 space-y-3">
                            <h4 className="text-xs font-bold text-[#ead5ba] tracking-wider uppercase">
                              Peças Acomodadas nesta Chapa
                            </h4>
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                  <tr className="border-b border-[#e8d4b8]/10 text-[#bba890] font-bold">
                                    <th className="py-2">Peça</th>
                                    <th className="py-2">Módulo</th>
                                    <th className="py-2">Dim. (mm)</th>
                                    <th className="py-2 text-right">Esp.</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {nestingSheets[selectedSheetIndex]?.packed.map((part, pIdx) => {
                                    const panel = part.item as any;
                                    return (
                                      <tr key={pIdx} className="border-b border-[#e8d4b8]/5 text-[#fff8f0]">
                                        <td className="py-2 font-medium">{panel?.label || "Peça"}</td>
                                        <td className="py-2 text-[#bba890]">{panel?.parent?.description?.slice(0, 28) || "—"}</td>
                                        <td className="py-2 font-mono">{Math.round(part.w)} x {Math.round(part.h)}</td>
                                        <td className="py-2 text-right font-mono">{panel?.thickness || 18}mm</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-[320px] items-center justify-center text-center">
                          <div>
                            <Package className="mx-auto h-8 w-8 text-[#d6ad79] opacity-65" />
                            <h4 className="mt-4 font-semibold text-[#fff8f0]">Plano de corte indisponível</h4>
                            <p className="mt-2 text-xs text-[#bba890]">Extraia peças do PDF primeiro para estimar chapa.</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right: Calculations parameters */}
                    <aside className="rounded-xl border border-[#e8d4b8]/10 bg-[#211811]/50 p-5 space-y-5">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-[#fb923c]" />
                        <h3 className="font-semibold tracking-tight text-[#fff8f0]">
                          Orçamento & Margens
                        </h3>
                      </div>

                      {/* Preço de venda sugerido (ao vivo) */}
                      <div className="rounded-xl bg-[#d6ad79]/10 border border-[#d6ad79]/20 p-4 space-y-3">
                        <div className="text-center">
                          <div className="text-[10px] font-bold text-[#ead5ba] uppercase tracking-wider">Preço de Venda Sugerido</div>
                          <div className="text-3xl font-bold text-[#fff8f0] mt-1.5">
                            {costBreakdown ? brl(costBreakdown.precoVenda) : "R$ ---"}
                          </div>
                          {costBreakdown && (
                            <div
                              className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                costBreakdown.margemLiquidaPct >= margin
                                  ? "bg-emerald-500/15 text-emerald-300"
                                  : "bg-[#fb923c]/15 text-[#fb923c]"
                              }`}
                            >
                              Margem líquida {costBreakdown.margemLiquidaPct.toFixed(1)}%
                              <span className="opacity-60">/ meta {margin}%</span>
                            </div>
                          )}
                        </div>

                        {costBreakdown && (
                          <div className="pt-2 border-t border-[#e8d4b8]/10 space-y-1.5 text-xs text-[#cdbca7]">
                            <BLine label={`MDF (${costBreakdown.totalSheets} chapas · perda ${wastePercent}%)`} value={brl(costBreakdown.mdfCost)} />
                            <BLine label={`Fita de borda (${costBreakdown.edgeMeters.toFixed(0)} m)`} value={brl(costBreakdown.edgeCost)} />
                            <BLine label={`Ferragens (${costBreakdown.hinges}dob · ${costBreakdown.slides}corr · ${costBreakdown.handles}pux)`} value={brl(costBreakdown.hardwareCost)} />
                            <BLine label={`Mão de obra (${costBreakdown.panelAreaM2.toFixed(1)} m²)`} value={brl(costBreakdown.laborCost)} />
                            <BLine label="Custo direto" value={brl(costBreakdown.custoDireto)} strong />
                            <div className="!mt-2 border-t border-[#e8d4b8]/10 pt-2 space-y-1.5">
                              <BLine label={`Comissão (${commission}%)`} value={`- ${brl(costBreakdown.comissaoRS)}`} tone="orange" />
                              <BLine label={`Imposto (${taxPercent}%)`} value={`- ${brl(costBreakdown.impostoRS)}`} tone="orange" />
                              <BLine label="Lucro líquido" value={brl(costBreakdown.lucroLiquido)} tone="green" strong />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Parâmetros de preço dos insumos */}
                      <div className="space-y-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-[#c89a63]">Preços dos insumos</p>
                        <div className="grid grid-cols-3 gap-2">
                          <NumField label="Chapa (R$)" value={sheetPrice} onChange={setSheetPrice} step={10} />
                          <NumField label="Fita (R$/m)" value={edgePrice} onChange={setEdgePrice} step={0.5} />
                          <NumField label="M.O. (R$/m²)" value={laborPrice} onChange={setLaborPrice} step={10} />
                        </div>
                      </div>

                      {/* Parâmetros comerciais */}
                      <div className="space-y-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-[#c89a63]">Margens & impostos</p>
                        <div className="grid grid-cols-2 gap-2">
                          <NumField label="Markup (x)" value={markup} onChange={setMarkup} step={0.05} />
                          <NumField label="Margem alvo (%)" value={margin} onChange={setMargin} step={1} />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <NumField label="Comissão (%)" value={commission} onChange={setCommission} step={0.5} />
                          <NumField label="Imposto (%)" value={taxPercent} onChange={setTaxPercent} step={0.5} />
                          <NumField label="Perda (%)" value={wastePercent} onChange={setWastePercent} step={1} />
                        </div>
                      </div>

                      <button
                        disabled={calculating || !selectedItems.length}
                        onClick={calculateBudget}
                        className="w-full rounded-xl bg-[#ead5ba] px-4 py-3 text-sm font-bold text-[#20170f] transition hover:bg-[#ffe4bf] disabled:opacity-50"
                      >
                        {calculating ? "Salvando..." : "Salvar orçamento"}
                      </button>
                    </aside>
                  </section>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center text-center">
              <div>
                <Layers className="mx-auto h-8 w-8 text-[#d6ad79]" />
                <h2 className="mt-4 text-xl font-semibold text-[#fff8f0]">
                  Crie o primeiro projeto
                </h2>
                <p className="mt-2 text-sm text-[#bba890]">
                  Use o botao Novo projeto para comecar.
                </p>
              </div>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

function Metric({ value, label }: { value: any; label: string }) {
  return (
    <div className="rounded-xl border border-[#e8d4b8]/12 bg-[#211811]/66 p-3">
      <div className="text-xl font-semibold text-[#fff8f0]">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#a99680]">
        {label}
      </div>
    </div>
  );
}

function ProjectStat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-[#e8d4b8]/12 bg-[#fff7ed]/[0.04] p-4">
      <div className="text-2xl font-semibold text-[#fff8f0]">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-[#a99680]">
        {label}
      </div>
    </div>
  );
}

function Measure({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-[#e8d4b8]/10 bg-[#211811]/70 px-3 py-2">
      <div className="font-bold text-[#fff8f0]">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[#a99680]">
        {label}
      </div>
    </div>
  );
}

function brl(n: number): string {
  return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function BLine({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "orange" | "green" }) {
  const color = tone === "orange" ? "text-[#fb923c]" : tone === "green" ? "text-emerald-300" : strong ? "text-[#fff8f0]" : "text-[#cdbca7]";
  return (
    <div className={`flex justify-between ${strong ? "font-bold" : ""} ${color}`}>
      <span className={strong ? "" : "text-[#bba890]"}>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] text-[#bba890]">{label}</label>
      <input
        type="number"
        step={step || 1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-2.5 py-1.5 text-xs text-[#fff8f0] outline-none focus:border-[#fb923c]/50"
      />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-[#e8d4b8]/12 bg-[#211811]/60 px-4 py-3">
      <div className="text-lg font-semibold text-[#fff8f0]">{value}</div>
      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#a99680]">{label}</div>
    </div>
  );
}

function ItemDetailCard({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false);
  const hasMeasures = item.width > 0 || item.height > 0 || item.depth > 0;

  return (
    <div 
      onClick={() => setExpanded(!expanded)}
      className="rounded-xl border border-[#e8d4b8]/12 bg-[#fff7ed]/[0.04] p-3.5 transition hover:border-[#d6ad79]/40 cursor-pointer select-none group space-y-3"
    >
      {/* Compact Collapsed Header (Always Visible) */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {item.codigo ? (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded bg-[#d6ad79] px-1.5 text-[10px] font-black text-[#20170f]">
              {item.codigo}
            </span>
          ) : null}
          <h4 className="font-semibold text-sm text-[#fff8f0] group-hover:text-[#ead5ba] transition-colors truncate">
            {item.description || item.name}
          </h4>
          {item.quantity > 1 ? (
            <span className="rounded bg-[#fb923c]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#fb923c] shrink-0">
              {item.quantity}×
            </span>
          ) : null}
        </div>

        {/* Compact Dimensions L (mm) | A (mm) | P (mm) */}
        {hasMeasures && (
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2.5 bg-[#211811]/80 px-3 py-1.5 rounded-lg border border-[#e8d4b8]/10 text-xs font-mono text-[#e8d9c6]">
              <span><span className="text-[#a99680] text-[10px]">L:</span> <strong className="text-white">{item.width}</strong></span>
              <span><span className="text-[#a99680] text-[10px]">A:</span> <strong className="text-white">{item.height}</strong></span>
              <span><span className="text-[#a99680] text-[10px]">P:</span> <strong className="text-white">{item.depth}</strong></span>
              <span className="text-[9px] text-[#8c7c68]">mm</span>
            </div>
            <span className="text-xs text-[#a99680] font-bold">
              {expanded ? '▲' : '▼'}
            </span>
          </div>
        )}
      </div>

      {/* Expanded Details (Visible only when clicked) */}
      {expanded && (
        <div className="pt-3 border-t border-[#e8d4b8]/10 space-y-2 text-xs text-[#bba890]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="rounded-md border border-[#e8d4b8]/15 bg-[#211811]/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#c89a63]">
              {item.itemType}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-white/10" style={{ background: materialColor(item.materialType) }} />
              {item.materialType || "MDF 18mm"}
            </span>
            {item.cor ? <span className="text-[#a99680]">Cor: {item.cor}</span> : null}
            {item.acabamento ? <span className="text-[#a99680]">Acabamento: {item.acabamento}</span> : null}
            <span className="text-[#8c7c68]">esp. {item.thickness || 18}mm</span>
            {item.area ? <span className="text-[#fb923c] font-semibold">{Number(item.area).toFixed(2)} m²</span> : null}
          </div>
          {item.observacoes ? (
            <p className="rounded-lg border border-[#e8d4b8]/10 bg-[#211811]/50 px-3 py-1.5 text-[11px] leading-5 text-[#a99680]">
              {item.observacoes}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SimplifiedSummaryTable({ items }: { items: any[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [tableFilter, setTableFilter] = useState<'raw' | 'all'>('raw');

  if (!items || items.length === 0) return null;

  const rawFiltered = items.filter(isMainFurnitureModule);
  const displayItems = tableFilter === 'raw' 
    ? (rawFiltered.length > 0 ? rawFiltered : items)
    : items;

  return (
    <div className="rounded-2xl border border-[#e8d4b8]/15 bg-[#18120d]/80 overflow-hidden shadow-lg mt-8">
      {/* Clickable Header Toggle */}
      <div className="w-full p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#211811]/90 border-b border-[#e8d4b8]/10">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2.5 text-left flex-1 hover:opacity-90 transition-opacity"
        >
          <Sparkles className="w-4 h-4 text-[#d6ad79] shrink-0" />
          <div>
            <h3 className="text-sm font-bold tracking-wide text-[#ead5ba] uppercase flex items-center gap-2">
              Resumo Simplificado de Cotas & Módulos
              <span className="text-[10px] bg-[#fb923c]/15 text-[#fb923c] px-2 py-0.5 rounded-full font-bold lowercase tracking-normal">
                {tableFilter === 'raw' ? 'medidas brutas' : 'todas as peças'}
              </span>
            </h3>
            <p className="text-xs text-[#a99680] font-normal">
              {displayItems.length} móveis listados {isOpen ? '(Clique para recolher)' : '(Clique para expandir a tabela)'}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-[#100b08] p-1 rounded-lg border border-[#e8d4b8]/15">
            <button
              onClick={() => { setTableFilter('raw'); setIsOpen(true); }}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                tableFilter === 'raw' ? "bg-[#ead5ba] text-[#20170f]" : "text-[#bba890] hover:text-[#ead5ba]"
              }`}
            >
              Medidas Brutas
            </button>
            <button
              onClick={() => { setTableFilter('all'); setIsOpen(true); }}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                tableFilter === 'all' ? "bg-[#ead5ba] text-[#20170f]" : "text-[#bba890] hover:text-[#ead5ba]"
              }`}
            >
              Todas as Peças ({items.length})
            </button>
          </div>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-xs font-bold text-[#ead5ba] hover:text-white px-2 py-1"
          >
            {isOpen ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Collapsed Table Content */}
      {isOpen && (
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#e8d4b8]/15 text-[#bba890] font-bold uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3">Módulo / Móvel</th>
                <th className="py-2.5 px-3">Ambiente</th>
                <th className="py-2.5 px-3 text-center">L (mm)</th>
                <th className="py-2.5 px-3 text-center">A (mm)</th>
                <th className="py-2.5 px-3 text-center">P (mm)</th>
                <th className="py-2.5 px-3 text-center">Área (m²)</th>
                <th className="py-2.5 px-3">Material / Cor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8d4b8]/10 text-[#fff8f0]">
              {displayItems.map((item, idx) => (
                <tr key={idx} className="hover:bg-[#fff7ed]/[0.02] transition-colors">
                  <td className="py-2.5 px-3 font-semibold text-[#e8d9c6]">
                    {item.description || item.name}
                  </td>
                  <td className="py-2.5 px-3 text-[#bba890]">
                    {item.environment || "—"}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-emerald-400 font-bold">
                    {item.width}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-emerald-400 font-bold">
                    {item.height}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-cyan-400 font-bold">
                    {item.depth}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-[#a99680]">
                    {item.area ? Number(item.area).toFixed(2) : (item.width * item.height / 1000000).toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-[#bba890] text-[11px]">
                    {item.materialType || "MDF Gianduia Trama (Duratex)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

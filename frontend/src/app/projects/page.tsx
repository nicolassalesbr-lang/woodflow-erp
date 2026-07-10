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
import { getApiUrl } from '../../utils/api';

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
}

export default function Projects() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProj, setSelectedProj] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
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
  const canvasNestingRef = useRef<HTMLCanvasElement>(null);

  const selectedItems = selectedProj?.items || [];
  
  const environments = useMemo(() => {
    const names = selectedItems.map((item: any) => item.environment);
    return Array.from(new Set(names));
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

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>, projectId: string) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(",")[1];
        const res = await fetch(`${getApiUrl()}/api/projects/${projectId}/parse`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer mock-jwt-token-2026"
          },
          body: JSON.stringify({
            filename: file.name,
            fileBase64: base64,
            mimeType: file.type
          })
        });
        if (res.ok) {
          fetchProjects();
        } else {
          const errMsg = await res.text();
          throw new Error(errMsg || "Erro interno do servidor ao processar o arquivo.");
        }
      } catch (err: any) {
        console.error(err);
        alert("Falha no upload/processamento: " + (err.message || err));
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
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
    
    const list: Face3D[] = [];
    const envGroups: Record<string, any[]> = {};
    
    selectedItems.forEach((item: any) => {
      const env = item.environment || "Geral";
      if (!envGroups[env]) envGroups[env] = [];
      envGroups[env].push(item);
    });

    let envOffset = 0;

    Object.entries(envGroups).forEach(([env, envItems]) => {
      // Find cabinets
      const boxes = envItems.filter((i) => i.itemType.toLowerCase().includes("caixa") || i.itemType.toLowerCase().includes("roupeiro"));
      const details = envItems.filter((i) => !i.itemType.toLowerCase().includes("caixa") && !i.itemType.toLowerCase().includes("roupeiro") && !i.itemType.toLowerCase().includes("ferragem"));
      
      let cabinetX = envOffset;

      boxes.forEach((cabinet) => {
        const w = cabinet.width || 800;
        const h = cabinet.height || 800;
        const d = cabinet.depth || 600;

        const cx = cabinetX + w / 2;
        const cy = h / 2;
        const cz = d / 2;

        // Base box color (Warm wood tone)
        addBoxFaces(list, cx, cy, cz, w, h, d, "#4b3525", "Caixa", cabinet);

        // Shelves and doors
        const cabinetDoors = details.filter((i) => i.itemType.toLowerCase().includes("porta") || i.itemType.toLowerCase().includes("frente"));
        const cabinetShelves = details.filter((i) => i.itemType.toLowerCase().includes("prateleira") || i.itemType.toLowerCase().includes("gaveta"));

        cabinetShelves.forEach((shelf, sIdx) => {
          const sw = shelf.width || (w - 36);
          const sh = shelf.height || 18;
          const sd = shelf.depth || (d - 40);
          
          const sy = (h / (cabinetShelves.length + 1)) * (sIdx + 1);
          addBoxFaces(list, cx, sy, cz - 10, sw, sh, sd, "#785840", "Prateleira", shelf);
        });

        cabinetDoors.forEach((door, dIdx) => {
          const dw = door.width || (w / cabinetDoors.length);
          const dh = door.height || h;
          const dd = door.depth || 18;

          const doorX = cabinetX + (dw / 2) + (dIdx * dw);
          const doorY = dh / 2;
          const doorZ = d + dd / 2;

          // Door colors (Gold beige styling)
          addBoxFaces(list, doorX, doorY, doorZ, dw - 4, dh - 4, dd, "#d4af37", "Porta", door);
        });

        cabinetX += w + 300; // spacer
      });

      if (boxes.length === 0) {
        envItems.forEach((item, idx) => {
          if (item.itemType.toLowerCase().includes("ferragem")) return;
          const w = item.width || 400;
          const h = item.height || 400;
          const d = item.depth || 400;
          const cx = envOffset + idx * 600 + w / 2;
          const cy = h / 2;
          const cz = d / 2;
          addBoxFaces(list, cx, cy, cz, w, h, d, "#8c6c50", item.itemType, item);
        });
      }

      envOffset += 4000;
    });

    return list;
  }, [selectedItems]);

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
      { indices: [0, 1, 2, 3], normal: { x: 0, y: 0, z: -1 }, offset: { x: 0, y: 0, z: -1.2 } }, // Back
      { indices: [1, 5, 6, 2], normal: { x: 1, y: 0, z: 0 }, offset: { x: 1.2, y: 0, z: 0 } },  // Right
      { indices: [5, 4, 7, 6], normal: { x: 0, y: 0, z: 1 }, offset: { x: 0, y: 0, z: 1.5 } },  // Front
      { indices: [4, 0, 3, 7], normal: { x: -1, y: 0, z: 0 }, offset: { x: -1.2, y: 0, z: 0 } }, // Left
      { indices: [3, 2, 6, 7], normal: { x: 0, y: 1, z: 0 }, offset: { x: 0, y: 1.2, z: 0 } },  // Top
      { indices: [4, 5, 1, 0], normal: { x: 0, y: -1, z: 0 }, offset: { x: 0, y: -1.2, z: 0 } }  // Bottom
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

  // 3D Canvas Rendering Engine
  useEffect(() => {
    const canvas = canvas3DRef.current;
    if (!canvas || activeTab !== "model3d" || !faces3D.length) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;

    const render = () => {
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

      // Update auto-rotation angle if enabled
      if (autoRotate && !isDraggingRef.current) {
        setYaw((y) => y + 0.003);
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
  }, [faces3D, yaw, pitch, zoom, exploded, autoRotate, hovered3DItem, selected3DItem, activeTab]);

  function project3D(v: Point3D, yaw: number, pitch: number, zoom: number, width: number, height: number) {
    // Center point in coordinates
    const offset = { x: -800, y: -400, z: -300 };
    const px = v.x + offset.x;
    const py = v.y + offset.y;
    const pz = v.z + offset.z;

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

    setYaw((y) => y + dx * 0.007);
    setPitch((p) => Math.max(-Math.PI/2, Math.min(Math.PI/2, p - dy * 0.007)));

    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    setZoom((z) => Math.max(0.04, Math.min(0.5, z - e.deltaY * 0.0001)));
  };

  // 2D Nesting Algorithm calculation
  const nestingSheets: Sheet[] = useMemo(() => {
    if (!selectedItems.length) return [];
    
    const panels = selectedItems.filter(
      (item: any) =>
        item.width > 0 &&
        item.height > 0 &&
        !item.itemType.toLowerCase().includes("ferragem") &&
        !item.description.toLowerCase().includes("ferragem")
    );

    const rectsToPack: any[] = [];
    panels.forEach((p: any) => {
      for (let i = 0; i < p.quantity; i++) {
        rectsToPack.push({
          id: `${p.id}-${i}`,
          w: Math.max(p.width, p.height),
          h: Math.min(p.width, p.height),
          parent: p
        });
      }
    });

    // Sort descending by area
    rectsToPack.sort((a, b) => b.w * b.h - a.w * a.h);

    const sheets: Sheet[] = [];
    const sheetW = 2750;
    const sheetH = 1840;
    const sawKerf = 5;

    rectsToPack.forEach((rect) => {
      let placed = false;

      for (const sheet of sheets) {
        for (let i = 0; i < sheet.freeSpaces.length; i++) {
          const space = sheet.freeSpaces[i];
          const fitsNormal = rect.w <= space.w && rect.h <= space.h;
          const fitsRotated = rect.h <= space.w && rect.w <= space.h;

          if (fitsNormal || fitsRotated) {
            const w = fitsNormal ? rect.w : rect.h;
            const h = fitsNormal ? rect.h : rect.w;

            sheet.packed.push({
              x: space.x,
              y: space.y,
              w,
              h,
              item: rect.parent
            });

            const remW = space.w - w;
            const remH = space.h - h;

            sheet.freeSpaces.splice(i, 1);

            if (remW > remH) {
              if (remW > sawKerf) {
                sheet.freeSpaces.push({
                  x: space.x + w + sawKerf,
                  y: space.y,
                  w: remW - sawKerf,
                  h: space.h
                });
              }
              if (remH > sawKerf) {
                sheet.freeSpaces.push({
                  x: space.x,
                  y: space.y + h + sawKerf,
                  w,
                  h: remH - sawKerf
                });
              }
            } else {
              if (remH > sawKerf) {
                sheet.freeSpaces.push({
                  x: space.x,
                  y: space.y + h + sawKerf,
                  w: space.w,
                  h: remH - sawKerf
                });
              }
              if (remW > sawKerf) {
                sheet.freeSpaces.push({
                  x: space.x + w + sawKerf,
                  y: space.y,
                  w: remW - sawKerf,
                  h
                });
              }
            }

            placed = true;
            break;
          }
        }
        if (placed) break;
      }

      if (!placed) {
        const newSheet: Sheet = {
          width: sheetW,
          height: sheetH,
          packed: [{ x: 0, y: 0, w: rect.w, h: rect.h, item: rect.parent }],
          freeSpaces: []
        };

        const remW = sheetW - rect.w;
        const remH = sheetH - rect.h;

        if (remW > sawKerf) {
          newSheet.freeSpaces.push({
            x: rect.w + sawKerf,
            y: 0,
            w: remW - sawKerf,
            h: sheetH
          });
        }
        if (remH > sawKerf) {
          newSheet.freeSpaces.push({
            x: 0,
            y: rect.h + sawKerf,
            w: rect.w,
            h: remH - sawKerf
          });
        }

        sheets.push(newSheet);
      }
    });

    return sheets;
  }, [selectedItems]);

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

      // Dynamic color by environment
      ctx.fillStyle = rect.item?.environment?.toLowerCase().includes("cozinha") ? "#ead5ba20" : "#d4af371a";
      ctx.fillRect(rx, ry, rw, rh);

      ctx.strokeStyle = "#ead5bac0";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(rx, ry, rw, rh);

      // Text inside part if large enough
      if (rw > 50 && rh > 24) {
        ctx.fillStyle = "#fff8f0";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const text = `${rect.item?.description || "Peca"}`;
        const dims = `${Math.round(rect.w)}x${Math.round(rect.h)}`;
        
        ctx.fillText(text.slice(0, Math.floor(rw / 6)), rx + rw / 2, ry + rh / 2 - 5);
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
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
        {/* Left projects list */}
        <aside className="space-y-3">
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
        <main className="min-h-[520px] rounded-2xl border border-[#e8d4b8]/12 bg-[#211811]/70 p-5 md:p-7">
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
                    {uploading ? "Enviando..." : "Subir PDF"}
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf"
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
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
                  {/* Left: Ambientes e Medidas */}
                  <div>
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-lg font-semibold tracking-tight text-[#fff8f0]">
                        Ambientes e medidas
                      </h3>
                      <Layers className="h-5 w-5 text-[#d6ad79]" />
                    </div>

                    {selectedItems.length ? (
                      <div className="space-y-3">
                        {selectedItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-xl border border-[#e8d4b8]/12 bg-[#fff7ed]/[0.04] p-4"
                          >
                            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#c89a63]">
                                  {item.environment}
                                </p>
                                <h4 className="mt-1 font-semibold text-[#fff8f0]">
                                  {item.description}
                                </h4>
                                <p className="mt-1 text-sm text-[#bba890]">
                                  {item.materialType}
                                </p>
                              </div>
                              {item.width > 0 && (
                                <div className="grid grid-cols-3 gap-2 text-center text-xs text-[#cdbca7]">
                                  <Measure label="L (mm)" value={item.width} />
                                  <Measure label="A (mm)" value={item.height} />
                                  <Measure label="P (mm)" value={item.depth} />
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
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

                  {/* Right: Fluxo do Projeto */}
                  <aside className="rounded-xl border border-[#d6ad79]/18 bg-[#d6ad79]/10 p-5">
                    <h3 className="font-semibold tracking-tight text-[#fff8f0]">
                      Fluxo do projeto
                    </h3>
                    <div className="mt-5 space-y-4">
                      {[
                        "Briefing recebido",
                        "Ambientes definidos",
                        "Medidas revisadas",
                        "Orcamento pronto"
                      ].map((step, index) => (
                        <div key={step} className="flex gap-3">
                          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#ead5ba] text-[#20170f]">
                            <CheckCircle className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-[#fff8f0]">
                              {step}
                            </p>
                            <p className="text-xs text-[#bba890]">
                              Etapa {index + 1}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </aside>
                </div>
              )}

              {/* TAB 2: 3D MODEL */}
              {activeTab === "model3d" && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
                  {/* Visualizer Canvas */}
                  <div className="relative rounded-2xl border border-[#e8d4b8]/10 bg-[#0b0907] p-1">
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
                        {/* Overlay Controls */}
                        <div className="absolute bottom-5 left-5 flex gap-2">
                          <button
                            onClick={() => { setYaw(-0.6); setPitch(-0.4); setZoom(0.12); }}
                            className="rounded-lg bg-[#211811]/90 border border-[#e8d4b8]/20 px-3 py-1.5 text-xs text-[#ead5ba]"
                          >
                            Reset
                          </button>
                          <button
                            onClick={() => setAutoRotate(!autoRotate)}
                            className={`rounded-lg border px-3 py-1.5 text-xs ${
                              autoRotate
                                ? "bg-[#ead5ba] border-transparent text-[#20170f]"
                                : "bg-[#211811]/90 border-[#e8d4b8]/20 text-[#ead5ba]"
                            }`}
                          >
                            <RotateCw className={`h-3 w-3 inline mr-1 ${autoRotate ? 'animate-spin' : ''}`} />
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
                  <aside className="rounded-xl border border-[#e8d4b8]/10 bg-[#211811]/50 p-5 space-y-6">
                    <h3 className="font-semibold tracking-tight text-[#fff8f0]">
                      Controles de Visualização
                    </h3>

                    <div className="space-y-4">
                      {/* Exploded View Slider */}
                      <div>
                        <div className="flex justify-between text-xs font-semibold text-[#bba890] mb-2">
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
                          className="w-full accent-[#d6ad79]"
                        />
                      </div>

                      {/* Info block */}
                      <div className="rounded-xl bg-[#fff7ed]/[0.03] p-4 text-xs leading-5 text-[#bba890] border border-[#e8d4b8]/10">
                        <p className="font-bold text-[#ead5ba] mb-1">Dicas de Uso:</p>
                        <ul className="list-disc pl-4 space-y-1">
                          <li>Arraste o mouse para girar o móvel.</li>
                          <li>Use o scroll para dar zoom.</li>
                          <li>Peças são coloridas de acordo com suas características.</li>
                        </ul>
                      </div>
                    </div>
                  </aside>
                </div>
              )}

              {/* TAB 3: BUDGET & CUTTING LAYOUT */}
              {activeTab === "budgeting" && (
                <div className="space-y-6">
                  {/* Calculations setup */}
                  <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
                    {/* Left: Interactive nesting canvas */}
                    <div className="rounded-2xl border border-[#e8d4b8]/10 bg-[#0b0907] p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-[#fff8f0]">Plano de Corte (Nesting 2D)</h3>
                          <p className="text-xs text-[#bba890] mt-1">Acomodação geométrica em chapas padrão 2.75m x 1.84m (5mm de perda por corte).</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-[#d6ad79]/14 px-3 py-1 text-xs font-bold text-[#ead5ba]">
                            Eficiência: {nestingEfficiency}%
                          </span>
                        </div>
                      </div>

                      {nestingSheets.length ? (
                        <div className="space-y-4">
                          <canvas
                            ref={canvasNestingRef}
                            width={720}
                            height={440}
                            className="w-full h-[400px] bg-[#100b08] rounded-xl border border-[#e8d4b8]/5"
                          />
                          {/* Selector */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-[#cdbca7]">
                              Chapa {selectedSheetIndex + 1} de {nestingSheets.length}
                            </span>
                            <div className="flex gap-2">
                              <button
                                disabled={selectedSheetIndex === 0}
                                onClick={() => setSelectedSheetIndex((i) => i - 1)}
                                className="rounded-lg border border-[#e8d4b8]/12 bg-[#211811]/90 px-3 py-1.5 text-xs text-[#ead5ba] disabled:opacity-40"
                              >
                                Anterior
                              </button>
                              <button
                                disabled={selectedSheetIndex === nestingSheets.length - 1}
                                onClick={() => setSelectedSheetIndex((i) => i + 1)}
                                className="rounded-lg border border-[#e8d4b8]/12 bg-[#211811]/90 px-3 py-1.5 text-xs text-[#ead5ba] disabled:opacity-40"
                              >
                                Próxima
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-[320px] items-center justify-center text-center">
                          <div>
                            <Package className="mx-auto h-8 w-8 text-[#d6ad79]" />
                            <h4 className="mt-4 font-semibold text-[#fff8f0]">Plano de corte indisponível</h4>
                            <p className="mt-2 text-xs text-[#bba890]">Extraia peças do PDF primeiro para estimar chapa.</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right: Calculations parameters */}
                    <aside className="rounded-xl border border-[#e8d4b8]/10 bg-[#211811]/50 p-5 space-y-6">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-[#d6ad79]" />
                        <h3 className="font-semibold tracking-tight text-[#fff8f0]">
                          Parâmetros de Venda
                        </h3>
                      </div>

                      {/* Display final price */}
                      <div className="rounded-xl bg-[#d6ad79]/10 border border-[#d6ad79]/20 p-5 text-center">
                        <div className="text-sm font-bold text-[#ead5ba] uppercase tracking-wider">Preço Final Estimado</div>
                        <div className="text-3xl font-bold text-[#fff8f0] mt-2">
                          {budget ? `R$ ${budget.finalPrice.toLocaleString('pt-BR')}` : 'R$ ---'}
                        </div>
                        {budget && (
                          <div className="text-xs text-[#cdbca7] mt-2 space-y-1">
                            <div>Chapas MDF: {budget.totalMdfSheets} un</div>
                            <div>Custo ferragem: R$ {budget.totalHardwareCost.toFixed(2)}</div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-[#bba890] block mb-1">Markup (x)</label>
                            <input
                              type="number"
                              step="0.05"
                              value={markup}
                              onChange={(e) => setMarkup(parseFloat(e.target.value) || 1)}
                              className="w-full rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-3 py-2 text-[#fff8f0] outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-[#bba890] block mb-1">Margem Lucro (%)</label>
                            <input
                              type="number"
                              value={margin}
                              onChange={(e) => setMargin(parseFloat(e.target.value) || 0)}
                              className="w-full rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-3 py-2 text-[#fff8f0] outline-none"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-xs text-[#bba890] block mb-1">Comissão (%)</label>
                            <input
                              type="number"
                              value={commission}
                              onChange={(e) => setCommission(parseFloat(e.target.value) || 0)}
                              className="w-full rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-3 py-1.5 text-xs text-[#fff8f0] outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-[#bba890] block mb-1">Imposto (%)</label>
                            <input
                              type="number"
                              value={taxPercent}
                              onChange={(e) => setTaxPercent(parseFloat(e.target.value) || 0)}
                              className="w-full rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-3 py-1.5 text-xs text-[#fff8f0] outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-[#bba890] block mb-1">Perda (%)</label>
                            <input
                              type="number"
                              value={wastePercent}
                              onChange={(e) => setWastePercent(parseFloat(e.target.value) || 0)}
                              className="w-full rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-3 py-1.5 text-xs text-[#fff8f0] outline-none"
                            />
                          </div>
                        </div>

                        <button
                          disabled={calculating || !selectedItems.length}
                          onClick={calculateBudget}
                          className="w-full rounded-xl bg-[#ead5ba] px-4 py-3 text-sm font-bold text-[#20170f] transition hover:bg-[#ffe4bf] disabled:opacity-50"
                        >
                          {calculating ? "Calculando..." : "Gerar Orçamento"}
                        </button>
                      </div>
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

"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// ── Paleta de materiais → cor base (hex) ──────────────────────────────────────
const PALETTE: { m: string[]; hex: number }[] = [
  { m: ["preto trama", "preto", "grafite"], hex: 0x2b2622 },
  { m: ["beton", "concreto", "cimento", "cinza"], hex: 0x8f867a },
  { m: ["truffel", "tabaco", "conhaque", "chocolate", "marrom", "cafe", "café"], hex: 0x5b4634 },
  { m: ["freij", "carval", "nogueira", "cinamomo", "ripado", "natural", "madeira"], hex: 0x8a5a34 },
  { m: ["canela", "tamarindo", "mel", "avela", "avelã"], hex: 0xa06a3a },
  { m: ["areia", "linho", "fendi", "cru", "off", "camur"], hex: 0xc9b590 },
  { m: ["branco", "white", "neve", "gelo"], hex: 0xe7e1d6 },
  { m: ["rosa", "sal", "nude", "blush"], hex: 0xc9a79b },
  { m: ["granito preto", "preto absoluto"], hex: 0x1c1c1e },
  { m: ["granito", "silestone", "quartzo", "marmore", "mármore", "pedra"], hex: 0xd8d4cc },
  { m: ["couro", "leather", "suede", "suedi"], hex: 0x6b4a2f },
];
function baseHex(name?: string): number {
  const n = (name || "").toLowerCase();
  for (const p of PALETTE) if (p.m.some((k) => n.includes(k))) return p.hex;
  return 0x8c6c50;
}
type Cat = "mdf" | "glass" | "mirror" | "metal" | "stone" | "led" | "fabric";
function categoryOf(materialName?: string, compType?: string): Cat {
  const n = `${materialName || ""} ${compType || ""}`.toLowerCase();
  if (/espelho|mirror/.test(n)) return "mirror";
  if (/vidro|reflecta|fum|glass|cristal/.test(n)) return "glass";
  if (/metalon|metal|inox|alum|aço|aco/.test(n)) return "metal";
  if (/granito|silestone|quartzo|marmore|mármore|pedra|porcelanato/.test(n)) return "stone";
  if (/led/.test(n)) return "led";
  if (/couro|suede|suedi|tecido|veludo/.test(n)) return "fabric";
  return "mdf";
}
function makeMaterial(materialName?: string, compType?: string): THREE.Material {
  const cat = categoryOf(materialName, compType);
  const hex = baseHex(materialName);
  switch (cat) {
    case "glass":
      return new THREE.MeshPhysicalMaterial({ color: 0x9fb6c2, transmission: 0.92, transparent: true, opacity: 0.4, roughness: 0.08, metalness: 0, thickness: 6, ior: 1.5, side: THREE.DoubleSide });
    case "mirror":
      return new THREE.MeshStandardMaterial({ color: 0xdfe8ec, metalness: 1, roughness: 0.03, envMapIntensity: 1.4 });
    case "metal":
      return new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.92, roughness: 0.32, envMapIntensity: 1.1 });
    case "stone":
      return new THREE.MeshStandardMaterial({ color: hex, metalness: 0.12, roughness: 0.22, envMapIntensity: 0.8 });
    case "led":
      return new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffcf7a, emissiveIntensity: 1.8, roughness: 0.5 });
    case "fabric":
      return new THREE.MeshStandardMaterial({ color: hex, metalness: 0, roughness: 0.95 });
    default:
      return new THREE.MeshStandardMaterial({ color: hex, metalness: 0.02, roughness: 0.72 });
  }
}
const HANDLE_MAT = new THREE.MeshStandardMaterial({ color: 0xcfc8bb, metalness: 0.85, roughness: 0.3 });

const S = 0.001; // mm → m
function box(w: number, h: number, d: number, mat: THREE.Material) {
  const g = new THREE.BoxGeometry(Math.max(w, 1) * S, Math.max(h, 1) * S, Math.max(d, 1) * S);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ── Constrói um móvel do Digital Twin como um THREE.Group ─────────────────────
function buildFurniture(f: any): THREE.Group {
  const group = new THREE.Group();
  const W = f.dimensions?.width || 800;
  const H = f.dimensions?.height || 800;
  const D = f.dimensions?.depth || 500;
  const type = (f.type || "").toLowerCase();
  const bodyMat = makeMaterial(f.material, type);
  const t = 18;

  const addAt = (mesh: THREE.Mesh, x: number, y: number, z: number, cat: Cat = "mdf") => {
    mesh.position.set(x * S, y * S, z * S);
    mesh.userData.cat = cat;
    group.add(mesh);
    return mesh;
  };

  const isCabinet = ["guarda_roupa", "armario_inferior", "aereo", "estante", "balcao", "mesa"].includes(type);
  const comps: any[] = f.components || [];

  if (type === "bancada") {
    // Tampo de pedra + saia frontal + rodapia traseiro
    addAt(box(W, 30, D, bodyMat), 0, H - 15, 0, "stone");
    addAt(box(W, 200, t, makeMaterial(f.material, "saia")), 0, H - 100, D / 2 - t / 2, "stone");
    addAt(box(W, 200, t, bodyMat), 0, H + 100, -D / 2 + t / 2, "stone");
  } else if (type === "cama") {
    addAt(box(W, 120, D, bodyMat), 0, 60, 0, "mdf"); // estrado
    const mat = new THREE.MeshStandardMaterial({ color: 0xf0ece3, roughness: 0.9 });
    addAt(box(W - 60, 180, D - 60, mat), 0, 240, 0, "fabric"); // colchão
  } else if (type === "espelho") {
    addAt(box(W, H, Math.max(D, 20), makeMaterial(f.material, "espelho")), 0, H / 2, 0, "mirror");
  } else if (type === "painel" || type === "cabeceira" || type === "nicho") {
    addAt(box(W, H, Math.max(D, t), bodyMat), 0, H / 2, 0, categoryOf(f.material, type));
  } else if (isCabinet) {
    // Caixa oca: 2 laterais, base, tampo, fundo
    addAt(box(t, H, D, bodyMat), -W / 2 + t / 2, H / 2, 0);
    addAt(box(t, H, D, bodyMat), W / 2 - t / 2, H / 2, 0);
    addAt(box(W - 2 * t, t, D, bodyMat), 0, t / 2, 0);
    addAt(box(W - 2 * t, t, D, bodyMat), 0, H - t / 2, 0);
    addAt(box(W - 2 * t, H - 2 * t, 6, makeMaterial(f.material, "fundo")), 0, H / 2, -D / 2 + 3);
  } else {
    addAt(box(W, H, D, bodyMat), 0, H / 2, 0);
  }

  // Prateleiras internas
  const shelves = comps.filter((c) => (c.type || "").includes("prateleira"));
  const nShelf = shelves.reduce((s, c) => s + (c.qty || 1), 0);
  for (let i = 0; i < nShelf; i++) {
    const y = (H / (nShelf + 1)) * (i + 1);
    addAt(box(W - 2 * t, t, D - 30, bodyMat), 0, y, 0);
  }

  // Gavetas empilhadas na frente inferior
  const drawers = comps.filter((c) => /gaveta/.test(c.type || ""));
  const nDraw = drawers.reduce((s, c) => s + (c.qty || 1), 0);
  const drawH = drawers[0]?.height || 180;
  for (let i = 0; i < nDraw; i++) {
    const y = drawH / 2 + i * drawH + 20;
    const dg = new THREE.Group();
    dg.userData.kind = "drawer";
    const front = box(W - 40, drawH - 12, t, bodyMat);
    front.position.set(0, y * S, (D / 2) * S);
    front.userData.cat = "mdf";
    dg.add(front);
    const handle = box(Math.min((W - 40) * 0.4, 300), 22, 16, HANDLE_MAT);
    handle.position.set(0, (y + drawH / 2 - 30) * S, (D / 2 + 18) * S);
    handle.userData.cat = "hardware";
    dg.add(handle);
    dg.userData.slideAxis = "z";
    group.add(dg);
  }

  // Portas distribuídas na frente (acima das gavetas)
  const doors = comps.filter((c) => /porta/.test(c.type || ""));
  const doorLeaves: any[] = [];
  doors.forEach((dr) => { for (let k = 0; k < (dr.qty || 1); k++) doorLeaves.push(dr); });
  if (doorLeaves.length) {
    const drawerZoneH = nDraw * drawH + (nDraw ? 20 : 0);
    const doorAreaBottom = drawerZoneH;
    const leafW = W / doorLeaves.length;
    doorLeaves.forEach((dr, idx) => {
      const dh = Math.min(dr.height || H - drawerZoneH, H - drawerZoneH);
      const dw = Math.min(dr.width || leafW, leafW) - 6;
      const cx = -W / 2 + leafW * idx + leafW / 2;
      const cy = doorAreaBottom + dh / 2;
      const opening = (dr.opening || "").toLowerCase();
      const glass = categoryOf(dr.material) === "glass" || categoryOf(dr.material) === "mirror";
      const dmat = makeMaterial(dr.material || f.material, dr.type);

      const pivot = new THREE.Group();
      const sliding = opening.includes("correr") || opening.includes("desliza");
      const leftHinge = opening.includes("esquerda") || (!opening.includes("direita") && idx % 2 === 0);

      if (sliding) {
        pivot.userData.kind = "door-correr";
        pivot.userData.dir = idx % 2 === 0 ? 1 : -1;
        pivot.userData.travel = dw;
        const zL = (D / 2 + (idx % 2 === 0 ? 20 : 40));
        const leaf = box(dw, dh, dr.depth || 18, dmat);
        leaf.position.set(cx * S, cy * S, zL * S);
        leaf.userData.cat = glass ? "glass" : "mdf";
        pivot.add(leaf);
      } else {
        pivot.userData.kind = "door-giro";
        const hingeX = leftHinge ? cx - dw / 2 : cx + dw / 2;
        pivot.position.set(hingeX * S, 0, (D / 2) * S);
        pivot.userData.sign = leftHinge ? 1 : -1;
        const leaf = box(dw, dh, dr.depth || 18, dmat);
        leaf.position.set((leftHinge ? dw / 2 : -dw / 2) * S, cy * S, 0);
        leaf.userData.cat = glass ? "glass" : "mdf";
        pivot.add(leaf);
        if (!glass) {
          const handle = box(20, Math.min(dh * 0.5, 900), 16, HANDLE_MAT);
          handle.position.set((leftHinge ? dw - 26 : -dw + 26) * S, cy * S, 18 * S);
          handle.userData.cat = "hardware";
          pivot.add(handle);
        }
      }
      group.add(pivot);
    });
  }

  // Tampo / cuba / led / metalon extras
  comps.forEach((c) => {
    const ct = (c.type || "").toLowerCase();
    if (ct === "tampo") addAt(box(c.width || W, c.height || 30, c.depth || D, makeMaterial(c.material || f.material, "tampo")), 0, H + 15, 0, categoryOf(c.material, "tampo"));
    if (ct === "cuba" || ct === "pia") addAt(box(c.width || 400, c.height || 150, c.depth || 350, new THREE.MeshStandardMaterial({ color: 0xf3f3f0, roughness: 0.2, metalness: 0.1 })), 0, H - (c.height || 150) / 2, 0, "stone");
    if (ct === "led") addAt(box(c.width || W - 40, 20, 20, makeMaterial(undefined, "led")), 0, 10, D / 2 - 20, "led");
    if (ct === "metalon" || ct === "perfil") addAt(box(c.width || 30, c.height || H, c.depth || 30, makeMaterial("metalon", "metalon")), -W / 2 + 20, (c.height || H) / 2, 0, "metal");
  });

  return group;
}

interface Props {
  project: any;
  fallbackItems?: any[];
}

export default function ThreeViewer({ project }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<any>({});
  const [ready, setReady] = useState(false);
  const [envFilter, setEnvFilter] = useState<string>("all");
  const [furnitureFilter, setFurnitureFilter] = useState<string>("all");
  const [doorOpen, setDoorOpen] = useState(0);
  const [explode, setExplode] = useState(0);
  const [isolate, setIsolate] = useState<string>("all");
  const [sectionOn, setSectionOn] = useState(false);
  const [sectionPos, setSectionPos] = useState(0.5);

  const twin = project?.digitalTwin;
  const environments: string[] = useMemo(
    () => (twin?.environments || []).map((e: any) => e.name),
    [twin],
  );
  const furnitureList: { id: string; name: string; env: string }[] = useMemo(() => {
    const list: { id: string; name: string; env: string }[] = [];
    (twin?.environments || []).forEach((env: any) => {
      (env.furnitures || []).forEach((f: any) => {
        if (envFilter === "all" || env.name === envFilter) {
          list.push({ id: f.id || f.name, name: f.name || f.id || 'Móvel', env: env.name });
        }
      });
    });
    return list;
  }, [twin, envFilter]);
  const stats = twin?.audit?.stats;
  const warnings: string[] = twin?.audit?.warnings || [];

  // Init da cena
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !twin) return;
    const width = mount.clientWidth || 760;
    const height = 520;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0907);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // Luzes
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2018, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 60;
    (key.shadow.camera as THREE.OrthographicCamera).left = -15;
    (key.shadow.camera as THREE.OrthographicCamera).right = 15;
    (key.shadow.camera as THREE.OrthographicCamera).top = 15;
    (key.shadow.camera as THREE.OrthographicCamera).bottom = -15;
    scene.add(key);
    scene.add(new THREE.DirectionalLight(0xffffff, 0.5).translateX(-6));

    const root = new THREE.Group();
    scene.add(root);

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

    stateRef.current = { scene, renderer, camera, controls, root, pmrem, clipPlane, mount };

    // Chão
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();
    setReady(true);

    const onResize = () => {
      const w = mount.clientWidth || 760;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      pmrem.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [twin, project?.id]);

  // (Re)constrói os móveis quando muda o ambiente
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.root || !twin) return;
    const { root, camera, controls } = st;
    while (root.children.length) root.remove(root.children[0]);

    const envs = (twin.environments || []).filter((e: any) => envFilter === "all" || e.name === envFilter);
    envs.forEach((env: any) => {
      (env.furnitures || []).forEach((f: any) => {
        const fId = f.id || f.name;
        if (furnitureFilter !== "all" && fId !== furnitureFilter) return;
        const g = buildFurniture(f);
        g.userData.furnitureId = fId;
        g.userData.furnitureName = f.name || f.id || 'Móvel';
        const p = f.position || {};
        g.position.set((p.x || 0) * S, (p.y || 0) * S, (p.z || 0) * S);
        g.rotation.y = ((f.rotation?.y || 0) * Math.PI) / 180;
        root.add(g);
      });
    });

    // Enquadra a câmera no conteúdo
    const bbox = new THREE.Box3().setFromObject(root);
    if (!bbox.isEmpty()) {
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const dist = maxDim * 1.4 + 1;
      camera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist);
      camera.near = 0.01;
      camera.far = dist * 12;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    }
  }, [twin, envFilter, furnitureFilter]);

  // Aplica portas/gavetas, explosão e isolamento
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.root) return;
    st.root.traverse((obj: any) => {
      const k = obj.userData?.kind;
      if (k === "door-giro") obj.rotation.y = -obj.userData.sign * doorOpen * (Math.PI / 2);
      else if (k === "door-correr") obj.position.x = (obj.userData.dir * obj.userData.travel * doorOpen) * S;
      else if (k === "drawer") obj.position.z = doorOpen * 0.4;
      // explosão radial simples por grupo de móvel
      if (obj.parent === st.root && obj.type === "Group") {
        // nada aqui; explosão aplicada abaixo por componente
      }
    });
    // Isolamento por categoria
    st.root.traverse((obj: any) => {
      if (obj.isMesh) {
        const cat = obj.userData?.cat || "mdf";
        let visible = true;
        if (isolate === "mdf") visible = cat === "mdf";
        else if (isolate === "hardware") visible = cat === "hardware";
        else if (isolate === "glass") visible = cat === "glass" || cat === "mirror";
        else if (isolate === "metal") visible = cat === "metal";
        obj.visible = visible;
      }
    });
  }, [doorOpen, isolate, ready]);

  // Explosão: afasta cada móvel do centro
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.root) return;
    const center = new THREE.Box3().setFromObject(st.root).getCenter(new THREE.Vector3());
    st.root.children.forEach((g: any) => {
      if (!g.userData.basePos) g.userData.basePos = g.position.clone();
      const base = g.userData.basePos as THREE.Vector3;
      const dir = base.clone().sub(center).setY(0);
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
      dir.normalize();
      g.position.copy(base.clone().add(dir.multiplyScalar(explode * 2)));
    });
  }, [explode, ready, envFilter]);

  // Section plane (clipping)
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.renderer) return;
    const bbox = new THREE.Box3().setFromObject(st.root);
    const size = bbox.getSize(new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3());
    st.clipPlane.constant = center.z + (sectionPos - 0.5) * size.z;
    st.renderer.clippingPlanes = sectionOn ? [st.clipPlane] : [];
  }, [sectionOn, sectionPos, ready, envFilter]);

  const exportGLB = () => {
    const st = stateRef.current;
    if (!st?.root) return;
    new GLTFExporter().parse(
      st.root,
      (gltf) => {
        const blob = new Blob([gltf as ArrayBuffer], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${project?.name || "projeto"}.glb`;
        a.click();
        URL.revokeObjectURL(url);
      },
      (err) => console.error("GLB export error", err),
      { binary: true },
    );
  };

  if (!twin) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-2xl border border-[#e8d4b8]/10 bg-[#0b0907] text-center">
        <div>
          <h4 className="font-semibold text-[#fff8f0]">Digital Twin indisponível</h4>
          <p className="mt-2 max-w-xs text-xs text-[#bba890]">
            Reprocesse o PDF para gerar o modelo paramétrico (Ambiente → Móveis → Componentes).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
      <div className="relative overflow-hidden rounded-2xl border border-[#e8d4b8]/10 bg-[#0b0907]">
        <div ref={mountRef} className="h-[520px] w-full" />
        <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-[#e8d4b8]/12 bg-[#0b0907]/85 px-3.5 py-2.5 backdrop-blur">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#c89a63]">Digital Twin • Three.js</p>
          <p className="mt-0.5 text-sm font-semibold text-[#fff8f0]">{envFilter === "all" ? "Projeto completo" : envFilter}</p>
          {stats && (
            <p className="mt-0.5 text-[11px] text-[#8c7c68]">{stats.furnitures} móveis · {stats.components} componentes</p>
          )}
        </div>
        <button
          onClick={exportGLB}
          className="absolute bottom-4 right-4 rounded-lg border border-[#e8d4b8]/20 bg-[#211811]/90 px-3 py-1.5 text-xs font-bold text-[#ead5ba] hover:bg-[#382b20]"
        >
          Exportar GLB
        </button>
      </div>

      <aside className="space-y-4 rounded-xl border border-[#e8d4b8]/10 bg-[#211811]/50 p-5">
        <h3 className="font-semibold text-[#fff8f0]">Reconstrução paramétrica</h3>

        <div>
          <label className="mb-1.5 block text-xs text-[#bba890]">Ambiente</label>
          <select value={envFilter} onChange={(e) => { setEnvFilter(e.target.value); setFurnitureFilter("all"); }} className="w-full rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-3 py-2 text-xs text-[#fff8f0] outline-none">
            <option value="all">Projeto completo</option>
            {environments.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs text-[#bba890]">Móvel</label>
          <select value={furnitureFilter} onChange={(e) => setFurnitureFilter(e.target.value)} className="w-full rounded-lg border border-[#e8d4b8]/10 bg-[#18120d] px-3 py-2 text-xs text-[#fff8f0] outline-none">
            <option value="all">Todos os móveis</option>
            {furnitureList.map((f) => <option key={f.id} value={f.id}>{f.name}{envFilter === "all" ? ` (${f.env})` : ''}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs text-[#bba890]">Isolar</label>
          <div className="grid grid-cols-3 gap-1">
            {[
              { v: "all", l: "Tudo" }, { v: "mdf", l: "MDF" }, { v: "hardware", l: "Ferragens" },
              { v: "glass", l: "Vidros" }, { v: "metal", l: "Metal" },
            ].map((o) => (
              <button key={o.v} onClick={() => setIsolate(o.v)} className={`rounded-lg px-2 py-1.5 text-[10px] font-bold border transition ${isolate === o.v ? "bg-[#ead5ba] border-transparent text-[#20170f]" : "bg-[#18120d]/80 border-[#e8d4b8]/10 text-[#bba890] hover:text-[#ead5ba]"}`}>{o.l}</button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex justify-between text-xs font-semibold text-[#bba890]"><span>Abertura Portas/Gavetas</span><span>{Math.round(doorOpen * 100)}%</span></div>
          <input type="range" min={0} max={1} step={0.02} value={doorOpen} onChange={(e) => setDoorOpen(parseFloat(e.target.value))} className="w-full accent-[#fb923c]" />
        </div>

        <div>
          <div className="mb-1.5 flex justify-between text-xs font-semibold text-[#bba890]"><span>Vista Explodida</span><span>{Math.round(explode * 100)}%</span></div>
          <input type="range" min={0} max={1} step={0.02} value={explode} onChange={(e) => setExplode(parseFloat(e.target.value))} className="w-full accent-[#fb923c]" />
        </div>

        <div>
          <label className="flex items-center justify-between text-xs font-semibold text-[#bba890]">
            <span>Corte (Section)</span>
            <input type="checkbox" checked={sectionOn} onChange={(e) => setSectionOn(e.target.checked)} className="accent-[#fb923c]" />
          </label>
          {sectionOn && <input type="range" min={0} max={1} step={0.02} value={sectionPos} onChange={(e) => setSectionPos(parseFloat(e.target.value))} className="mt-2 w-full accent-[#fb923c]" />}
        </div>

        {warnings.length > 0 && (
          <div className="rounded-lg border border-[#fb923c]/25 bg-[#fb923c]/10 p-3 text-[11px] leading-5 text-[#fb923c]">
            <p className="mb-1 font-bold">Auditoria ({warnings.length})</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-[#e8d4b8]/10 bg-[#fff7ed]/[0.03] p-3 text-[11px] leading-5 text-[#bba890]">
          Arraste para girar · scroll para zoom · cada componente é um objeto real (mesh) — vidro tem transparência, metal/espelho refletem, LED emite luz.
        </div>
      </aside>
    </div>
  );
}

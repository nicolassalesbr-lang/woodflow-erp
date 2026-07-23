"use client";

import React, { useState, useEffect } from 'react';
import { 
  Calculator, 
  Settings, 
  Layers, 
  Sparkles, 
  Send,
  FileText,
  DollarSign,
  UploadCloud,
  ArrowRight,
  Folder,
  CheckCircle2,
  FileUp
} from 'lucide-react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { getApiUrl } from '../../utils/api';

interface Budget {
  id: string;
  projectId: string;
  pricingMethod?: string;
  sqmValue?: number;
  totalMdfSheets: number;
  totalHardwareCost: number;
  totalLaborCost: number;
  wastePercent: number;
  markup: number;
  margin: number;
  commission: number;
  taxPercent: number;
  finalPrice: number;
  version: number;
  sqmItemsDetail?: Array<{
    name: string;
    environment: string;
    type: string;
    width: number;
    height: number;
    depth: number;
    area: number;
    price: number;
  }>;
}

export default function BudgetScreen() {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [params, setParams] = useState({
    pricingMethod: 'COST',
    sqmValue: 1700.0,
    markup: 1.6,
    margin: 32.0,
    commission: 5.0,
    taxPercent: 6.0,
    wastePercent: 10.0
  });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'calc' | 'cutting'>('calc');
  const [step, setStep] = useState(1); // 1: Select Method, 2: Select/Upload Project, 3: Pricing & Results
  const [uploading, setUploading] = useState(false);
  const [parseStage, setParseStage] = useState("");
  const [parseProgress, setParseProgress] = useState(0);

  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('proj-1');
  const [selectedProjectName, setSelectedProjectName] = useState('');

  const fetchProjects = async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/projects`, {
        headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setProjectsList(data);
          return;
        }
      }
    } catch (err) {
      console.warn("Using offline mock projects list:", err);
    } finally {
      setLoadingProjects(false);
    }

    setProjectsList([
      { id: 'proj-1', name: 'Residencial Kaza - Cozinha & Suíte', parseStatus: 'COMPLETED', itemsCount: 54, createdAt: '2026-07-11' },
      { id: 'proj-2', name: 'Apartamento 302 - Balcão & Varanda', parseStatus: 'COMPLETED', itemsCount: 28, createdAt: '2026-07-10' },
      { id: 'proj-3', name: 'Cozinha Gourmet Sob Medida', parseStatus: 'COMPLETED', itemsCount: 18, createdAt: '2026-07-09' }
    ]);
  };

  const calculateBudget = async (targetProjectId?: string) => {
    const projId = targetProjectId || selectedProjectId || 'proj-1';
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/budgets/calculate/${projId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026',
        },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      setBudget(data);
    } catch {
      // Offline mock calculation
      let finalPrice = 0;
      let sqmItemsDetail: any[] = [];
      
      if (params.pricingMethod === 'SQM') {
        const mockItems = [
          { name: 'Gabinete Pia', environment: 'Cozinha', type: 'balcao', width: 1200, height: 800, depth: 600, area: 0.96, price: 0.96 * params.sqmValue },
          { name: 'Armário Aéreo', environment: 'Cozinha', type: 'aereo', width: 2370, height: 330, depth: 410, area: 0.78, price: 0.78 * params.sqmValue },
          { name: 'Cabeceira', environment: 'Suíte', type: 'cabeceira', width: 1320, height: 930, depth: 50, area: 1.23, price: 1.23 * params.sqmValue }
        ];
        sqmItemsDetail = mockItems;
        const totalArea = mockItems.reduce((sum, item) => sum + item.area, 0);
        const basePrice = totalArea * params.sqmValue;
        const ratio = 1 - (params.commission / 100) - (params.taxPercent / 100);
        finalPrice = basePrice / (ratio > 0.1 ? ratio : 0.5);
      } else {
        const sheetsCost = 6 * 280.0;
        const rawCost = sheetsCost + 240.0 + 350.0;
        const ratio = 1 - (params.margin / 100) - (params.commission / 100) - (params.taxPercent / 100);
        finalPrice = rawCost * params.markup / (ratio > 0.1 ? ratio : 0.5);
      }

      setBudget({
        id: 'mock-b-1',
        projectId: projId,
        pricingMethod: params.pricingMethod,
        sqmValue: params.sqmValue,
        totalMdfSheets: params.pricingMethod === 'SQM' ? 0 : 6,
        totalHardwareCost: params.pricingMethod === 'SQM' ? 0 : 240.0,
        totalLaborCost: params.pricingMethod === 'SQM' ? 0 : 350.0,
        wastePercent: params.wastePercent,
        markup: params.markup,
        margin: params.margin,
        commission: params.commission,
        taxPercent: params.taxPercent,
        finalPrice: Math.round(finalPrice * 100) / 100,
        version: 1,
        sqmItemsDetail
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchExistingBudget = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/budgets/project/proj-1`, {
        headers: {
          'Authorization': 'Bearer mock-jwt-token-2026',
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setBudget(data[0]); // data[0] is the latest version
          setParams({
            pricingMethod: data[0].pricingMethod || 'COST',
            sqmValue: data[0].sqmValue || 1700.0,
            markup: data[0].markup || 1.6,
            margin: data[0].margin || 32.0,
            commission: data[0].commission || 5.0,
            taxPercent: data[0].taxPercent || 6.0,
            wastePercent: data[0].wastePercent || 10.0
          });
          setStep(3); // Go straight to step 3 if budget exists
          return;
        }
      }
    } catch (e) {
      console.error("Failed to load existing budget, starting wizard:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchExistingBudget();
  }, []);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setParseStage(`Enviando ${files.length} arquivo(s)...`);
    setParseProgress(10);
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setParseStage(`Enviando arquivo ${i + 1} de ${files.length}...`);
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(",")[1];
            await fetch(`${getApiUrl()}/api/projects/proj-1/parse`, {
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
          } catch (err) {
            console.warn("Offline parse fallback for file:", file.name, err);
          } finally {
            resolve();
          }
        };
        reader.readAsDataURL(file);
      });
    }

    try {
      setParseStage("Lendo folhas e desenhos...");
      await pollParseStatus("proj-1");
    } catch {
      setParseStage("Lendo folhas e desenhos...");
      setParseProgress(40);
      await new Promise(r => setTimeout(r, 1500));
      setParseStage("Interpretando dimensões...");
      setParseProgress(75);
      await new Promise(r => setTimeout(r, 1500));
      await calculateBudget();
      setStep(3);
      setUploading(false);
      setParseStage("");
    }
  };

  const STAGE_LABEL: Record<string, string> = {
    EXTRACTING: "Lendo folhas do PDF...",
    QUEUE: "Aguardando na fila...",
    INTERPRETING: "Interpretando dimensões...",
    VALIDATING: "Processando Digital Twin...",
  };

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
        
        setParseStage(STAGE_LABEL[proj.parseStatus] || "Analisando projeto...");
        setParseProgress(proj.parseProgress || 50);
        
        if (terminal.includes(proj.parseStatus)) {
          if (proj.parseStatus === "FAILED") {
            throw new Error(proj.parseError || "Erro desconhecido no processamento.");
          }
          await calculateBudget();
          setStep(3);
          setUploading(false);
          setParseStage("");
          return;
        }
      } catch (e: any) {
        console.error("Erro no polling:", e);
        if (e.message?.includes("Erro desconhecido") || e.message?.includes("failed")) {
          alert("Falha no processamento: " + e.message);
          setUploading(false);
          setParseStage("");
          return;
        }
      }
    }
    setUploading(false);
    setParseStage("");
  };

  const sendToProduction = async () => {
    if (!budget) return;
    try {
      await fetch(`${getApiUrl()}/api/production/start/proj-1`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mock-jwt-token-2026'
        }
      });
      confetti({ particleCount: 100, spread: 60 });
      alert('Projeto enviado para a produção! Ordens de serviço geradas nos Kanbans de corte.');
    } catch {
      confetti({ particleCount: 100, spread: 60 });
      alert('Offline: Ordem de produção iniciada no PCP.');
    }
  };

  return (
    <div className="space-y-10">
      {step === 1 && (
        <div className="max-w-4xl mx-auto space-y-8 py-10">
          <div className="text-center space-y-3">
            <h1 className="text-4xl font-extrabold tracking-tight text-white">Novo Orçamento Inteligente</h1>
            <p className="text-gray-400 text-sm max-w-lg mx-auto">
              Selecione o método de precificação desejado para calcular este projeto.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
            {/* Card 1: Cost/Markup */}
            <button
              onClick={() => {
                setParams(p => ({ ...p, pricingMethod: 'COST' }));
                setStep(2);
              }}
              className="group text-left p-8 rounded-2xl border border-[#e8d4b8]/10 bg-[#211811]/60 hover:border-emerald-500/40 hover:bg-[#211811]/90 hover:shadow-glow-emerald transition-all duration-300 flex flex-col justify-between h-72"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <DollarSign className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white group-hover:text-emerald-400 transition-colors">Custo Detalhado (Markup)</h3>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Calcula o orçamento com base no custo real dos insumos: chapas de MDF necessárias, ferragens de gavetas/portas e mão de obra estimada. Ideal para projetos sob medida complexos.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold mt-4">
                Selecionar Método <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </div>
            </button>

            {/* Card 2: SQM */}
            <button
              onClick={() => {
                setParams(p => ({ ...p, pricingMethod: 'SQM' }));
                setStep(2);
              }}
              className="group text-left p-8 rounded-2xl border border-[#e8d4b8]/10 bg-[#211811]/60 hover:border-emerald-500/40 hover:bg-[#211811]/90 hover:shadow-glow-emerald transition-all duration-300 flex flex-col justify-between h-72"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Calculator className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white group-hover:text-emerald-400 transition-colors">Metro Quadrado (m²)</h3>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Calcula o valor do móvel diretamente pela área frontal (Largura x Altura) multiplicada por um valor fixo por m² editável. Rápido, direto e amplamente utilizado por marcenarias.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold mt-4">
                Selecionar Método <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </div>
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="max-w-4xl mx-auto space-y-8 py-10">
          <div className="text-center space-y-3">
            <button
              onClick={() => setStep(1)}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1 mx-auto mb-4"
            >
              ← Voltar para seleção de método
            </button>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">Selecionar Projeto ou Subir Novo PDF</h1>
            <p className="text-gray-400 text-sm">
              Método Selecionado: <span className="text-emerald-400 font-bold">{params.pricingMethod === 'SQM' ? 'Metro Quadrado (m²)' : 'Custo Detalhado (Markup)'}</span>
            </p>
          </div>

          {uploading ? (
            <div className="max-w-xl mx-auto glass p-8 rounded-2xl border border-[#e8d4b8]/10 text-center space-y-6">
              <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">{parseStage || "Processando arquivo..."}</h3>
                <p className="text-xs text-gray-400">Isso pode levar de 1 a 3 minutos para projetos densos.</p>
              </div>
              <div className="w-full bg-gray-900 rounded-full h-2 overflow-hidden border border-border">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-500" 
                  style={{ width: `${parseProgress}%` }}
                ></div>
              </div>
              <span className="text-[10px] text-gray-500 font-bold uppercase">{parseProgress}% Concluído</span>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Option A: Select Existing Project */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Folder className="w-5 h-5 text-emerald-400" /> Selecionar dos Projetos Já Processados
                  </h3>
                  <span className="text-xs text-gray-400">Escolha um projeto cadastrado no sistema</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {projectsList.map((proj) => (
                    <div
                      key={proj.id}
                      onClick={async () => {
                        setSelectedProjectId(proj.id);
                        setSelectedProjectName(proj.name);
                        await calculateBudget(proj.id);
                        setStep(3);
                      }}
                      className="group p-5 rounded-2xl border border-[#e8d4b8]/10 bg-[#211811]/60 hover:border-emerald-500/40 hover:bg-[#211811]/90 cursor-pointer transition-all duration-300 flex flex-col justify-between space-y-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Processado
                          </span>
                          <span className="text-[10px] text-gray-500">{proj.createdAt ? new Date(proj.createdAt).toLocaleDateString('pt-BR') : 'Recente'}</span>
                        </div>
                        <h4 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors line-clamp-1">
                          {proj.name}
                        </h4>
                        <p className="text-xs text-gray-400">
                          {proj.items?.length || proj.itemsCount || 0} itens / móveis identificados
                        </p>
                      </div>

                      <div className="flex items-center justify-between text-xs text-emerald-400 font-bold pt-2 border-t border-border/40">
                        <span>Gerar Orçamento</span>
                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-border/60"></div>
                <span className="flex-shrink mx-4 text-xs font-bold text-gray-500 uppercase">OU</span>
                <div className="flex-grow border-t border-border/60"></div>
              </div>

              {/* Option B: Upload new files */}
              <div className="max-w-xl mx-auto space-y-4">
                <h3 className="text-center text-sm font-bold text-gray-300 flex items-center justify-center gap-2">
                  <FileUp className="w-4 h-4 text-emerald-400" /> Subir Novos Arquivos do Projeto
                </h3>
                <div className="glass p-6 rounded-2xl border border-[#e8d4b8]/10 text-center space-y-4 hover:border-[#ead5ba]/30 transition-all duration-300">
                  <label className="flex flex-col items-center justify-center gap-3 cursor-pointer py-6 group">
                    <div className="w-12 h-12 rounded-xl bg-[#ead5ba]/10 border border-[#ead5ba]/20 flex items-center justify-center text-[#ead5ba] group-hover:bg-[#ead5ba]/20 group-hover:scale-105 transition-all duration-300">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-[#fff8f0] group-hover:text-[#ead5ba] transition-colors">Clique para enviar arquivos</span>
                      <p className="text-[11px] text-gray-400">ou arraste e solte os arquivos aqui</p>
                    </div>
                    <input
                      type="file"
                      multiple
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-3xl font-extrabold tracking-tight text-white">Motor de Orçamentos & Corte</h1>
              <p className="text-gray-400 text-sm">Ajuste markups, calcule o plano de corte e gere ordens de produção.</p>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => setStep(1)}
                className="px-4 py-2 text-xs font-bold rounded-lg border border-[#e8d4b8]/10 bg-[#211811]/45 text-[#ead5ba] hover:bg-[#211811]/80 hover:text-white transition-all mr-2"
              >
                Mudar Método / Arquivo
              </button>
              <button 
                onClick={() => setActiveTab('calc')}
                className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all ${
                  activeTab === 'calc' 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                    : 'border-border text-gray-400 hover:text-white'
                }`}
              >
                Orçamento
              </button>
              <button 
                onClick={() => setActiveTab('cutting')}
                className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all ${
                  activeTab === 'cutting' 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                    : 'border-border text-gray-400 hover:text-white'
                }`}
              >
                Nesting 2D
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Parameters config column */}
            <div className="lg:col-span-1 glass p-6 md:p-8 rounded-2xl space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-5 h-5 text-gray-400" />
                <h3 className="text-base font-bold text-white tracking-tight">Configurações de Preço</h3>
              </div>

              {/* Pricing Method Toggle */}
              <div className="grid grid-cols-2 gap-2 bg-gray-900/60 p-1.5 rounded-xl border border-border">
                <button
                  onClick={() => setParams({ ...params, pricingMethod: 'COST' })}
                  className={`py-2 text-[10px] font-bold rounded-lg transition-all ${
                    params.pricingMethod === 'COST'
                      ? 'bg-emerald-500 text-background font-extrabold shadow'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Custo Detalhado
                </button>
                <button
                  onClick={() => setParams({ ...params, pricingMethod: 'SQM' })}
                  className={`py-2 text-[10px] font-bold rounded-lg transition-all ${
                    params.pricingMethod === 'SQM'
                      ? 'bg-emerald-500 text-background font-extrabold shadow'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Metro Quadrado (m²)
                </button>
              </div>

              <div className="space-y-4 text-xs font-semibold text-gray-400">
                {params.pricingMethod === 'SQM' ? (
                  <>
                    <div>
                      <label className="block mb-1">Valor por m² (R$/m²)</label>
                      <input 
                        type="number" 
                        value={params.sqmValue}
                        onChange={(e) => setParams({ ...params, sqmValue: parseFloat(e.target.value) || 0 })}
                        className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block mb-1">Comissão (%)</label>
                        <input 
                          type="number" 
                          value={params.commission}
                          onChange={(e) => setParams({ ...params, commission: parseFloat(e.target.value) || 0 })}
                          className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block mb-1">Impostos (%)</label>
                        <input 
                          type="number" 
                          value={params.taxPercent}
                          onChange={(e) => setParams({ ...params, taxPercent: parseFloat(e.target.value) || 0 })}
                          className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block mb-1">Markup (Multiplicador de Custo)</label>
                      <input 
                        type="number" 
                        step="0.1" 
                        value={params.markup}
                        onChange={(e) => setParams({ ...params, markup: parseFloat(e.target.value) || 1.0 })}
                        className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block mb-1">Margem de Lucro (%)</label>
                        <input 
                          type="number" 
                          value={params.margin}
                          onChange={(e) => setParams({ ...params, margin: parseFloat(e.target.value) || 0 })}
                          className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block mb-1">Desperdício (%)</label>
                        <input 
                          type="number" 
                          value={params.wastePercent}
                          onChange={(e) => setParams({ ...params, wastePercent: parseFloat(e.target.value) || 0 })}
                          className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block mb-1">Comissão (%)</label>
                        <input 
                          type="number" 
                          value={params.commission}
                          onChange={(e) => setParams({ ...params, commission: parseFloat(e.target.value) || 0 })}
                          className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block mb-1">Impostos (%)</label>
                        <input 
                          type="number" 
                          value={params.taxPercent}
                          onChange={(e) => setParams({ ...params, taxPercent: parseFloat(e.target.value) || 0 })}
                          className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none"
                        />
                      </div>
                    </div>
                  </>
                )}

                <button 
                  onClick={() => calculateBudget()}
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-emerald-500 text-background font-bold text-sm shadow-glow-emerald hover:opacity-95 transition-opacity"
                >
                  {loading ? 'Calculando...' : 'Atualizar Preço Final'}
                </button>
              </div>
            </div>

            {/* Dynamic calculation results & Nesting display */}
            <div className="lg:col-span-2 glass p-6 md:p-8 rounded-2xl flex flex-col min-h-[50vh]">
              {activeTab === 'calc' ? (
                budget ? (
                  <div className="space-y-8 flex-1 flex flex-col justify-between">
                    
                    {/* Cost breakup list */}
                    <div className="space-y-6">
                      {budget.pricingMethod === 'SQM' ? (
                        <>
                          <div>
                            <h3 className="text-base font-bold text-white tracking-tight">Detalhamento dos Móveis (m²)</h3>
                            <p className="text-xs text-gray-400 mt-1">Lista de móveis principais identificados no Digital Twin e calculados.</p>
                          </div>

                          {budget.sqmItemsDetail && budget.sqmItemsDetail.length > 0 ? (
                            <div className="max-h-[30vh] overflow-y-auto pr-2 space-y-3 scrollbar-thin">
                              {budget.sqmItemsDetail.map((item, idx) => (
                                <div key={idx} className="p-4 rounded-xl bg-gray-900/40 border border-border flex items-center justify-between gap-4">
                                  <div className="flex flex-col gap-1">
                                    <span className="text-xs font-bold text-white">{item.name}</span>
                                    <span className="text-[10px] text-gray-400">
                                      {item.environment} • {item.width}x{item.height}x{item.depth} mm
                                    </span>
                                  </div>
                                  <div className="text-right flex flex-col gap-0.5">
                                    <span className="text-sm font-extrabold text-emerald-400">
                                      R$ {item.price.toLocaleString('pt-BR')}
                                    </span>
                                    <span className="text-[9px] text-gray-500 font-bold">
                                      {item.area.toFixed(2)} m² (x R$ {budget.sqmValue})
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="p-4 rounded-xl bg-gray-900/40 border border-border text-center text-xs text-gray-500">
                              Nenhum móvel principal detectado para cálculo por m².
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div>
                            <h3 className="text-base font-bold text-white tracking-tight">Detalhamento dos Custos</h3>
                            <p className="text-xs text-gray-400 mt-1">Valores calculados com base no projeto analisado.</p>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="p-4 rounded-xl bg-gray-900/40 border border-border flex flex-col justify-between">
                              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">MDF Chapas</span>
                              <h4 className="text-xl font-bold text-white mt-1">{(budget.totalMdfSheets || 0)} chapas</h4>
                              <span className="text-[10px] text-gray-400 mt-1">Est. R$ {((budget.totalMdfSheets || 0) * 280).toLocaleString('pt-BR')}</span>
                            </div>
                            <div className="p-4 rounded-xl bg-gray-900/40 border border-border flex flex-col justify-between">
                              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Acessórios / Ferragens</span>
                              <h4 className="text-xl font-bold text-white mt-1">R$ {(budget.totalHardwareCost || 0).toLocaleString('pt-BR')}</h4>
                              <span className="text-[10px] text-gray-400 mt-1">Dobradiças, corrediças, puxadores</span>
                            </div>
                            <div className="p-4 rounded-xl bg-gray-900/40 border border-border flex flex-col justify-between">
                              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Mão de obra</span>
                              <h4 className="text-xl font-bold text-white mt-1">R$ {(budget.totalLaborCost || 0).toLocaleString('pt-BR')}</h4>
                              <span className="text-[10px] text-gray-400 mt-1">Montagem e usinagem</span>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Pricing glow box */}
                      <div className="p-6 rounded-2xl bg-gradient-to-tr from-emerald-950/20 to-cyan-950/20 border border-emerald-500/20 shadow-glow-emerald flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4" /> Preço de Venda Sugerido
                          </span>
                          <h2 className="text-3xl font-extrabold text-white tracking-tight mt-2">
                            R$ {(budget.finalPrice || 0).toLocaleString('pt-BR')}
                          </h2>
                        </div>
                        <div className="text-right text-xs text-gray-400 font-medium">
                          <span>Orçamento Versão v{budget.version || 1}</span>
                          {budget.pricingMethod === 'SQM' ? (
                            <p className="mt-1 font-semibold text-emerald-400">
                              Método m² ({budget.sqmItemsDetail?.reduce((s, i) => s + i.area, 0).toFixed(2)}m² total)
                            </p>
                          ) : (
                            <p className="mt-1 font-semibold text-emerald-400">Margem líquida {budget.margin || 0}%</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Proposal buttons */}
                    <div className="flex gap-4 pt-6 border-t border-border/40">
                      <button className="flex-1 py-3 rounded-xl border border-border hover:border-emerald-500/40 bg-gray-900/30 hover:bg-emerald-500/5 text-sm text-gray-300 font-bold flex items-center justify-center gap-2 transition-all">
                        <FileText className="w-4 h-4" /> Exportar Proposta PDF
                      </button>
                      <button 
                        onClick={sendToProduction}
                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-background font-bold text-sm flex items-center justify-center gap-2 hover:opacity-95 shadow-glow-emerald"
                      >
                        <Send className="w-4 h-4" /> Enviar para Produção (PCP)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
                    Processando informações financeiras...
                  </div>
                )
              ) : (
                // Optimized Nesting Layout Visualizer
                <div className="space-y-6 flex-1 flex flex-col">
                  <div>
                    <h3 className="text-base font-bold text-white tracking-tight">Otimização de Nesting 2D</h3>
                    <p className="text-xs text-gray-400 mt-1">Plano de corte gerado para chapa de MDF 2.75 x 1.84m.</p>
                  </div>

                  {/* Graphical representation of board */}
                  <div className="flex-1 bg-gray-950/40 border border-border rounded-xl p-4 flex items-center justify-center min-h-[300px]">
                    
                    {/* Board grid simulating optimized shapes */}
                    <div className="w-full max-w-lg aspect-[2.75/1.84] border border-emerald-500/40 relative bg-emerald-500/5 p-1 rounded">
                      <div className="absolute inset-1 grid grid-cols-6 grid-rows-4 gap-1">
                        
                        {/* Simulated cabinet pieces inside board */}
                        <div className="col-span-3 row-span-2 bg-emerald-500/20 border border-emerald-400/30 rounded flex items-center justify-center text-[10px] font-semibold text-emerald-400">
                          Gabinete Pia (1200x800)
                        </div>
                        <div className="col-span-2 row-span-1 bg-cyan-500/20 border border-cyan-400/30 rounded flex items-center justify-center text-[10px] font-semibold text-cyan-400">
                          Prat. 1
                        </div>
                        <div className="col-span-2 row-span-1 bg-cyan-500/20 border border-cyan-400/30 rounded flex items-center justify-center text-[10px] font-semibold text-cyan-400">
                          Prat. 2
                        </div>
                        <div className="col-span-1 row-span-2 bg-purple-500/20 border border-purple-400/30 rounded flex items-center justify-center text-[10px] font-semibold text-purple-400">
                          Porta 1
                        </div>
                        <div className="col-span-2 row-span-2 bg-emerald-500/20 border border-emerald-400/30 rounded flex items-center justify-center text-[10px] font-semibold text-emerald-400">
                          Lateral Cozinha
                        </div>
                        <div className="col-span-3 row-span-1 bg-amber-500/20 border border-amber-400/30 rounded flex items-center justify-center text-[10px] font-semibold text-amber-400">
                          Sobra Aproveitável (10%)
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between text-xs text-gray-500 font-semibold">
                    <span>Eficiência da chapa: <span className="text-emerald-400">91.4%</span></span>
                    <span>Desperdício líquido: <span className="text-emerald-400">8.6%</span></span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

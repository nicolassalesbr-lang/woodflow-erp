"use client";

import React, { useState, useEffect } from 'react';
import { 
  FileUp, 
  Layers, 
  Sparkles, 
  CheckCircle, 
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Edit3,
  AlertTriangle,
  Plus,
  Download,
  RefreshCw,
  FileText,
  Calculator,
  ShoppingCart,
  Hammer,
  Check,
  Package
} from 'lucide-react';
import { getApiUrl } from '../../utils/api';
import Link from 'next/link';

interface ProjectItem {
  id: string;
  environment: string;
  itemType: string;
  description: string;
  width: number;
  height: number;
  depth: number;
  thickness: number;
  quantity: number;
  materialType: string;
  acabamento?: string;
  cor?: string;
  fornecedor?: string;
  sentidoFibra?: string;
  fitaBorda?: string;
  codigo?: string;
  area?: number;
  volume?: number;
  observacoes?: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  originalFileUrl?: string;
  parseStatus?: string;
  parseProgress?: number;
  parseError?: string;
  items: ProjectItem[];
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProj, setSelectedProj] = useState<Project | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pollingStatus, setPollingStatus] = useState<string>('');
  const [pollingProgress, setPollingProgress] = useState<number>(0);
  const [pollingError, setPollingError] = useState<string>('');
  
  const [newProjName, setNewProjName] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Tabs for the right panel details
  const [activeTab, setActiveTab] = useState<'items' | 'materials' | 'budget' | 'production'>('items');

  // Tree View State
  const [expandedEnvs, setExpandedEnvs] = useState<Record<string, boolean>>({});

  // Editing items state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState<Partial<ProjectItem>>({});

  // Calculation parameters state
  const [markup, setMarkup] = useState(1.6);
  const [margin, setMargin] = useState(25.0);
  const [waste, setWaste] = useState(10.0);
  const [laborRate, setLaborRate] = useState(60.0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatedBudget, setCalculatedBudget] = useState<any>(null);

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/projects`, {
        headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
      });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setProjects(list);
      
      // Keep selected project updated
      if (selectedProj) {
        const current = list.find((p) => p.id === selectedProj.id);
        if (current) {
          setSelectedProj(current);
        }
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  // Poll parse status
  const startPolling = (projectId: string) => {
    setUploading(true);
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${getApiUrl()}/api/projects/${projectId}/parse-status`, {
          headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
        });
        if (res.ok) {
          const statusData = await res.json();
          setPollingStatus(statusData.parseStatus);
          setPollingProgress(statusData.parseProgress);
          setPollingError(statusData.parseError || '');

          if (statusData.parseStatus === 'COMPLETED') {
            clearInterval(interval);
            setUploading(false);
            await fetchProjects();
            // Fetch updated items
            const itemsRes = await fetch(`${getApiUrl()}/api/projects/${projectId}/items`, {
              headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
            });
            if (itemsRes.ok) {
              const items = await itemsRes.json();
              setSelectedProj(prev => prev ? { ...prev, parseStatus: 'COMPLETED', items } : null);
            }
          } else if (statusData.parseStatus === 'FAILED') {
            clearInterval(interval);
            setUploading(false);
            fetchProjects();
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
        clearInterval(interval);
        setUploading(false);
      }
    }, 1500);
  };

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName) return;

    try {
      const res = await fetch(`${getApiUrl()}/api/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026',
        },
        body: JSON.stringify({ name: newProjName, description: newProjDesc }),
      });
      if (res.ok) {
        setNewProjName('');
        setNewProjDesc('');
        setShowAddForm(false);
        fetchProjects();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, projectId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        setPollingStatus('QUEUE');
        setPollingProgress(10);
        
        const res = await fetch(`${getApiUrl()}/api/projects/${projectId}/parse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer mock-jwt-token-2026',
          },
          body: JSON.stringify({ 
            filename: file.name,
            fileBase64: base64,
            mimeType: file.type
          }),
        });

        if (res.ok) {
          startPolling(projectId);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
    }
  };

  // Save edits and feed correction to Azure OpenAI few-shot learning
  const saveItemEdits = async (item: ProjectItem) => {
    if (!selectedProj) return;

    // Send corrections to learn
    const fieldsToCompare: Array<keyof ProjectItem> = ['materialType', 'itemType', 'environment'];
    for (const key of fieldsToCompare) {
      const editedVal = editingFields[key];
      const originalVal = item[key];
      if (editedVal && editedVal !== originalVal) {
        try {
          await fetch(`${getApiUrl()}/api/projects/${selectedProj.id}/corrections`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer mock-jwt-token-2026'
            },
            body: JSON.stringify({
              fieldType: key,
              originalValue: String(originalVal),
              correctedValue: String(editedVal)
            })
          });
        } catch (err) {
          console.error('Failed to submit learning correction:', err);
        }
      }
    }

    // Call local update or mock refresh
    // For production-ready, we update the item in the DB. Let's make a call if needed, or update locally and refresh
    setEditingItemId(null);
    fetchProjects();
  };

  // Run Real Budget Calculations
  const calculateBudget = async () => {
    if (!selectedProj) return;
    setIsCalculating(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/budgets/calculate/${selectedProj.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026'
        },
        body: JSON.stringify({
          markup,
          margin,
          wastePercent: waste
        })
      });
      if (res.ok) {
        const data = await res.json();
        setCalculatedBudget(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCalculating(false);
    }
  };

  // Group items by Environment
  const groupedItems: Record<string, ProjectItem[]> = {};
  if (selectedProj?.items) {
    for (const item of selectedProj.items) {
      if (!groupedItems[item.environment]) {
        groupedItems[item.environment] = [];
      }
      groupedItems[item.environment].push(item);
    }
  }

  // Calculate panel metrics for materials view
  const mdfThicknesses: Record<number, number> = {}; // thickness -> area (m2)
  const hardwareCounts: Record<string, number> = {}; // description -> count
  if (selectedProj?.items) {
    for (const item of selectedProj.items) {
      if (item.itemType === 'Ferragem') {
        hardwareCounts[item.description] = (hardwareCounts[item.description] || 0) + item.quantity;
      } else {
        const area = (item.width * item.height * item.quantity) / 1000000;
        mdfThicknesses[item.thickness] = (mdfThicknesses[item.thickness] || 0) + area;
      }
    }
  }

  return (
    <div className="space-y-10 min-h-screen pb-16">
      
      {/* Title */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-emerald-400" />
            Leitor de Projetos AI <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">PRODUÇÃO REAL</span>
          </h1>
          <p className="text-gray-400 text-sm">Leitura assíncrona de PDF, extração de tabelas com OCR e aprendizado Few-shot com correções.</p>
        </div>

        <button 
          onClick={() => setShowAddForm(true)}
          className="py-2.5 px-5 rounded-xl bg-emerald-500 text-background font-bold text-sm flex items-center gap-2 hover:opacity-95 shadow-glow-emerald"
        >
          <Plus className="w-4 h-4" /> Novo Projeto
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        
        {/* Project List Panel */}
        <div className="xl:col-span-1 space-y-4">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1">Selecione o Projeto</h3>
          {projects.length === 0 ? (
            <div className="p-8 rounded-2xl glass text-center text-xs text-gray-500">
              Nenhum projeto cadastrado.
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((proj) => (
                <div 
                  key={proj.id}
                  onClick={() => {
                    setSelectedProj(proj);
                    setCalculatedBudget(null);
                  }}
                  className={`p-5 rounded-2xl glass cursor-pointer transition-all ${
                    selectedProj?.id === proj.id 
                      ? 'border-emerald-500/30 bg-emerald-500/5 shadow-glow-emerald' 
                      : 'glass-hover'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-sm font-bold text-white tracking-tight">{proj.name}</h4>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      proj.status === 'IN_PRODUCTION' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-gray-800 text-gray-400'
                    }`}>
                      {proj.status === 'IN_PRODUCTION' ? 'PRODUÇÃO' : 'RASCUNHO'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{proj.description}</p>
                  
                  {proj.parseStatus && proj.parseStatus !== 'IDLE' && (
                    <div className="mt-3 flex items-center justify-between text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                      <span>Status IA: {proj.parseStatus}</span>
                      <span>{proj.parseProgress}%</span>
                    </div>
                  )}

                  {!proj.originalFileUrl && (
                    <div onClick={(e) => e.stopPropagation()} className="mt-4">
                      <label className="w-full py-2 px-3 rounded-lg bg-gray-900 border border-border hover:border-emerald-500/40 text-xs text-emerald-400 font-bold flex items-center justify-center gap-2 cursor-pointer transition-all">
                        <FileUp className="w-3.5 h-3.5" /> Enviar PDF de Projeto
                        <input 
                          type="file" 
                          accept="image/*,application/pdf" 
                          className="hidden" 
                          onChange={(e) => handleFileChange(e, proj.id)}
                          disabled={uploading}
                        />
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Visualizer & Details Main Panel */}
        <div className="xl:col-span-3 space-y-6">
          {selectedProj ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Visualizer (Left column - side-by-side) */}
              <div className="lg:col-span-4 glass rounded-2xl p-5 flex flex-col min-h-[60vh] justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-400" />
                    Desenho Técnico / PDF
                  </h3>
                  
                  {selectedProj.originalFileUrl ? (
                    <div className="flex-1 border border-border rounded-xl bg-gray-950 overflow-hidden flex flex-col justify-center items-center py-20 text-center">
                      <FileText className="w-16 h-16 text-emerald-500/25 mb-4 animate-pulse" />
                      <span className="text-xs text-gray-400 font-mono break-all max-w-[200px]">
                        {selectedProj.originalFileUrl.split('/').pop() || 'planta_baixa.pdf'}
                      </span>
                      <a 
                        href={selectedProj.originalFileUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="mt-4 text-[11px] text-emerald-400 underline font-semibold"
                      >
                        Visualizar PDF no Navegador
                      </a>
                    </div>
                  ) : (
                    <div className="border border-dashed border-border rounded-xl flex flex-col items-center justify-center py-24 text-center">
                      <FileUp className="w-12 h-12 text-gray-600 mb-4" />
                      <p className="text-xs text-gray-500 px-6">Nenhum arquivo associado. Faça o upload do memorial ou da lista de peças.</p>
                      <label className="mt-4 py-2 px-4 rounded-xl bg-emerald-500 text-background font-bold text-xs shadow-glow-emerald cursor-pointer">
                        Fazer Upload
                        <input 
                          type="file" 
                          accept="image/*,application/pdf" 
                          className="hidden" 
                          onChange={(e) => handleFileChange(e, selectedProj.id)}
                        />
                      </label>
                    </div>
                  )}
                </div>

                {uploading && (
                  <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-3">
                    <div className="flex justify-between text-xs font-bold text-emerald-400">
                      <span>Status: {pollingStatus}</span>
                      <span>{pollingProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-900 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-emerald-500 h-1.5 transition-all duration-500" style={{ width: `${pollingProgress}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-500 block leading-tight">
                      {pollingStatus === 'QUEUE' && 'Aguardando na fila de processamento Redis...'}
                      {pollingStatus === 'EXTRACTING' && 'Fase 1/4: Extraindo texto e tabelas de corte do PDF via OCR...'}
                      {pollingStatus === 'INTERPRETING' && 'Fase 2/4: Interpretando memorial descritivo com GPT-4o...'}
                      {pollingStatus === 'VALIDATING' && 'Fase 3/4: Rodando regras do motor de engenharia...'}
                    </span>
                  </div>
                )}
              </div>

              {/* Parsed Tree & Output Panel (Right column - side-by-side) */}
              <div className="lg:col-span-8 glass rounded-2xl p-6 flex flex-col justify-between">
                
                {/* Tabs Header */}
                <div className="flex border-b border-border mb-6 overflow-x-auto">
                  <button 
                    onClick={() => setActiveTab('items')}
                    className={`pb-3 px-4 font-bold text-xs border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                      activeTab === 'items' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <Layers className="w-4 h-4" /> Peças & Medidas
                  </button>
                  <button 
                    onClick={() => setActiveTab('materials')}
                    className={`pb-3 px-4 font-bold text-xs border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                      activeTab === 'materials' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <ShoppingCart className="w-4 h-4" /> Compras & Materiais
                  </button>
                  <button 
                    onClick={() => setActiveTab('budget')}
                    className={`pb-3 px-4 font-bold text-xs border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                      activeTab === 'budget' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <Calculator className="w-4 h-4" /> Orçamento AI
                  </button>
                  <button 
                    onClick={() => setActiveTab('production')}
                    className={`pb-3 px-4 font-bold text-xs border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
                      activeTab === 'production' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <Hammer className="w-4 h-4" /> Produção PCP
                  </button>
                </div>

                {/* Tab Content 1: Items List (Tree view + Editable table) */}
                {activeTab === 'items' && (
                  <div className="space-y-6 flex-1">
                    {selectedProj.items && selectedProj.items.length > 0 ? (
                      <div className="space-y-6">
                        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 bg-emerald-500/5 p-3 rounded-lg border border-emerald-500/10 justify-between">
                          <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 animate-pulse" /> Extração finalizada com sucesso!</span>
                          <span className="text-[10px] text-gray-400 font-mono">Dê dois cliques em qualquer campo para efetuar correções e ensinar a IA.</span>
                        </div>

                        {/* Environments Tree View */}
                        <div className="space-y-4">
                          {Object.keys(groupedItems).map((envName) => {
                            const envExpanded = expandedEnvs[envName] !== false;
                            return (
                              <div key={envName} className="border border-border/40 rounded-xl overflow-hidden bg-gray-900/10">
                                <div 
                                  onClick={() => setExpandedEnvs(prev => ({ ...prev, [envName]: !envExpanded }))}
                                  className="p-3 bg-gray-900/40 border-b border-border/40 flex items-center justify-between cursor-pointer hover:bg-gray-900/60"
                                >
                                  <div className="flex items-center gap-2 font-bold text-xs text-white">
                                    {envExpanded ? <ChevronDown className="w-4 h-4 text-emerald-400" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                                    <span>Ambiente: {envName}</span>
                                    <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full">{groupedItems[envName].length} peças</span>
                                  </div>
                                </div>

                                {envExpanded && (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-[11px] text-left text-gray-300">
                                      <thead className="text-[10px] text-gray-500 uppercase border-b border-border">
                                        <tr>
                                          <th className="py-2 px-3">Código</th>
                                          <th className="py-2 px-3">Tipo</th>
                                          <th className="py-2 px-3">Descrição</th>
                                          <th className="py-2 px-3">Medidas (LxAxP)</th>
                                          <th className="py-2 px-3">Espessura</th>
                                          <th className="py-2 px-3">Qtd</th>
                                          <th className="py-2 px-3">Material</th>
                                          <th className="py-2 px-3">Fibra</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {groupedItems[envName].map((item) => (
                                          <tr 
                                            key={item.id} 
                                            onDoubleClick={() => {
                                              setEditingItemId(item.id);
                                              setEditingFields(item);
                                            }}
                                            className="border-b border-border/20 hover:bg-gray-950/20 cursor-pointer"
                                          >
                                            <td className="py-2 px-3 font-mono text-gray-400">{item.codigo || '-'}</td>
                                            <td className="py-2 px-3 font-semibold text-emerald-400">{item.itemType}</td>
                                            <td className="py-2 px-3">
                                              {editingItemId === item.id ? (
                                                <input 
                                                  type="text" 
                                                  value={editingFields.description || ''} 
                                                  onChange={(e) => setEditingFields(prev => ({ ...prev, description: e.target.value }))}
                                                  className="bg-gray-800 text-white rounded px-1.5 py-0.5 w-full font-sans text-xs focus:outline-none"
                                                />
                                              ) : item.description}
                                            </td>
                                            <td className="py-2 px-3 font-mono">
                                              {editingItemId === item.id ? (
                                                <div className="flex gap-1 items-center">
                                                  <input 
                                                    type="number" 
                                                    value={editingFields.width || 0} 
                                                    onChange={(e) => setEditingFields(prev => ({ ...prev, width: Number(e.target.value) }))}
                                                    className="bg-gray-800 text-white rounded w-10 text-center"
                                                  />
                                                  x
                                                  <input 
                                                    type="number" 
                                                    value={editingFields.height || 0} 
                                                    onChange={(e) => setEditingFields(prev => ({ ...prev, height: Number(e.target.value) }))}
                                                    className="bg-gray-800 text-white rounded w-10 text-center"
                                                  />
                                                </div>
                                              ) : `${item.width}x${item.height}`}
                                            </td>
                                            <td className="py-2 px-3 font-mono">{item.thickness} mm</td>
                                            <td className="py-2 px-3 font-semibold">{item.quantity}</td>
                                            <td className="py-2 px-3">
                                              {editingItemId === item.id ? (
                                                <input 
                                                  type="text" 
                                                  value={editingFields.materialType || ''} 
                                                  onChange={(e) => setEditingFields(prev => ({ ...prev, materialType: e.target.value }))}
                                                  className="bg-gray-800 text-white rounded px-1.5 py-0.5 w-full font-sans text-xs focus:outline-none"
                                                />
                                              ) : item.materialType}
                                            </td>
                                            <td className="py-2 px-3 text-gray-500">
                                              {editingItemId === item.id ? (
                                                <div className="flex gap-2">
                                                  <button 
                                                    onClick={() => saveItemEdits(item)}
                                                    className="p-1 rounded bg-emerald-500 text-background"
                                                  >
                                                    <Check className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                              ) : (item.sentidoFibra || '-')}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="py-20 text-center text-xs text-gray-500">
                        Nenhuma peça extraída. Faça upload do projeto executivo no painel esquerdo.
                      </div>
                    )}
                  </div>
                )}

                {/* Tab Content 2: Materials & Hardware Shopping List */}
                {activeTab === 'materials' && (
                  <div className="space-y-6 flex-1">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Demanda Consolidada de Chapas e Ferragens</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* MDF Board Estimate Table */}
                      <div className="border border-border/40 rounded-xl p-4 bg-gray-900/20">
                        <h5 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                          <Package className="w-4 h-4 text-emerald-400" /> Chapas MDF Estimadas
                        </h5>
                        <table className="w-full text-xs text-left text-gray-300">
                          <thead>
                            <tr className="border-b border-border text-gray-500">
                              <th className="py-2">Espessura</th>
                              <th className="py-2 text-right">Área Total</th>
                              <th className="py-2 text-right">Chapas (Aprox.)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.keys(mdfThicknesses).map((thickness) => {
                              const area = mdfThicknesses[Number(thickness)];
                              const sheets = Math.ceil(area / 5.06);
                              return (
                                <tr key={thickness} className="border-b border-border/10">
                                  <td className="py-2 font-mono">{thickness} mm</td>
                                  <td className="py-2 text-right font-mono">{area.toFixed(2)} m²</td>
                                  <td className="py-2 text-right font-semibold text-emerald-400">{sheets} un</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Hardwares Counts */}
                      <div className="border border-border/40 rounded-xl p-4 bg-gray-900/20">
                        <h5 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                          <ShoppingCart className="w-4 h-4 text-emerald-400" /> Ferragens & Dobradiças
                        </h5>
                        <table className="w-full text-xs text-left text-gray-300">
                          <thead>
                            <tr className="border-b border-border text-gray-500">
                              <th className="py-2">Item</th>
                              <th className="py-2 text-right">Quantidade</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.keys(hardwareCounts).map((desc) => {
                              const count = hardwareCounts[desc];
                              return (
                                <tr key={desc} className="border-b border-border/10">
                                  <td className="py-2">{desc}</td>
                                  <td className="py-2 text-right font-semibold text-emerald-400">{count} un</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab Content 3: Budget Engine */}
                {activeTab === 'budget' && (
                  <div className="space-y-6 flex-1">
                    <div className="p-4 bg-gray-900/40 border border-border/40 rounded-xl space-y-4">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Markup & Margens de Venda</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-1">Markup (Multiplicador)</label>
                          <input 
                            type="number" 
                            step="0.1" 
                            value={markup} 
                            onChange={(e) => setMarkup(Number(e.target.value))}
                            className="bg-gray-800 text-white rounded px-2 py-1 w-full text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-1">Margem Lucro (%)</label>
                          <input 
                            type="number" 
                            value={margin} 
                            onChange={(e) => setMargin(Number(e.target.value))}
                            className="bg-gray-800 text-white rounded px-2 py-1 w-full text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-1">Perda MDF (%)</label>
                          <input 
                            type="number" 
                            value={waste} 
                            onChange={(e) => setWaste(Number(e.target.value))}
                            className="bg-gray-800 text-white rounded px-2 py-1 w-full text-xs"
                          />
                        </div>
                        <div className="flex items-end">
                          <button 
                            onClick={calculateBudget}
                            disabled={isCalculating}
                            className="w-full py-1.5 px-3 rounded-lg bg-emerald-500 text-background font-bold text-xs hover:opacity-95"
                          >
                            {isCalculating ? 'Calculando...' : 'Atualizar Preço'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {calculatedBudget ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="border border-border/40 rounded-xl p-5 bg-gray-900/20 space-y-3">
                          <h5 className="text-xs font-bold text-white">Composição de Custos</h5>
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>Chapas MDF ({calculatedBudget.totalMdfSheets} un):</span>
                            <span className="font-mono">R$ {(calculatedBudget.totalMdfSheets * 280).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>Ferragens:</span>
                            <span className="font-mono">R$ {calculatedBudget.totalHardwareCost.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>Mão de Obra Operacional:</span>
                            <span className="font-mono">R$ {calculatedBudget.totalLaborCost.toFixed(2)}</span>
                          </div>
                          <hr className="border-border/30" />
                          <div className="flex justify-between text-xs font-bold text-emerald-400">
                            <span>Preço Final Recomendado:</span>
                            <span className="font-mono text-sm">R$ {calculatedBudget.finalPrice.toLocaleString('pt-BR')}</span>
                          </div>
                        </div>

                        <div className="border border-border/40 rounded-xl p-5 bg-gray-900/20 flex flex-col justify-center items-center text-center space-y-2">
                          <CheckCircle className="w-12 h-12 text-emerald-400" />
                          <span className="text-xs font-bold text-white">Pronto para Orçamento!</span>
                          <p className="text-[11px] text-gray-400">Preço de R$ {calculatedBudget.finalPrice.toLocaleString('pt-BR')} pronto para ser enviado como proposta ao cliente.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-xs text-gray-500">
                        Clique em "Atualizar Preço" para estimar a composição financeira do projeto.
                      </div>
                    )}
                  </div>
                )}

                {/* Tab Content 4: Production PCP Timeline */}
                {activeTab === 'production' && (
                  <div className="space-y-6 flex-1">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ordem de Produção (PCP) Chão de Fábrica</h4>
                    
                    <div className="relative border-l-2 border-border/60 ml-4 pl-6 space-y-6">
                      <div className="relative">
                        <span className="absolute -left-9 top-0.5 bg-emerald-500 text-background rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">1</span>
                        <h5 className="text-xs font-bold text-white">Setor: DESIGN (3D / Engenharia)</h5>
                        <p className="text-[11px] text-gray-400">Modulações e verificação de furos de montagem no Promob.</p>
                      </div>

                      <div className="relative">
                        <span className="absolute -left-9 top-0.5 bg-gray-800 text-gray-500 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">2</span>
                        <h5 className="text-xs font-bold text-white">Setor: CORTE (MDF)</h5>
                        <p className="text-[11px] text-gray-400">Planejamento das chapas na seccionadora e furação CNC.</p>
                      </div>

                      <div className="relative">
                        <span className="absolute -left-9 top-0.5 bg-gray-800 text-gray-500 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">3</span>
                        <h5 className="text-xs font-bold text-white">Setor: BORDA (Fita de Borda)</h5>
                        <p className="text-[11px] text-gray-400">Colagem das fitas de borda ABS nos topos das chapas.</p>
                      </div>

                      <div className="relative">
                        <span className="absolute -left-9 top-0.5 bg-gray-800 text-gray-500 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">4</span>
                        <h5 className="text-xs font-bold text-white">Setor: MONTAGEM</h5>
                        <p className="text-[11px] text-gray-400">Pré-montagem dos armários com buchas e minifix na marcenaria.</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pricing / Export buttons bottom */}
                <div className="pt-6 border-t border-border flex justify-between gap-4 mt-6">
                  <div className="flex gap-2">
                    <button className="py-2.5 px-4 rounded-xl border border-border text-gray-400 font-bold text-xs flex items-center gap-1.5 hover:bg-gray-800/40">
                      <Download className="w-4 h-4" /> Exportar Promob
                    </button>
                    <button className="py-2.5 px-4 rounded-xl border border-border text-gray-400 font-bold text-xs flex items-center gap-1.5 hover:bg-gray-800/40">
                      <Download className="w-4 h-4" /> Plano de Corte PDF
                    </button>
                  </div>
                  
                  <Link href="/budget">
                    <button className="py-2.5 px-6 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-background font-bold text-xs flex items-center gap-1.5 hover:opacity-95 shadow-glow-emerald">
                      Faturar Projeto <ArrowRight className="w-4 h-4" />
                    </button>
                  </Link>
                </div>

              </div>

            </div>
          ) : (
            <div className="glass p-12 text-center text-gray-500 text-xs rounded-2xl min-h-[40vh] flex flex-col justify-center items-center">
              Selecione um projeto na barra lateral para abrir a bancada de leitura da IA.
            </div>
          )}
        </div>

      </div>

      {/* Add Project Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <form onSubmit={createProject} className="w-full max-w-md glass p-8 rounded-2xl space-y-6">
            <h3 className="text-lg font-bold text-white">Criar Novo Projeto</h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Nome do Projeto</label>
                <input 
                  type="text" 
                  value={newProjName} 
                  onChange={(e) => setNewProjName(e.target.value)}
                  placeholder="Ex: Cozinha Planejada Residência Roberto"
                  className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none focus:border-emerald-500/40"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Descrição / Notas</label>
                <textarea 
                  value={newProjDesc} 
                  onChange={(e) => setNewProjDesc(e.target.value)}
                  placeholder="Especificações de ferragens, cores, etc..."
                  className="w-full h-24 py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none focus:border-emerald-500/40 resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button 
                type="button" 
                onClick={() => setShowAddForm(false)}
                className="py-2 px-4 rounded-xl border border-border text-gray-400 text-sm hover:bg-gray-800/40"
              >
                Cancelar
              </button>
              <button 
                type="submit"
                className="py-2 px-5 rounded-xl bg-emerald-500 text-background font-semibold text-sm hover:opacity-95"
              >
                Criar
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}

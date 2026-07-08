"use client";

import React, { useState, useEffect } from 'react';
import { 
  FileUp, 
  Layers, 
  Sparkles, 
  CheckCircle, 
  ArrowRight,
  Maximize2
} from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';

interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  originalFileUrl?: string;
  items: { id: string; environment: string; itemType: string; description: string; width: number; height: number; depth: number; thickness: number; quantity: number; materialType: string }[];
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProj, setSelectedProj] = useState<Project | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchProjects = async () => {
    try {
      const res = await fetch('http://localhost:3009/api/projects', {
        headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
      });
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      // Mock data if server is unreachable
      const mock = [
        {
          id: 'proj-1',
          name: 'Projeto Mansão Alphaville - Cozinha',
          description: 'Cozinha gourmet completa com reflecta bronze e nichos em louro freijó.',
          status: 'DRAFT',
          originalFileUrl: 'cozinha_alphaville_planta.pdf',
          items: [
            { id: '1', environment: 'Cozinha', itemType: 'Caixa', description: 'Gabinete pia', width: 1200, height: 750, depth: 600, thickness: 18, quantity: 1, materialType: 'MDF Branco TX 18mm' },
            { id: '2', environment: 'Cozinha', itemType: 'Porta', description: 'Porta reflecta', width: 600, height: 400, depth: 20, thickness: 18, quantity: 2, materialType: 'Vidro Reflecta' }
          ]
        }
      ];
      setProjects(mock);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName) return;

    try {
      const res = await fetch('http://localhost:3009/api/projects', {
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
    } catch {
      const mockNew = {
        id: `mock-${Date.now()}`,
        name: newProjName,
        description: newProjDesc,
        status: 'DRAFT',
        items: []
      };
      setProjects((prev) => [mockNew, ...prev]);
      setShowAddForm(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, projectId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const res = await fetch(`http://localhost:3009/api/projects/${projectId}/parse`, {
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
          fetchProjects();
          const list = await fetch(`http://localhost:3009/api/projects`, {
            headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
          }).then(r => r.json());
          const updatedProj = Array.isArray(list) ? list.find((p: any) => p.id === projectId) : null;
          if (updatedProj) {
            setSelectedProj(updatedProj);
          }
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const simulateAiParsing = async (projectId: string) => {
    setUploading(true);
    try {
      const res = await fetch(`http://localhost:3009/api/projects/${projectId}/parse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026',
        },
        body: JSON.stringify({ filename: 'planta_baixa_marcenaria.pdf' }),
      });
      if (res.ok) {
        fetchProjects();
        const list = await fetch(`http://localhost:3009/api/projects`, {
          headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
        }).then(r => r.json());
        const updatedProj = Array.isArray(list) ? list.find((p: any) => p.id === projectId) : null;
        if (updatedProj) {
          setSelectedProj(updatedProj);
        }
      }
    } catch {
      // Local mock parsing
      const parsedProj = projects.find((p) => p.id === projectId);
      if (parsedProj) {
        parsedProj.originalFileUrl = 'planta_baixa_marcenaria.pdf';
        parsedProj.items = [
          { id: 'm1', environment: 'Cozinha', itemType: 'Caixa', description: 'Gabinete inferior pia', width: 1200, height: 800, depth: 600, thickness: 18, quantity: 1, materialType: 'MDF Branco TX 18mm' },
          { id: 'm2', environment: 'Cozinha', itemType: 'Porta', description: 'Porta basculante perfil alumínio', width: 600, height: 400, depth: 20, thickness: 18, quantity: 2, materialType: 'Vidro Reflecta Bronze' },
          { id: 'm3', environment: 'Quarto', itemType: 'Caixa', description: 'Módulo principal roupeiro', width: 2200, height: 2600, depth: 650, thickness: 18, quantity: 1, materialType: 'MDF Louro Freijó 18mm' },
          { id: 'm4', environment: 'Quarto', itemType: 'Ferragem', description: 'Corrediça Telescópica toque click', width: 0, height: 450, depth: 0, thickness: 0, quantity: 4, materialType: 'Corrediça Telescópica 45cm' },
        ];
        setSelectedProj({ ...parsedProj });
        setProjects((prev) => prev.map((p) => p.id === projectId ? { ...parsedProj } : p));
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-10">
      
      {/* Header info */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Leitura de Projetos por IA</h1>
          <p className="text-gray-400 text-sm">Faça upload de plantas em PDF, DWG ou imagens e extraia os itens de marcenaria.</p>
        </div>

        <button 
          onClick={() => setShowAddForm(true)}
          className="py-2.5 px-5 rounded-xl bg-emerald-500 text-background font-semibold text-sm flex items-center gap-2 hover:opacity-95 shadow-glow-emerald"
        >
          <PlusIcon className="w-4 h-4" /> Novo Projeto
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left side list of projects */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1">Projetos Ativos</h3>
          {projects.map((proj) => (
            <div 
              key={proj.id}
              onClick={() => setSelectedProj(proj)}
              className={`p-5 rounded-2xl glass cursor-pointer transition-all ${
                selectedProj?.id === proj.id 
                  ? 'border-emerald-500/30 bg-emerald-500/5 shadow-glow-emerald' 
                  : 'glass-hover'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <h4 className="text-sm font-bold text-white tracking-tight">{proj.name}</h4>
                <span className="text-[10px] font-semibold text-gray-500">{proj.status}</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{proj.description}</p>
              
              {/* Parse button */}
              {!proj.originalFileUrl && (
                <div onClick={(e) => e.stopPropagation()} className="mt-4">
                  <label
                    className={`w-full py-2 px-3 rounded-lg bg-gray-900 border border-border hover:border-emerald-500/40 text-xs text-emerald-400 font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                      uploading ? 'opacity-50 pointer-events-none' : ''
                    }`}
                  >
                    <FileUp className="w-3.5 h-3.5" /> 
                    {uploading ? 'Processando...' : 'Analisar Planta com IA'}
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

        {/* Right side detailed parsed items */}
        <div className="lg:col-span-2 glass p-6 md:p-8 rounded-2xl flex flex-col min-h-[50vh]">
          {selectedProj ? (
            <div className="space-y-6">
              
              {/* Top description */}
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">{selectedProj.name}</h3>
                  <p className="text-xs text-gray-400 mt-1">{selectedProj.description}</p>
                </div>
                {selectedProj.originalFileUrl && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                    <CheckCircle className="w-4 h-4" /> 
                    <span>Análise Concluída</span>
                  </div>
                )}
              </div>

              {/* Parsed items table */}
              {selectedProj.items && selectedProj.items.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 bg-emerald-500/5 p-3 rounded-lg border border-emerald-500/10">
                    <Sparkles className="w-4.5 h-4.5" />
                    <span>IA detectou {selectedProj.items.length} itens estruturados.</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left text-gray-300">
                      <thead className="text-[10px] text-gray-500 uppercase border-b border-border">
                        <tr>
                          <th className="py-2.5 px-3">Ambiente</th>
                          <th className="py-2.5 px-3">Tipo</th>
                          <th className="py-2.5 px-3">Descrição</th>
                          <th className="py-2.5 px-3">L x A x P (mm)</th>
                          <th className="py-2.5 px-3">Qtd</th>
                          <th className="py-2.5 px-3">Material</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProj.items.map((item) => (
                          <tr key={item.id} className="border-b border-border/40 hover:bg-gray-900/10">
                            <td className="py-3 px-3 font-semibold text-emerald-400">{item.environment}</td>
                            <td className="py-3 px-3">{item.itemType}</td>
                            <td className="py-3 px-3">{item.description}</td>
                            <td className="py-3 px-3 font-mono">{item.width} x {item.height} x {item.depth}</td>
                            <td className="py-3 px-3 font-semibold">{item.quantity}</td>
                            <td className="py-3 px-3 text-gray-400">{item.materialType}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pricing redirection link */}
                  <div className="pt-4 flex justify-end">
                    <Link href="/budget">
                      <button className="py-2.5 px-5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-background font-bold text-xs flex items-center gap-2 hover:opacity-95 shadow-glow-emerald">
                        Enviar para Motor de Orçamento <ArrowRight className="w-4 h-4" />
                      </button>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-gray-900 border border-border flex items-center justify-center">
                    <FileUp className="w-6 h-6 text-gray-500" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">Nenhum item processado</h4>
                    <p className="text-xs text-gray-500 max-w-xs mt-1">Análise a planta deste projeto para extrair ambientes, peças e ferragens automaticamente via IA.</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <label
                      className={`py-2 px-5 rounded-xl bg-emerald-500 text-background font-bold text-xs shadow-glow-emerald cursor-pointer transition-all ${
                        uploading ? 'opacity-50 pointer-events-none' : ''
                      }`}
                    >
                      {uploading ? 'Processando...' : 'Analisar Agora'}
                      <input 
                        type="file" 
                        accept="image/*,application/pdf" 
                        className="hidden" 
                        onChange={(e) => handleFileChange(e, selectedProj.id)}
                        disabled={uploading}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center text-gray-500 text-xs py-20">
              Selecione um projeto na lista lateral para ver seus itens detalhados.
            </div>
          )}
        </div>
      </div>

      {/* Add Project Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <form onSubmit={createProject} className="w-full max-w-md glass p-8 rounded-2xl space-y-6">
            <h3 className="text-lg font-bold text-white">Adicionar Novo Projeto</h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Nome do Projeto</label>
                <input 
                  type="text" 
                  value={newProjName} 
                  onChange={(e) => setNewProjName(e.target.value)}
                  placeholder="Ex: Armários Suíte Master - Roberto"
                  className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none focus:border-emerald-500/40"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Descrição</label>
                <textarea 
                  value={newProjDesc} 
                  onChange={(e) => setNewProjDesc(e.target.value)}
                  placeholder="Descreva detalhes ou especificações do cliente..."
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

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

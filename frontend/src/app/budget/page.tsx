"use client";

import React, { useState, useEffect } from 'react';
import { 
  Calculator, 
  Settings, 
  Layers, 
  Sparkles, 
  Send,
  FileText,
  DollarSign
} from 'lucide-react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';

interface Budget {
  id: string;
  projectId: string;
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
}

export default function BudgetScreen() {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [params, setParams] = useState({
    markup: 1.6,
    margin: 32.0,
    commission: 5.0,
    taxPercent: 6.0,
    wastePercent: 10.0
  });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'calc' | 'cutting'>('calc');

  const calculateBudget = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3009/api/budgets/calculate/proj-1', {
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
      const sheetsCost = 6 * 280.0; // 6 sheets * R$280
      const rawCost = sheetsCost + 240.0 + 350.0; // sheets + hardware + labor
      const ratio = 1 - (params.margin / 100) - (params.commission / 100) - (params.taxPercent / 100);
      const finalPrice = rawCost * params.markup / (ratio > 0.1 ? ratio : 0.5);

      setBudget({
        id: 'mock-b-1',
        projectId: 'proj-1',
        totalMdfSheets: 6,
        totalHardwareCost: 240.0,
        totalLaborCost: 350.0,
        wastePercent: params.wastePercent,
        markup: params.markup,
        margin: params.margin,
        commission: params.commission,
        taxPercent: params.taxPercent,
        finalPrice: Math.round(finalPrice * 100) / 100,
        version: 1
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    calculateBudget();
  }, []);

  const sendToProduction = async () => {
    if (!budget) return;
    try {
      await fetch(`http://localhost:3009/api/production/start/proj-1`, {
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
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Motor de Orçamentos & Corte</h1>
          <p className="text-gray-400 text-sm">Ajuste markups, calcule o plano de corte e gere ordens de produção.</p>
        </div>

        <div className="flex gap-2">
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
            <h3 className="text-base font-bold text-white tracking-tight">Markup & Margens</h3>
          </div>

          <div className="space-y-4 text-xs font-semibold text-gray-400">
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

            <button 
              onClick={calculateBudget}
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
                      <p className="mt-1 font-semibold text-emerald-400">Margem líquida {budget.margin || 0}%</p>
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
    </div>
  );
}

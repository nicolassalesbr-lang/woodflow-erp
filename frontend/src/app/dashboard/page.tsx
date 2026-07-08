"use client";

import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  DollarSign, 
  Layers, 
  Clock, 
  AlertTriangle, 
  Sparkles, 
  ArrowUpRight 
} from 'lucide-react';
import { motion } from 'framer-motion';

export default function Dashboard() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(t);
  }, []);

  const kpis = [
    { title: 'Faturamento Mensal', value: 'R$ 84.200,00', change: '+12.4%', sub: 'vs mês anterior', icon: DollarSign, color: 'text-emerald-400', glow: 'shadow-glow-emerald' },
    { title: 'Lucro Líquido', value: 'R$ 29.470,00', change: '+15.2%', sub: 'Margem de 35%', icon: TrendingUp, color: 'text-cyan-400', glow: 'shadow-glow-cyan' },
    { title: 'Funil Comercial', value: '18 Leads', change: '+3 novos', sub: 'R$ 145.000 em negociação', icon: Layers, color: 'text-purple-400', glow: '' },
    { title: 'Produção Ativa', value: '5 Projetos', change: '1 atrasado', sub: 'Capacidade em 78%', icon: Clock, color: 'text-amber-400', glow: '' },
  ];

  const aiInsights = [
    { type: 'oportunidade', text: 'O Lead "Marina Fontes Silveira" tem 95% de chance de conversão. Recomendamos enviar a proposta hoje.' },
    { type: 'alerta', text: 'Estoque de MDF Louro Freijó 15mm está crítico (3 chapas restantes). O estoque mínimo é de 8.' },
    { type: 'performance', text: 'Sua produtividade média de montagem subiu 8% esta semana devido à automatização de etiquetas.' }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      
      {/* Title block */}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Dashboard Executivo</h1>
        <p className="text-gray-400 text-sm">Visão consolidada da sua fábrica em tempo real.</p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpis.map((kpi, index) => (
          <motion.div 
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className={`glass glass-hover p-6 rounded-2xl flex flex-col justify-between ${kpi.glow}`}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-gray-400 tracking-wide uppercase">{kpi.title}</span>
              <div className={`p-2.5 rounded-xl bg-gray-900/50 border border-border ${kpi.color}`}>
                <kpi.icon className="w-5 h-5" />
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white tracking-tight mb-1">{kpi.value}</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md">{kpi.change}</span>
                <span className="text-[11px] text-gray-500 font-medium">{kpi.sub}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* AI Insights & Performance Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Charts block */}
        <div className="lg:col-span-2 glass p-6 md:p-8 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">Faturamento vs Meta</h3>
              <p className="text-xs text-gray-400 mt-1">Evolução financeira consolidada de 2026.</p>
            </div>
            <div className="flex gap-4 text-xs font-semibold text-gray-400">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded bg-emerald-500"></div> Realizado
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded bg-cyan-500"></div> Meta
              </div>
            </div>
          </div>
          
          {/* Custom elegant HTML chart bar charts */}
          <div className="h-64 flex items-end justify-between gap-4 pt-4 px-2">
            {[
              { m: 'Jan', val: 70, target: 80 },
              { m: 'Fev', val: 85, target: 80 },
              { m: 'Mar', val: 95, target: 90 },
              { m: 'Abr', val: 120, target: 100 },
              { m: 'Mai', val: 105, target: 100 },
              { m: 'Jun', val: 145, target: 120 },
            ].map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                <div className="w-full flex justify-center gap-1.5 items-end h-56">
                  {/* Realized bar */}
                  <div 
                    style={{ height: `${(d.val / 150) * 100}%` }}
                    className="w-4 rounded-t bg-gradient-to-t from-emerald-600 to-emerald-400 group-hover:shadow-glow-emerald transition-shadow duration-300"
                  />
                  {/* Meta bar */}
                  <div 
                    style={{ height: `${(d.target / 150) * 100}%` }}
                    className="w-4 rounded-t bg-gradient-to-t from-cyan-600 to-cyan-400 group-hover:shadow-glow-cyan transition-shadow duration-300"
                  />

                </div>
                <span className="text-[11px] font-semibold text-gray-400">{d.m}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI Insight Sidebar */}
        <div className="glass p-6 md:p-8 rounded-2xl flex flex-col justify-between border border-emerald-500/10">
          <div className="flex items-center gap-2 mb-6">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <h3 className="text-lg font-bold text-white tracking-tight">Percepções do Assistente</h3>
          </div>
          
          <div className="space-y-4 flex-1">
            {aiInsights.map((insight, index) => (
              <div key={index} className="p-4 rounded-xl bg-gray-900/40 border border-border flex gap-3">
                {insight.type === 'alerta' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                ) : (
                  <Sparkles className="w-5 h-5 text-emerald-400 shrink-0" />
                )}
                <div>
                  <span className="text-[10px] font-bold tracking-wider uppercase text-gray-500 block mb-0.5">{insight.type}</span>
                  <p className="text-xs text-gray-300 leading-relaxed font-medium">{insight.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-xs font-semibold text-emerald-400 group cursor-pointer">
            <span>Pedir mais insights ao Copiloto</span>
            <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </div>
        </div>
      </div>
    </div>
  );
}

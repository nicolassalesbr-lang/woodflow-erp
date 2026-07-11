"use client";

import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  Sparkles, 
  Medal, 
  Target, 
  ArrowRight,
  TrendingDown,
  PieChart as PieIcon,
  HelpCircle,
  Percent
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar } from 'recharts';

export default function AnalyticsScreen() {
  const [loading, setLoading] = useState(true);

  // Sales data forecast mock
  const forecastData = [
    { name: 'Jan', Realizado: 45000, Previsto: 42000 },
    { name: 'Fev', Realizado: 52000, Previsto: 48000 },
    { name: 'Mar', Realizado: 48000, Previsto: 50000 },
    { name: 'Abr', Realizado: 70000, Previsto: 62000 },
    { name: 'Mai', Realizado: 85000, Previsto: 80000 },
    { name: 'Jun', Realizado: 98000, Previsto: 95000 },
    { name: 'Jul', Realizado: 112000, Previsto: 120000 }
  ];

  // Conversion funnel data
  const funnelData = [
    { name: 'Novos Leads', Qtd: 120, pct: 100 },
    { name: 'Contatados', Qtd: 84, pct: 70 },
    { name: 'Visita Agendada', Qtd: 48, pct: 40 },
    { name: 'Orçamentos', Qtd: 36, pct: 30 },
    { name: 'Negociação', Qtd: 18, pct: 15 },
    { name: 'Fechados (WON)', Qtd: 12, pct: 10 }
  ];

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 350);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-1/3 bg-[#e8d4b8]/10 rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-32 bg-[#e8d4b8]/5 rounded-2xl border border-[#e8d4b8]/8 animate-pulse" />
          <div className="h-32 bg-[#e8d4b8]/5 rounded-2xl border border-[#e8d4b8]/8 animate-pulse" />
          <div className="h-32 bg-[#e8d4b8]/5 rounded-2xl border border-[#e8d4b8]/8 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#fff8f0]">BI & Analytics Executivo</h1>
        <p className="mt-1 text-sm text-[#bba890]">Analise a conversão do funil de vendas, ticket médio e previsões de mercado.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.03] p-5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#a99680]">Ticket Médio</span>
          <div className="text-2xl font-bold text-white mt-1.5">R$ 15.420,00</div>
          <span className="text-[9px] text-emerald-400 mt-1 block">+8.4% em relação ao mês anterior</span>
        </div>
        <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.03] p-5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#a99680]">Taxa de Conversão</span>
          <div className="text-2xl font-bold text-[#ead5ba] mt-1.5">10.0%</div>
          <span className="text-[9px] text-[#bba890] mt-1 block">Meta do mês: 12.5%</span>
        </div>
        <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.03] p-5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#a99680]">Volume Faturado</span>
          <div className="text-2xl font-bold text-white mt-1.5">R$ 513.000,00</div>
          <span className="text-[9px] text-[#bba890] mt-1 block">Soma acumulada anual</span>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Forecast Area Chart */}
        <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-5 space-y-4">
          <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-[#d6ad79]" /> Histórico & Previsão de Faturamento (R$)
          </h3>
          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecastData}>
                <XAxis dataKey="name" stroke="#a99680" />
                <YAxis stroke="#a99680" />
                <Tooltip contentStyle={{ backgroundColor: '#211811', borderColor: '#e8d4b8/10', color: '#fff' }} />
                <Area type="monotone" dataKey="Realizado" stroke="#d6ad79" fillOpacity={0.15} fill="url(#colorReal)" />
                <Area type="monotone" dataKey="Previsto" stroke="#766756" strokeDasharray="5 5" fill="none" />
                <defs>
                  <linearGradient id="colorReal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d6ad79" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#d6ad79" stopOpacity={0}/>
                  </linearGradient>
                </defs>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Funnel Conversion Chart */}
        <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-5 space-y-4">
          <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider flex items-center gap-1.5">
            <Target className="h-4 w-4 text-[#d6ad79]" /> Funil de Vendas & Conversão
          </h3>
          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical">
                <XAxis type="number" stroke="#a99680" />
                <YAxis dataKey="name" type="category" stroke="#a99680" width={100} />
                <Tooltip contentStyle={{ backgroundColor: '#211811', borderColor: '#e8d4b8/10', color: '#fff' }} />
                <Bar dataKey="pct" fill="#d6ad79" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Rankings & AI Insights Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Rankings column */}
        <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#1e160f]/60 p-5 space-y-4 md:col-span-2">
          <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider flex items-center gap-1.5">
            <Medal className="h-4.5 w-4.5 text-[#d6ad79]" /> Rankings de Performance (Parceiros & Vendas)
          </h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            {/* Vendedores */}
            <div className="space-y-3">
              <span className="font-bold text-white border-b border-[#e8d4b8]/10 pb-1.5 block">Vendedores</span>
              <div className="space-y-2 text-[#bba890]">
                <div className="flex justify-between"><span>1. Leonardo J.</span> <span className="font-bold text-white">R$ 154k</span></div>
                <div className="flex justify-between"><span>2. Maria S.</span> <span className="font-bold text-white">R$ 98k</span></div>
                <div className="flex justify-between"><span>3. Pedro H.</span> <span className="font-bold text-white">R$ 45k</span></div>
              </div>
            </div>
            {/* Arquitetos */}
            <div className="space-y-3 border-t sm:border-t-0 sm:border-l border-[#e8d4b8]/10 pt-4 sm:pt-0 sm:pl-4">
              <span className="font-bold text-white border-b border-[#e8d4b8]/10 pb-1.5 block">Arquitetos (RT)</span>
              <div className="space-y-2 text-[#bba890]">
                <div className="flex justify-between"><span>1. Giselle S.</span> <span className="font-bold text-white">12 proj.</span></div>
                <div className="flex justify-between"><span>2. Simoni P.</span> <span className="font-bold text-white">8 proj.</span></div>
                <div className="flex justify-between"><span>3. Arthur G.</span> <span className="font-bold text-white">5 proj.</span></div>
              </div>
            </div>
            {/* Fornecedores */}
            <div className="space-y-3 border-t sm:border-t-0 sm:border-l border-[#e8d4b8]/10 pt-4 sm:pt-0 sm:pl-4">
              <span className="font-bold text-white border-b border-[#e8d4b8]/10 pb-1.5 block">Fornecedores</span>
              <div className="space-y-2 text-[#bba890]">
                <div className="flex justify-between"><span>1. Duratex</span> <span className="font-bold text-[#ead5ba]">98% OTD</span></div>
                <div className="flex justify-between"><span>2. Leo Madeiras</span> <span className="font-bold text-[#ead5ba]">92% OTD</span></div>
                <div className="flex justify-between"><span>3. Hettich</span> <span className="font-bold text-[#ead5ba]">89% OTD</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* AI Insight Box */}
        <div className="rounded-2xl border border-[#d6ad79]/20 bg-[#d6ad79]/5 p-5 space-y-3.5">
          <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-[#d6ad79]" /> Insights Estratégicos da IA
          </h3>
          <div className="space-y-3 text-xs text-[#bba890] leading-normal">
            <p>💡 **Otimização de Compras**: Duratex está com prazo de entrega de MDF (OTD) em 98%, superando Leo Madeiras. Priorize cotações com eles esta semana.</p>
            <p>📈 **Previsão de Fechamento**: O lead *Marina Silveira* tem 95% de chance de fechamento se o desconto de 3% no MDF Louro Freijó for aplicado hoje.</p>
            <p>⚠️ **Alerta de OEE**: Carga do Centro de Usinagem CNC atingiu 92% (sobrecarga). Recomenda-se remanejar ordens de furação para quinta-feira.</p>
          </div>
        </div>

      </div>

    </div>
  );
}

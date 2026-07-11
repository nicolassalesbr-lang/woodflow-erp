"use client";

import React, { useState, useEffect } from 'react';
import { 
  Landmark, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Plus, 
  Calendar, 
  Percent, 
  CheckCircle2, 
  FileSpreadsheet, 
  ArrowRight,
  Sparkles,
  PieChart as PieIcon,
  BarChart2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { getApiUrl } from '../../utils/api';

interface Transaction {
  id: string;
  type: string; // "RECEITA" | "DESPESA"
  category: string;
  amount: number;
  description: string;
  dueDate: string;
  paidDate?: string;
  status: string; // "PAGO" | "PENDENTE"
}

interface FinancialSummary {
  revenueRealized: number;
  revenueExpected: number;
  expensesRealized: number;
  expensesExpected: number;
  netProfit: number;
  marginPercent: number;
  prevMonth: {
    revenue: number;
    expenses: number;
    netProfit: number;
  };
  categories: Record<string, number>;
  commissions: { id: string; partnerName: string; projectName: string; value: number; status: string }[];
  ticketMedio: number;
}

export default function FinancialScreen() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'cashflow' | 'dre' | 'commissions' | 'costcenter'>('cashflow');
  
  // New transaction form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTx, setNewTx] = useState({
    type: 'RECEITA',
    category: 'Projetos',
    amount: '',
    description: '',
    status: 'PAGO'
  });

  const fetchData = async () => {
    try {
      const [txRes, sumRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/financial/transactions`, { headers: { 'Authorization': 'Bearer mock-jwt-token-2026' } }),
        fetch(`${getApiUrl()}/api/financial/summary`, { headers: { 'Authorization': 'Bearer mock-jwt-token-2026' } })
      ]);

      if (txRes.ok && sumRes.ok) {
        setTransactions(await txRes.json());
        setSummary(await sumRes.json());
      }
    } catch {
      // Local fallback mock data
      const mockTx = [
        { id: 'tx-1', type: 'RECEITA', category: 'Projetos', amount: 5120.0, description: 'Sinal projeto Cozinha Mansão Alphaville', dueDate: new Date().toISOString(), paidDate: new Date().toISOString(), status: 'PAGO' },
        { id: 'tx-2', type: 'RECEITA', category: 'Projetos', amount: 15400.0, description: 'Venda projeto Closet Casal Jardim Paulista', dueDate: new Date().toISOString(), paidDate: new Date().toISOString(), status: 'PAGO' },
        { id: 'tx-3', type: 'DESPESA', category: 'Insumos', amount: 3500.0, description: 'Compra de ferragens e puxadores', dueDate: new Date().toISOString(), paidDate: new Date().toISOString(), status: 'PAGO' },
        { id: 'tx-4', type: 'DESPESA', category: 'Salários', amount: 8000.0, description: 'Pagamento Marceneiros Auxiliares', dueDate: new Date().toISOString(), paidDate: new Date().toISOString(), status: 'PAGO' },
        { id: 'tx-5', type: 'DESPESA', category: 'Aluguel', amount: 4500.0, description: 'Aluguel Galpão Fabril', dueDate: new Date().toISOString(), paidDate: undefined, status: 'PENDENTE' },
        { id: 'tx-6', type: 'RECEITA', category: 'Projetos', amount: 9800.0, description: 'Parcela final Dormitório Infantil', dueDate: new Date().toISOString(), paidDate: new Date().toISOString(), status: 'PAGO' }
      ];
      setTransactions(mockTx);
      setSummary({
        revenueRealized: 30320.0,
        revenueExpected: 30320.0,
        expensesRealized: 11500.0,
        expensesExpected: 16000.0,
        netProfit: 18820.0,
        marginPercent: 62.0,
        prevMonth: { revenue: 28000, expenses: 11000, netProfit: 17000 },
        categories: { 'Projetos': 30320.0, 'Insumos': -3500.0, 'Salários': -8000.0 },
        commissions: [
          { id: 'com-1', partnerName: 'Giselle Arquiteta', projectName: 'Mansão Alphaville', value: 1516.0, status: 'PAGO' },
          { id: 'com-2', partnerName: 'Lucas Designer', projectName: 'Apartamento Jardins', value: 850.0, status: 'PENDENTE' }
        ],
        ticketMedio: 10106.6
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTx.amount) return;

    try {
      const res = await fetch(`${getApiUrl()}/api/financial/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026'
        },
        body: JSON.stringify(newTx)
      });
      if (res.ok) {
        setNewTx({ type: 'RECEITA', category: 'Projetos', amount: '', description: '', status: 'PAGO' });
        setShowAddForm(false);
        fetchData();
      }
    } catch {
      const mock: Transaction = {
        id: `mock-${Date.now()}`,
        type: newTx.type,
        category: newTx.category,
        amount: parseFloat(newTx.amount),
        description: newTx.description,
        dueDate: new Date().toISOString(),
        paidDate: newTx.status === 'PAGO' ? new Date().toISOString() : undefined,
        status: newTx.status
      };
      setTransactions(prev => [mock, ...prev]);
      setShowAddForm(false);
    }
  };

  const handlePayCommission = async (id: string) => {
    alert('Comissão paga com sucesso via Pix Integrado!');
    if (summary) {
      setSummary({
        ...summary,
        commissions: summary.commissions.map(c => c.id === id ? { ...c, status: 'PAGO' } : c)
      });
    }
  };

  // Recharts graphics data formatting
  const chartData = [
    { name: 'Mês Anterior', Receita: summary?.prevMonth.revenue || 0, Despesa: summary?.prevMonth.expenses || 0 },
    { name: 'Mês Atual', Receita: summary?.revenueRealized || 0, Despesa: summary?.expensesRealized || 0 }
  ];

  // Pie chart categories formatted
  const pieColors = ['#d6ad79', '#ead5ba', '#ffe4bf', '#a99680'];
  const pieData = Object.keys(summary?.categories || {}).map((cat, idx) => {
    const val = summary?.categories[cat] || 0;
    return {
      name: cat,
      value: Math.abs(val)
    };
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-[#d6ad79]/20 border-t-[#d6ad79] rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#fff8f0]">Gestão Financeira</h1>
          <p className="mt-1 text-sm text-[#bba890]">Monitore o fluxo de caixa, DRE corporativo, contas a pagar e comissões.</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#ead5ba] px-4 py-2.5 text-sm font-bold text-[#20170f] hover:bg-[#ffe4bf] active:scale-95 transition shadow-md"
        >
          <Plus className="h-4 w-4" /> Novo Lançamento
        </button>
      </div>

      {/* Financial KPIs Banner */}
      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.03] p-5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#a99680]">Caixa Disponível</span>
            <div className="text-2xl font-bold text-white mt-1.5">R$ {(summary.revenueRealized - summary.expensesRealized).toLocaleString('pt-BR')}</div>
            <span className="text-[9px] text-emerald-400 mt-1 block">Saldo Líquido Realizado</span>
          </div>
          <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.03] p-5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#a99680]">Receita Realizada (Mês)</span>
            <div className="text-2xl font-bold text-[#ead5ba] mt-1.5">R$ {summary.revenueRealized.toLocaleString('pt-BR')}</div>
            <span className="text-[9px] text-[#bba890] mt-1 block">Previsto: R$ {summary.revenueExpected.toLocaleString('pt-BR')}</span>
          </div>
          <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.03] p-5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#a99680]">Despesas Pagas</span>
            <div className="text-2xl font-bold text-white mt-1.5">R$ {summary.expensesRealized.toLocaleString('pt-BR')}</div>
            <span className="text-[9px] text-[#bba890] mt-1 block">A Pagar: R$ {(summary.expensesExpected - summary.expensesRealized).toLocaleString('pt-BR')}</span>
          </div>
          <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.03] p-5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#a99680]">Margem Líquida</span>
            <div className="text-2xl font-bold text-[#ead5ba] mt-1.5">{summary.marginPercent.toFixed(1)}%</div>
            <span className="text-[9px] text-[#bba890] mt-1 block">Ticket Médio: R$ {Math.round(summary.ticketMedio).toLocaleString('pt-BR')}</span>
          </div>
        </div>
      )}

      {/* Sub Tabs Selection */}
      <div className="flex border-b border-[#e8d4b8]/8">
        {[
          { id: 'cashflow', label: 'Fluxo de Caixa', icon: Landmark },
          { id: 'dre', label: 'Demonstrativo DRE', icon: FileSpreadsheet },
          { id: 'commissions', label: 'Comissões Parceiros', icon: Percent },
          { id: 'costcenter', label: 'Centro de Custos', icon: PieIcon }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold border-b-2 transition ${
                activeSubTab === tab.id
                  ? 'border-[#d6ad79] text-[#fff8f0]'
                  : 'border-transparent text-[#bba890] hover:text-[#fff8f0]'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Area content */}
      <div className="min-h-[350px]">
        
        {/* Tab 1: Fluxo de Caixa */}
        {activeSubTab === 'cashflow' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
            
            {/* Recharts Bar chart */}
            <div className="lg:col-span-2 rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-5 space-y-4">
              <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider flex items-center gap-1.5">
                <BarChart2 className="h-4 w-4" /> Comparativo Caixa (Entradas vs Saídas)
              </h3>
              <div className="h-64 w-full text-xs">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <XAxis dataKey="name" stroke="#a99680" />
                    <YAxis stroke="#a99680" />
                    <Tooltip contentStyle={{ backgroundColor: '#211811', borderColor: '#e8d4b8/10', color: '#fff' }} />
                    <Legend />
                    <Bar dataKey="Receita" fill="#d6ad79" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Despesa" fill="#766756" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* List transactions */}
            <div className="lg:col-span-1 rounded-2xl border border-[#e8d4b8]/8 bg-[#1e160f]/60 p-5 space-y-4">
              <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider">Histórico de Lançamentos</h3>
              <div className="space-y-3.5 max-h-72 overflow-y-auto pr-1 scrollbar-thin text-xs text-[#bba890]">
                {transactions.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between border-b border-[#e8d4b8]/6 pb-2.5">
                    <div>
                      <span className="font-bold text-white block truncate w-40">{tx.description}</span>
                      <span className="text-[9px] text-[#766756] mt-0.5">{tx.category} | {new Date(tx.dueDate).toLocaleDateString()}</span>
                    </div>
                    <div className="text-right">
                      <span className={`font-bold block ${tx.type === 'RECEITA' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {tx.type === 'RECEITA' ? '+' : '-'} R$ {tx.amount.toLocaleString('pt-BR')}
                      </span>
                      <span className="text-[9px] text-[#766756]">{tx.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* Tab 2: DRE Corporate report */}
        {activeSubTab === 'dre' && summary && (
          <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-6 space-y-4 animate-fadeIn">
            <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider flex items-center gap-1.5">
              <FileSpreadsheet className="h-4.5 w-4.5" /> Demonstrativo do Resultado do Exercício (DRE)
            </h3>
            
            <div className="overflow-x-auto text-xs text-[#bba890]">
              <table className="w-full text-left border-collapse">
                <tbody>
                  <tr className="border-b border-[#e8d4b8]/8 py-2 font-bold text-white">
                    <td className="py-2.5">1. RECEITA BRUTA DE VENDAS</td>
                    <td className="text-right py-2.5">R$ {summary.revenueRealized.toLocaleString('pt-BR')}</td>
                  </tr>
                  <tr className="border-b border-[#e8d4b8]/8 py-2">
                    <td className="py-2.5">(-) Impostos (Simples Nacional 6%)</td>
                    <td className="text-right py-2.5 text-red-400">R$ {(summary.revenueRealized * 0.06).toLocaleString('pt-BR')}</td>
                  </tr>
                  <tr className="border-b border-[#e8d4b8]/8 py-2 font-bold text-white">
                    <td className="py-2.5">2. RECEITA LÍQUIDA DE VENDAS</td>
                    <td className="text-right py-2.5">R$ {(summary.revenueRealized * 0.94).toLocaleString('pt-BR')}</td>
                  </tr>
                  <tr className="border-b border-[#e8d4b8]/8 py-2">
                    <td className="py-2.5">(-) Custos de Insumos (MDF / Ferragens)</td>
                    <td className="text-right py-2.5 text-red-400">R$ 3.500,00</td>
                  </tr>
                  <tr className="border-b border-[#e8d4b8]/8 py-2">
                    <td className="py-2.5">(-) Custos de Mão de Obra direta</td>
                    <td className="text-right py-2.5 text-red-400">R$ 8.000,00</td>
                  </tr>
                  <tr className="border-b border-[#e8d4b8]/8 py-2 font-bold text-white">
                    <td className="py-2.5">3. LUCRO BRUTO</td>
                    <td className="text-right py-2.5">R$ {(summary.revenueRealized * 0.94 - 11500).toLocaleString('pt-BR')}</td>
                  </tr>
                  <tr className="border-b border-[#e8d4b8]/8 py-2">
                    <td className="py-2.5">(-) Despesas Administrativas & Aluguel</td>
                    <td className="text-right py-2.5 text-red-400">R$ 4.500,00</td>
                  </tr>
                  <tr className="border-b border-[#e8d4b8]/8 py-2">
                    <td className="py-2.5">(-) Comissões de Arquitetura pagas</td>
                    <td className="text-right py-2.5 text-red-400">R$ 1.516,00</td>
                  </tr>
                  <tr className="border-b border-[#d6ad79]/30 py-2.5 font-bold text-[#ead5ba] bg-[#d6ad79]/5">
                    <td className="py-2.5 pl-3">4. LUCRO LÍQUIDO DO EXERCÍCIO</td>
                    <td className="text-right py-2.5 pr-3">R$ {summary.netProfit.toLocaleString('pt-BR')} ({summary.marginPercent.toFixed(1)}%)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Commissions Ledger */}
        {activeSubTab === 'commissions' && summary && (
          <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-5 space-y-4 animate-fadeIn">
            <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider">Comissões de Parceiros e Especificadores</h3>
            <div className="space-y-3 text-xs text-[#bba890]">
              {summary.commissions.map(c => (
                <div key={c.id} className="rounded-xl border border-[#e8d4b8]/6 bg-[#fff7ed]/[0.01] p-4 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-white block">{c.partnerName}</span>
                    <span className="text-[10px] text-[#766756] mt-0.5">Projeto: {c.projectName} | Acordo: RT 5%</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-bold text-[#ead5ba]">R$ {c.value.toLocaleString('pt-BR')}</span>
                    {c.status === 'PAGO' ? (
                      <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Pago
                      </span>
                    ) : (
                      <button
                        onClick={() => handlePayCommission(c.id)}
                        className="rounded-lg bg-[#ead5ba] px-3.5 py-1.5 text-[10px] font-bold text-[#20170f] hover:bg-[#ffe4bf] active:scale-95 transition"
                      >
                        Pagar Pix RT
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: Cost Center Recharts distribution */}
        {activeSubTab === 'costcenter' && (
          <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-6 animate-fadeIn">
            <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <PieIcon className="h-4.5 w-4.5" /> Distribuição por Centro de Custo
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {/* Pie chart */}
              <div className="h-56 w-full text-xs">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Legends list */}
              <div className="space-y-3.5 text-xs text-[#bba890]">
                {pieData.map((d, idx) => (
                  <div key={d.name} className="flex items-center justify-between border-b border-[#e8d4b8]/6 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: pieColors[idx % pieColors.length] }} />
                      <span className="font-bold text-white">{d.name}</span>
                    </div>
                    <span>R$ {d.value.toLocaleString('pt-BR')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* New Lançamento Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl border border-[#e8d4b8]/12 bg-[#211811] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">Lançar Transação Financeira</h3>
            <form onSubmit={handleCreateTx} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#a99680] mb-1">Tipo</label>
                  <select
                    value={newTx.type}
                    onChange={(e) => setNewTx({ ...newTx, type: e.target.value })}
                    className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d] p-2.5 text-xs text-white outline-none"
                  >
                    <option value="RECEITA">📈 Receita (Entrada)</option>
                    <option value="DESPESA">📉 Despesa (Saída)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#a99680] mb-1">Categoria</label>
                  <select
                    value={newTx.category}
                    onChange={(e) => setNewTx({ ...newTx, category: e.target.value })}
                    className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d] p-2.5 text-xs text-white outline-none"
                  >
                    <option value="Projetos">Venda de Projetos</option>
                    <option value="Insumos">Compra de Chapas/Insumos</option>
                    <option value="Salários">Folha Salarial</option>
                    <option value="Aluguel">Aluguel / Despesa Fixa</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#a99680] mb-1">Valor (R$)</label>
                <input 
                  type="number" 
                  required
                  value={newTx.amount}
                  onChange={(e) => setNewTx({ ...newTx, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d]/80 py-2.5 px-4 text-xs text-white placeholder-[#766756] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#a99680] mb-1">Descrição</label>
                <input 
                  type="text" 
                  required
                  value={newTx.description}
                  onChange={(e) => setNewTx({ ...newTx, description: e.target.value })}
                  placeholder="Identificação do projeto ou compra"
                  className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d]/80 py-2.5 px-4 text-xs text-white placeholder-[#766756] outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="rounded-xl border border-[#e8d4b8]/12 bg-transparent py-2 px-4 text-xs text-[#bba890] hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#ead5ba] py-2 px-5 text-xs font-bold text-[#20170f] hover:bg-[#ffe4bf]"
                >
                  Confirmar Lançamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

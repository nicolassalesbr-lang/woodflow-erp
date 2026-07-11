"use client";

import React, { useState, useEffect } from 'react';
import { 
  ShoppingCart, 
  Plus, 
  Search, 
  CheckCircle2, 
  Clock, 
  Truck, 
  AlertCircle, 
  Calendar, 
  DollarSign, 
  Building,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getApiUrl } from '../../utils/api';

interface PurchaseOrder {
  id: string;
  supplier: string;
  items: string;
  totalValue: number;
  status: string; // "COTACAO" | "PEDIDO_ENVIADO" | "ENTREGUE" | "CANCELADO"
  createdAt: string;
}

export default function PurchasesScreen() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newOrder, setNewOrder] = useState({
    supplier: '',
    items: '',
    totalValue: '',
    status: 'COTACAO'
  });

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/purchases/orders`, {
        headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
      });
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch {
      // Local fallback mock data
      const mock = [
        { id: 'po-1', supplier: 'Duratex Chapas', items: '20 chapas MDF Branco TX 18mm, 10 chapas MDF Louro Freijó 15mm', totalValue: 6800.0, status: 'ENTREGUE', createdAt: new Date(Date.now() - 3600000 * 48).toISOString() },
        { id: 'po-2', supplier: 'Hettich Ferragens', items: '100 corrediças telescópicas 45cm, 150 dobradiças amortecedor 35mm', totalValue: 4200.0, status: 'PEDIDO_ENVIADO', createdAt: new Date(Date.now() - 3600000 * 24).toISOString() },
        { id: 'po-3', supplier: 'Leo Madeiras', items: '50 chapas MDF Grafite Veludo 18mm, Fita de borda', totalValue: 12500.0, status: 'COTACAO', createdAt: new Date().toISOString() }
      ];
      setOrders(mock);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrder.supplier || !newOrder.items || !newOrder.totalValue) return;

    try {
      const res = await fetch(`${getApiUrl()}/api/purchases/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026'
        },
        body: JSON.stringify(newOrder)
      });
      if (res.ok) {
        setNewOrder({ supplier: '', items: '', totalValue: '', status: 'COTACAO' });
        setShowAddForm(false);
        fetchOrders();
      }
    } catch {
      const mock: PurchaseOrder = {
        id: `mock-po-${Date.now()}`,
        supplier: newOrder.supplier,
        items: newOrder.items,
        totalValue: parseFloat(newOrder.totalValue),
        status: newOrder.status,
        createdAt: new Date().toISOString()
      };
      setOrders(prev => [mock, ...prev]);
      setShowAddForm(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/purchases/orders/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026'
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        fetchOrders();
      }
    } catch {
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus } : o));
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ENTREGUE':
        return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      case 'PEDIDO_ENVIADO':
        return 'bg-[#d6ad79]/20 text-[#fff8f0] border border-[#d6ad79]/30';
      case 'COTACAO':
      default:
        return 'bg-[#fff7ed]/[0.05] text-[#bba890] border border-[#e8d4b8]/12';
    }
  };

  const filteredOrders = orders.filter(o => 
    o.supplier.toLowerCase().includes(searchQuery.toLowerCase()) || 
    o.items.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#fff8f0]">Compras & Suprimentos</h1>
          <p className="mt-1 text-sm text-[#bba890]">Gerencie cotações com fornecedores, aprove compras e confirme recebimento de MDF.</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#ead5ba] px-4 py-2.5 text-sm font-bold text-[#20170f] hover:bg-[#ffe4bf] active:scale-95 transition shadow-md"
        >
          <Plus className="h-4 w-4" /> Novo Pedido
        </button>
      </div>

      {/* Search Filter */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a99680]" />
        <input 
          type="text" 
          placeholder="Pesquisar por fornecedor ou descrição dos insumos..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-[#e8d4b8]/12 bg-[#211811]/60 py-2 pl-10 pr-4 text-xs text-[#fff8f0] placeholder-[#766756] outline-none"
        />
      </div>

      {/* Orders grid */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-8 text-center text-xs text-[#a99680]">Carregando pedidos de compras...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e8d4b8]/8 py-16 text-center text-xs text-[#a99680]">
            Nenhum pedido de compra ou cotação registrado.
          </div>
        ) : (
          filteredOrders.map(order => (
            <div 
              key={order.id}
              className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition hover:border-[#d6ad79]/20"
            >
              <div className="space-y-2 max-w-xl">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-white flex items-center gap-1.5 text-sm">
                    <Building className="h-4 w-4 text-[#d6ad79]" /> {order.supplier}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[8.5px] font-bold uppercase ${getStatusBadge(order.status)}`}>
                    {order.status === 'COTACAO' ? 'Cotação' : order.status === 'PEDIDO_ENVIADO' ? 'Pedido Enviado' : order.status}
                  </span>
                </div>
                <p className="text-xs text-[#bba890] leading-normal">{order.items}</p>
                <div className="flex items-center gap-4 text-[10px] text-[#766756] font-semibold">
                  <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {new Date(order.createdAt).toLocaleDateString()}</span>
                  <span className="flex items-center gap-0.5"><DollarSign className="h-3.5 w-3.5 text-[#d6ad79]" /> R$ {order.totalValue.toLocaleString('pt-BR')}</span>
                </div>
              </div>

              {/* Action buttons based on status */}
              <div className="flex gap-2 w-full sm:w-auto shrink-0 justify-end">
                {order.status === 'COTACAO' && (
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'PEDIDO_ENVIADO')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ead5ba] hover:bg-[#ffe4bf] text-[#20170f] font-bold text-xs transition"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar Cotação
                  </button>
                )}
                {order.status === 'PEDIDO_ENVIADO' && (
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'ENTREGUE')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#d6ad79]/20 bg-[#d6ad79]/10 text-xs font-bold text-[#ead5ba] hover:bg-[#d6ad79]/20 transition animate-pulse"
                  >
                    <Truck className="h-3.5 w-3.5 text-[#d6ad79]" /> Confirmar Entrega
                  </button>
                )}
                {order.status === 'ENTREGUE' && (
                  <span className="flex items-center gap-1 text-emerald-400 text-xs font-bold bg-emerald-500/5 px-3 py-1.5 rounded-lg border border-emerald-500/10 select-none">
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Estoque Abastecido
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Order Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl border border-[#e8d4b8]/12 bg-[#211811] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">Criar Pedido de Compra / Cotação</h3>
            <form onSubmit={handleCreateOrder} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#a99680] mb-1">Fornecedor</label>
                <input 
                  type="text" 
                  required
                  value={newOrder.supplier}
                  onChange={(e) => setNewOrder({ ...newOrder, supplier: e.target.value })}
                  placeholder="Ex: Duratex Chapas S.A."
                  className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d]/80 py-2.5 px-4 text-xs text-white placeholder-[#766756] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#a99680] mb-1">Itens (Descrição completa)</label>
                <textarea 
                  required
                  value={newOrder.items}
                  onChange={(e) => setNewOrder({ ...newOrder, items: e.target.value })}
                  placeholder="Ex: 10 chapas MDF Branco TX 18mm, 50 dobradiças 35mm"
                  rows={3}
                  className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d]/80 py-2.5 px-4 text-xs text-white placeholder-[#766756] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#a99680] mb-1">Valor Estimado (R$)</label>
                <input 
                  type="number" 
                  required
                  value={newOrder.totalValue}
                  onChange={(e) => setNewOrder({ ...newOrder, totalValue: e.target.value })}
                  placeholder="0.00"
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
                  Salvar Pedido
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

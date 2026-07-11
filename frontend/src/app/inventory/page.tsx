"use client";

import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Plus, 
  Search, 
  AlertTriangle, 
  RefreshCcw, 
  QrCode, 
  CheckCircle2, 
  Tag, 
  SlidersHorizontal,
  ChevronRight,
  TrendingDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getApiUrl } from '../../utils/api';

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  sku: string;
  quantity: number;
  minThreshold: number;
  unit: string;
  qrCode?: string;
}

export default function InventoryScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('Todos');
  
  // Modals
  const [showScanner, setShowScanner] = useState(false);
  const [scannedItem, setScannedItem] = useState<InventoryItem | null>(null);
  const [scannerAction, setScannerAction] = useState<'add' | 'remove'>('remove');
  const [scannerQty, setScannerQty] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // New Item state
  const [newItem, setNewItem] = useState({
    name: '',
    category: 'MDF',
    sku: '',
    quantity: '',
    minThreshold: '',
    unit: 'chapa'
  });

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/inventory`, {
        headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
      });
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      // Local fallback mock data
      const mock = [
        { id: 'inv-1', name: 'MDF Branco TX 18mm', category: 'MDF', sku: 'MDF-BR-18', quantity: 12, minThreshold: 15, unit: 'chapa', qrCode: 'QR-MDF-BR-18' },
        { id: 'inv-2', name: 'MDF Louro Freijó 15mm', category: 'MDF', sku: 'MDF-LF-15', quantity: 35, minThreshold: 8, unit: 'chapa', qrCode: 'QR-MDF-LF-15' },
        { id: 'inv-3', name: 'Dobradiça amortecedor 35mm clip', category: 'HARDWARE', sku: 'DOB-AM-35', quantity: 450, minThreshold: 80, unit: 'un', qrCode: 'QR-DOB-AM-35' },
        { id: 'inv-4', name: 'Corrediça Telescópica 45cm', category: 'HARDWARE', sku: 'COR-TE-45', quantity: 24, minThreshold: 30, unit: 'un', qrCode: 'QR-COR-TE-45' }
      ];
      setItems(mock);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name || !newItem.sku) return;

    try {
      // Post item to backend
      const res = await fetch(`${getApiUrl()}/api/inventory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026'
        },
        body: JSON.stringify({
          ...newItem,
          quantity: parseFloat(newItem.quantity || '0'),
          minThreshold: parseFloat(newItem.minThreshold || '10')
        })
      });
      if (res.ok) {
        setNewItem({ name: '', category: 'MDF', sku: '', quantity: '', minThreshold: '', unit: 'chapa' });
        setShowAddForm(false);
        fetchInventory();
      }
    } catch {
      const mock: InventoryItem = {
        id: `mock-inv-${Date.now()}`,
        name: newItem.name,
        category: newItem.category,
        sku: newItem.sku,
        quantity: parseFloat(newItem.quantity || '0'),
        minThreshold: parseFloat(newItem.minThreshold || '10'),
        unit: newItem.unit,
        qrCode: `QR-${newItem.sku}`
      };
      setItems(prev => [mock, ...prev]);
      setShowAddForm(false);
    }
  };

  // Automated refill of items below threshold
  const handleAutoRefill = async (item: InventoryItem) => {
    try {
      // Simulate Copilot command to restock
      const res = await fetch(`${getApiUrl()}/api/copilot/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026'
        },
        body: JSON.stringify({ message: `Comprar 20 unidades de ${item.sku}` })
      });
      if (res.ok) {
        alert(`Pedido de reposição automática de +20 unidades gerado para ${item.name}!`);
        fetchInventory();
      }
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 20 } : i));
      alert(`Offline: Solicitação de reposição de +20 chapas enviada para compras.`);
    }
  };

  // Simulate scanning QR Code physically on a sheet of MDF or hardware box
  const handleScanQRCode = (code: string) => {
    const item = items.find(i => i.qrCode === code || i.sku === code);
    if (item) {
      setScannedItem(item);
    } else {
      alert('QR Code ou SKU não identificado no estoque.');
    }
  };

  const handleApplyScanAction = async () => {
    if (!scannedItem) return;
    const factor = scannerAction === 'add' ? 1 : -1;
    const newQty = Math.max(0, scannedItem.quantity + (scannerQty * factor));

    try {
      // Call endpoint to consume or refill
      await fetch(`${getApiUrl()}/api/inventory/consume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026'
        },
        body: JSON.stringify({ sku: scannedItem.sku, quantity: scannerQty * factor })
      });
      fetchInventory();
      setShowScanner(false);
      setScannedItem(null);
    } catch {
      setItems(prev => prev.map(i => i.id === scannedItem.id ? { ...i, quantity: newQty } : i));
      setShowScanner(false);
      setScannedItem(null);
    }
  };

  // Filters
  const filteredItems = items.filter(i => {
    const matchesSearch = i.name.toLowerCase().includes(searchQuery.toLowerCase()) || i.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = activeCategory === 'Todos' || i.category === activeCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#fff8f0]">Estoque de Insumos</h1>
          <p className="mt-1 text-sm text-[#bba890]">Gerencie MDF, ferragens, controle limites de segurança e escaneie QR Codes.</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowScanner(true)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-[#d6ad79]/30 bg-[#d6ad79]/10 px-4 py-2.5 text-xs font-bold text-[#ead5ba] hover:bg-[#d6ad79]/20 transition"
          >
            <QrCode className="h-4 w-4" /> Bipar QR Code
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#ead5ba] px-4 py-2.5 text-sm font-bold text-[#20170f] hover:bg-[#ffe4bf] active:scale-95 transition shadow-md"
          >
            <Plus className="h-4 w-4" /> Novo Insumo
          </button>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a99680]" />
          <input 
            type="text" 
            placeholder="Pesquisar por nome ou SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-[#e8d4b8]/12 bg-[#211811]/60 py-2 pl-10 pr-4 text-xs text-[#fff8f0] placeholder-[#766756] outline-none"
          />
        </div>
        <div className="flex gap-1.5">
          {['Todos', 'MDF', 'HARDWARE', 'ACCESSORY'].map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
                activeCategory === cat
                  ? 'bg-[#d6ad79]/20 border-[#d6ad79]/45 text-[#fff8f0]'
                  : 'bg-transparent border-[#e8d4b8]/8 text-[#bba890] hover:text-[#fff8f0]'
              }`}
            >
              {cat === 'Todos' ? 'Todos' : cat === 'HARDWARE' ? 'Ferragens' : cat === 'ACCESSORY' ? 'Acessórios' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory table */}
      <div className="overflow-x-auto rounded-2xl border border-[#e8d4b8]/8 bg-[#1e160f]/60">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#e8d4b8]/10 bg-[#1e160f] text-[#ead5ba] font-bold">
              <th className="p-3.5">Nome do Item</th>
              <th className="p-3.5">Categoria</th>
              <th className="p-3.5">SKU</th>
              <th className="p-3.5 text-center">Mínimo</th>
              <th className="p-3.5 text-center">Qtd. Atual</th>
              <th className="p-3.5 text-center">Unidade</th>
              <th className="p-3.5 text-center">Status</th>
              <th className="p-3.5 text-center">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map(item => {
              const isCritical = item.quantity <= item.minThreshold;
              return (
                <tr key={item.id} className="border-b border-[#e8d4b8]/6 hover:bg-[#fff7ed]/[0.01]">
                  <td className="p-3.5 font-bold text-white">{item.name}</td>
                  <td className="p-3.5 text-[#bba890]">{item.category}</td>
                  <td className="p-3.5 font-mono text-[11px] text-[#ead5ba]">{item.sku}</td>
                  <td className="p-3.5 text-center text-gray-400 font-semibold">{item.minThreshold}</td>
                  <td className="p-3.5 text-center font-black text-white text-sm">{item.quantity}</td>
                  <td className="p-3.5 text-center text-gray-500">{item.unit}</td>
                  <td className="p-3.5 text-center">
                    {isCritical ? (
                      <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-[9px] font-bold text-red-400 border border-red-500/20">
                        <AlertTriangle className="h-3 w-3 shrink-0" /> Crítico
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-[#d6ad79]/10 px-2 py-0.5 text-[9px] font-bold text-[#ead5ba] border border-[#d6ad79]/20">
                        Ok
                      </span>
                    )}
                  </td>
                  <td className="p-3.5 text-center">
                    {isCritical && (
                      <button
                        onClick={() => handleAutoRefill(item)}
                        className="flex items-center justify-center gap-1.5 mx-auto rounded-lg bg-[#ead5ba] px-2.5 py-1 text-[10px] font-bold text-[#20170f] hover:bg-[#ffe4bf] transition"
                        title="Reposição Automática"
                      >
                        <RefreshCcw className="h-3 w-3" /> Refilar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* QR Code Scanner Popup Simulator */}
      {showScanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm rounded-2xl border border-[#e8d4b8]/12 bg-[#211811] p-6 text-center shadow-2xl space-y-4">
            <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider">Scanner de QR Code de Insumo</h3>
            
            {/* Simulation scanner green/red layout */}
            <div className="h-44 w-full bg-[#18120d] rounded-xl border border-[#e8d4b8]/12 relative flex items-center justify-center overflow-hidden">
              <div className="absolute inset-x-4 h-0.5 bg-red-500 animate-scanLine" />
              <div className="border border-dashed border-[#ead5ba] h-28 w-28 rounded-lg" />
            </div>

            <p className="text-[10px] text-[#bba890]">Clique em uma etiqueta rápida abaixo para simular a leitura do sensor ótico.</p>
            
            {/* Quick simulator buttons */}
            <div className="grid grid-cols-2 gap-2">
              {items.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleScanQRCode(item.qrCode || '')}
                  className="rounded border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-1.5 text-[9px] text-white truncate hover:border-[#d6ad79]/30"
                >
                  {item.sku}
                </button>
              ))}
            </div>

            {/* Scanned result box */}
            {scannedItem && (
              <div className="p-3 bg-[#d6ad79]/5 border border-[#d6ad79]/15 rounded-lg text-left text-xs space-y-3">
                <span className="font-bold text-white">{scannedItem.name}</span>
                <p className="text-[10px] text-[#bba890]">Qtd. Atual: {scannedItem.quantity} {scannedItem.unit}</p>
                
                <div className="flex gap-2 items-center">
                  <select
                    value={scannerAction}
                    onChange={(e: any) => setScannerAction(e.target.value)}
                    className="rounded border border-[#e8d4b8]/12 bg-[#18120d] p-1 text-[10px] text-white outline-none"
                  >
                    <option value="remove">📉 Baixa (Consumo)</option>
                    <option value="add">📈 Adicionar (Entrada)</option>
                  </select>
                  <input
                    type="number"
                    value={scannerQty}
                    onChange={(e) => setScannerQty(parseInt(e.target.value) || 1)}
                    className="w-12 rounded border border-[#e8d4b8]/12 bg-[#18120d] p-1 text-[10px] text-center text-white"
                  />
                  <button
                    onClick={handleApplyScanAction}
                    className="rounded bg-[#ead5ba] px-3 py-1.5 text-[10px] font-bold text-[#20170f] hover:bg-[#ffe4bf]"
                  >
                    Lançar
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setShowScanner(false);
                setScannedItem(null);
              }}
              className="text-xs text-gray-500 hover:text-white block mx-auto pt-2"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl border border-[#e8d4b8]/12 bg-[#211811] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">Cadastrar Insumo no Estoque</h3>
            <form onSubmit={handleCreateItem} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#a99680] mb-1">Nome do Item</label>
                <input 
                  type="text" 
                  required
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  placeholder="Ex: MDF Grafite Veludo 18mm"
                  className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d]/80 py-2.5 px-4 text-xs text-white placeholder-[#766756] outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#a99680] mb-1">Categoria</label>
                  <select
                    value={newItem.category}
                    onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                    className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d] p-2.5 text-xs text-white outline-none"
                  >
                    <option value="MDF">Chapa de MDF</option>
                    <option value="HARDWARE">Ferragem</option>
                    <option value="ACCESSORY">Acessório / Puxador</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#a99680] mb-1">SKU do Item</label>
                  <input 
                    type="text" 
                    required
                    value={newItem.sku}
                    onChange={(e) => setNewItem({ ...newItem, sku: e.target.value })}
                    placeholder="MDF-GF-18"
                    className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d]/80 py-2.5 px-4 text-xs text-white outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#a99680] mb-1">Qtd. Inicial</label>
                  <input 
                    type="number" 
                    value={newItem.quantity}
                    onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })}
                    className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d]/80 py-2.5 px-3 text-xs text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#a99680] mb-1">Mínimo</label>
                  <input 
                    type="number" 
                    value={newItem.minThreshold}
                    onChange={(e) => setNewItem({ ...newItem, minThreshold: e.target.value })}
                    className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d]/80 py-2.5 px-3 text-xs text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#a99680] mb-1">Unidade</label>
                  <select
                    value={newItem.unit}
                    onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                    className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d] p-2.5 text-xs text-white outline-none"
                  >
                    <option value="chapa">chapa</option>
                    <option value="un">un (peça)</option>
                    <option value="m">m (metros)</option>
                  </select>
                </div>
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
                  Adicionar Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

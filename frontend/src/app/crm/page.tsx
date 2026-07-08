"use client";

import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  MessageSquare, 
  Sparkles, 
  Mail, 
  Phone, 
  Activity, 
  Info,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  score: number;
  source: string;
  timeline: { id: string; type: string; content: string; author: string; createdAt: string }[];
}

export default function CRM() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [aiSummary, setAiSummary] = useState<{ summary: string; nextSteps: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState({ name: '', phone: '', email: '', source: 'Instagram' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNote, setNewNote] = useState('');

  const columns = [
    { key: 'NEW', label: 'Novos' },
    { key: 'CONTACT', label: 'Contatados' },
    { key: 'VISIT', label: 'Visita Técnica' },
    { key: 'BUDGET', label: 'Orçamentos' },
    { key: 'NEGOTIATION', label: 'Negociação' },
    { key: 'WON', label: 'Ganhos' },
    { key: 'LOSE', label: 'Perdidos' },
  ];

  const fetchLeads = async () => {
    try {
      const res = await fetch('http://localhost:3009/api/crm/leads', {
        headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
      });
      const data = await res.json();
      setLeads(Array.isArray(data) ? data : []);
    } catch {
      // Setup mock data if server is not reachable
      const mock = [
        {
          id: 'lead-1',
          name: 'Ana Cláudia Martins',
          phone: '+55 (11) 98765-4321',
          email: 'ana.claudia@gmail.com',
          status: 'NEW',
          source: 'Instagram',
          score: 50.0,
          timeline: [
            { id: '1', type: 'SYSTEM', content: 'Lead inicializado via Instagram.', author: 'System', createdAt: new Date().toISOString() }
          ]
        },
        {
          id: 'lead-2',
          name: 'Carlos Eduardo Nogueira',
          phone: '+55 (11) 97777-8888',
          email: 'carlos.ed@uol.com.br',
          status: 'VISIT',
          source: 'Indicação',
          score: 80.0,
          timeline: [
            { id: '2', type: 'SYSTEM', content: 'Visita técnica de medição agendada.', author: 'System', createdAt: new Date().toISOString() }
          ]
        },
        {
          id: 'lead-3',
          name: 'Marina Fontes Silveira',
          phone: '+55 (11) 96543-2109',
          email: 'marina.fontes@outlook.com',
          status: 'BUDGET',
          source: 'Arquiteto',
          score: 95.0,
          timeline: [
            { id: '3', type: 'SYSTEM', content: 'Cozinha Gourmet e Closet no MDF Freijó calculados.', author: 'System', createdAt: new Date().toISOString() },
            { id: '4', type: 'WHATSAPP', content: 'Orçamento enviado. Aguardando aprovação das cores.', author: 'Leonardo', createdAt: new Date().toISOString() }
          ]
        }
      ];
      setLeads(mock);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const moveLead = async (leadId: string, newStatus: string) => {
    try {
      const res = await fetch(`http://localhost:3009/api/crm/leads/${leadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026',
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        if (newStatus === 'WON') {
          confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
        }
        fetchLeads();
      }
    } catch {
      // Local fallback
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l))
      );
      if (newStatus === 'WON') {
        confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
      }
    }
  };

  const createLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadForm.name) return;

    try {
      const res = await fetch('http://localhost:3009/api/crm/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026',
        },
        body: JSON.stringify(newLeadForm),
      });
      if (res.ok) {
        setNewLeadForm({ name: '', phone: '', email: '', source: 'Instagram' });
        setShowAddForm(false);
        fetchLeads();
      }
    } catch {
      const newMockLead = {
        id: `mock-${Date.now()}`,
        ...newLeadForm,
        status: 'NEW',
        score: 40.0,
        timeline: [{ id: 'm1', type: 'SYSTEM', content: 'Lead criado em modo Offline.', author: 'System', createdAt: new Date().toISOString() }]
      };
      setLeads((prev) => [newMockLead, ...prev]);
      setShowAddForm(false);
    }
  };

  const addNote = async () => {
    if (!selectedLead || !newNote.trim()) return;

    try {
      const res = await fetch(`http://localhost:3009/api/crm/leads/${selectedLead.id}/timeline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026',
        },
        body: JSON.stringify({ type: 'NOTE', content: newNote, author: 'Giselle' }),
      });
      if (res.ok) {
        setNewNote('');
        fetchLeads();
        // Refresh details
        const updated = await res.json();
        setSelectedLead((prev) => prev ? { ...prev, timeline: [updated, ...prev.timeline] } : null);
      }
    } catch {
      const updatedLead = { ...selectedLead };
      updatedLead.timeline.unshift({
        id: `m-${Date.now()}`,
        type: 'NOTE',
        content: newNote,
        author: 'Giselle',
        createdAt: new Date().toISOString()
      });
      setSelectedLead(updatedLead);
      setNewNote('');
    }
  };

  const loadAiSummary = async (leadId: string) => {
    setAiLoading(true);
    setAiSummary(null);
    try {
      const res = await fetch(`http://localhost:3009/api/crm/leads/${leadId}/ai-summary`, {
        headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
      });
      const data = await res.json();
      setAiSummary(data);
    } catch {
      setAiSummary({
        summary: `Resumo offline: O cliente demonstrou interesse em MDF Amadeirado Louro Freijó para a área da cozinha.`,
        nextSteps: `1. Enviar mensagens de opções de puxadores.\n2. Concluir orçamento.`
      });
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-10">
      
      {/* Header section */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-extrabold tracking-tight text-white font-sans">CRM & Funil WhatsApp</h1>
          <p className="text-gray-400 text-sm">Gerencie o relacionamento com clientes e construtoras.</p>
        </div>
        
        <button 
          onClick={() => setShowAddForm(true)}
          className="py-2.5 px-5 rounded-xl bg-emerald-500 text-background font-semibold text-sm flex items-center gap-2 hover:opacity-95 shadow-glow-emerald transition-all"
        >
          <Plus className="w-4 h-4" /> Novo Lead
        </button>
      </div>

      {/* Kanban Board Container */}
      <div className="flex gap-4 overflow-x-auto pb-4 min-h-[60vh]">
        {columns.map((col) => {
          const colLeads = leads.filter((l) => l.status === col.key);
          return (
            <div key={col.key} className="flex-1 min-w-[280px] max-w-[320px] bg-gray-950/20 rounded-2xl p-4 flex flex-col border border-border/5">
              
              {/* Column Header */}
              <div className="flex items-center justify-between mb-4 px-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{col.label}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-900 text-gray-400 border border-border">{colLeads.length}</span>
              </div>

              {/* Cards list */}
              <div className="space-y-3 flex-1 overflow-y-auto">
                {colLeads.map((lead) => (
                  <motion.div 
                    key={lead.id}
                    layoutId={lead.id}
                    onClick={() => {
                      setSelectedLead(lead);
                      loadAiSummary(lead.id);
                    }}
                    className="glass glass-hover p-4 rounded-xl cursor-pointer select-none space-y-3 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{lead.source}</span>
                        {lead.score >= 80 && (
                          <span className="text-[9px] font-extrabold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">Quente</span>
                        )}
                      </div>
                      <h4 className="text-sm font-semibold text-white tracking-tight">{lead.name}</h4>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border/30">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{lead.timeline?.length || 0}</span>
                      </div>
                      
                      {/* Drag & Drop controls simulator */}
                      <select 
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => moveLead(lead.id, e.target.value)}
                        value={lead.status}
                        className="text-[10px] bg-gray-900 border border-border rounded px-1.5 py-0.5 text-gray-400 focus:outline-none focus:border-emerald-500/40"
                      >
                        {columns.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Lead Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <form onSubmit={createLead} className="w-full max-w-md glass p-8 rounded-2xl space-y-6">
            <h3 className="text-lg font-bold text-white">Adicionar Novo Lead</h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Nome Completo</label>
                <input 
                  type="text" 
                  value={newLeadForm.name} 
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, name: e.target.value })}
                  placeholder="Nome do cliente"
                  className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none focus:border-emerald-500/40"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">WhatsApp</label>
                  <input 
                    type="text" 
                    value={newLeadForm.phone} 
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, phone: e.target.value })}
                    placeholder="(11) 98888-8888"
                    className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none focus:border-emerald-500/40"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">E-mail</label>
                  <input 
                    type="email" 
                    value={newLeadForm.email} 
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, email: e.target.value })}
                    placeholder="exemplo@gmail.com"
                    className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none focus:border-emerald-500/40"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Origem</label>
                <select
                  value={newLeadForm.source}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, source: e.target.value })}
                  className="w-full py-2.5 px-4 rounded-xl bg-gray-900/60 border border-border text-sm text-white focus:outline-none focus:border-emerald-500/40"
                >
                  <option value="Instagram">Instagram</option>
                  <option value="Indicação">Indicação</option>
                  <option value="Arquiteto">Arquiteto / Construtora</option>
                  <option value="Site">Site / Google</option>
                </select>
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

      {/* Details Slide-out Drawer */}
      <AnimatePresence>
        {selectedLead && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLead(null)}
              className="fixed inset-0 bg-black z-40"
            />
            {/* Side-panel */}
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-lg glass border-l border-border z-40 p-8 flex flex-col justify-between overflow-y-auto"
            >
              <div className="space-y-8">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 uppercase tracking-widest">Lead {selectedLead.score}%</span>
                    <h3 className="text-xl font-bold text-white tracking-tight mt-1">{selectedLead.name}</h3>
                  </div>
                  <button 
                    onClick={() => setSelectedLead(null)}
                    className="py-1.5 px-3 rounded-lg border border-border text-gray-400 hover:text-white"
                  >
                    Fechar
                  </button>
                </div>

                {/* AI Summary Box */}
                <div className="p-5 rounded-xl bg-emerald-500/5 border border-emerald-500/15 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
                    <Sparkles className="w-4.5 h-4.5" />
                    <span>Resumo Inteligente da IA</span>
                  </div>
                  {aiLoading ? (
                    <div className="text-xs text-gray-400 animate-pulse">Processando mensagens do WhatsApp...</div>
                  ) : aiSummary ? (
                    <div className="space-y-3 text-xs leading-relaxed">
                      <p className="text-gray-300 font-medium">{aiSummary.summary}</p>
                      <div className="pt-2 border-t border-emerald-500/10">
                        <span className="font-bold text-emerald-400 block mb-1">Próximos Passos:</span>
                        <p className="text-gray-400 whitespace-pre-line">{aiSummary.nextSteps}</p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Details info */}
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="p-3 bg-gray-900/30 border border-border/50 rounded-xl flex items-center gap-3">
                    <Phone className="w-4 h-4 text-gray-500" />
                    <div>
                      <span className="text-[10px] text-gray-500 block">Celular</span>
                      <span className="text-gray-300 font-medium">{selectedLead.phone || 'Não informado'}</span>
                    </div>
                  </div>
                  <div className="p-3 bg-gray-900/30 border border-border/50 rounded-xl flex items-center gap-3">
                    <Mail className="w-4 h-4 text-gray-500" />
                    <div>
                      <span className="text-[10px] text-gray-500 block">E-mail</span>
                      <span className="text-gray-300 font-medium">{selectedLead.email || 'Não informado'}</span>
                    </div>
                  </div>
                </div>

                {/* Notes Input & Timeline */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Anotações & Timeline</h4>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Adicionar nota à timeline..."
                      className="flex-1 py-2 px-3 rounded-xl bg-gray-900/60 border border-border text-xs text-white focus:outline-none"
                    />
                    <button 
                      onClick={addNote}
                      className="py-2 px-4 rounded-xl bg-gray-800 border border-border hover:border-emerald-500/40 text-xs text-emerald-400 font-semibold"
                    >
                      Postar
                    </button>
                  </div>

                  <div className="space-y-3">
                    {selectedLead.timeline?.map((t, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-gray-900/20 border border-border/30 text-xs space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-gray-500 font-semibold">
                          <span>{t.author} ({t.type})</span>
                          <span>{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                        </div>
                        <p className="text-gray-300 font-medium">{t.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

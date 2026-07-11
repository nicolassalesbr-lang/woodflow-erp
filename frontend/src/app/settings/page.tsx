"use client";

import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Users, 
  Shield, 
  Activity, 
  Building, 
  Save, 
  Database, 
  Bell, 
  Key,
  CheckCircle2
} from 'lucide-react';
import { motion } from 'framer-motion';

export default function SettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'profile' | 'tenant' | 'roles' | 'audit'>('profile');
  
  // Settings mock states
  const [tenantInfo, setTenantInfo] = useState({
    name: 'Kaza Home Design Ltda',
    cnpj: '12.345.678/0001-99',
    address: 'Alameda Rio Negro, 500 - Alphaville, Barueri - SP',
    phone: '(11) 4195-2026'
  });

  const [roles, setRoles] = useState([
    { id: '1', name: 'Administrador (Gustavo)', role: 'ADMIN', pages: 'Acesso Total' },
    { id: '2', name: 'Simoni Picirili (Designer)', role: 'DESIGNER', pages: 'Clientes, Projetos, Orçamentos' },
    { id: '3', name: 'Marcos Auxiliar (Operador)', role: 'OPERATOR', pages: 'Produção (PCP), Estoque' },
    { id: '4', name: 'Leonardo Vendas (Vendedor)', role: 'SALES', pages: 'Clientes (CRM), Orçamentos' }
  ]);

  const [auditLogs, setAuditLogs] = useState([
    { id: 'log-1', user: 'Gustavo (Admin)', action: 'Orçamento v2 calculado', time: new Date(Date.now() - 600000).toLocaleString() },
    { id: 'log-2', user: 'Marcos (PCP)', action: 'Etiqueta QR Code gerada para OS-9281', time: new Date(Date.now() - 3600000 * 2).toLocaleString() },
    { id: 'log-3', user: 'Leonardo (Sales)', action: 'Novo Lead cadastrado: Ana Cláudia', time: new Date(Date.now() - 3600000 * 5).toLocaleString() },
    { id: 'log-4', user: 'Prisma Virtual', action: 'Banco local woodflow_db.json sincronizado', time: new Date(Date.now() - 3600000 * 12).toLocaleString() }
  ]);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const handleSaveTenant = (e: React.FormEvent) => {
    e.preventDefault();
    alert('Configurações da empresa salvas com sucesso!');
  };

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
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#fff8f0]">Configurações Gerais</h1>
        <p className="mt-1 text-sm text-[#bba890]">Gerencie as unidades da empresa, controle de acessos da equipe e logs de auditoria.</p>
      </div>

      {/* Sub tabs selection */}
      <div className="flex border-b border-[#e8d4b8]/8">
        {[
          { id: 'profile', label: 'Empresa & Unidade', icon: Building },
          { id: 'roles', label: 'Permissões da Equipe', icon: Shield },
          { id: 'audit', label: 'Logs de Auditoria', icon: Activity }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold border-b-2 transition ${
                activeTab === tab.id
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

      {/* Settings body */}
      <div className="min-h-[350px]">
        
        {/* Tab 1: Tenant / Empresa info */}
        {activeTab === 'profile' && (
          <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-6 max-w-xl animate-fadeIn">
            <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider mb-4">Dados da Empresa / Unidade Matriz</h3>
            <form onSubmit={handleSaveTenant} className="space-y-4 text-xs">
              <div>
                <label className="block text-[#a99680] font-semibold mb-1">Razão Social</label>
                <input 
                  type="text" 
                  value={tenantInfo.name} 
                  onChange={(e) => setTenantInfo({ ...tenantInfo, name: e.target.value })}
                  className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d] p-2.5 text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[#a99680] font-semibold mb-1">CNPJ</label>
                  <input 
                    type="text" 
                    value={tenantInfo.cnpj} 
                    onChange={(e) => setTenantInfo({ ...tenantInfo, cnpj: e.target.value })}
                    className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d] p-2.5 text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[#a99680] font-semibold mb-1">Telefone Comercial</label>
                  <input 
                    type="text" 
                    value={tenantInfo.phone} 
                    onChange={(e) => setTenantInfo({ ...tenantInfo, phone: e.target.value })}
                    className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d] p-2.5 text-white outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[#a99680] font-semibold mb-1">Endereço Fiscal & Galpão</label>
                <input 
                  type="text" 
                  value={tenantInfo.address} 
                  onChange={(e) => setTenantInfo({ ...tenantInfo, address: e.target.value })}
                  className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#18120d] p-2.5 text-white outline-none"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-xl bg-[#ead5ba] hover:bg-[#ffe4bf] text-[#20170f] font-bold px-5 py-3 transition"
                >
                  <Save className="h-4 w-4" /> Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tab 2: Access Control / Roles list */}
        {activeTab === 'roles' && (
          <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-5 space-y-4 animate-fadeIn">
            <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider">Permissões de Usuários (LGPD & Acesso)</h3>
            <div className="space-y-3.5 text-xs text-[#bba890]">
              {roles.map(r => (
                <div key={r.id} className="rounded-xl border border-[#e8d4b8]/6 bg-[#fff7ed]/[0.01] p-4 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-white block">{r.name}</span>
                    <span className="text-[10px] text-[#766756] mt-0.5">Permissão: {r.role} | Páginas: {r.pages}</span>
                  </div>
                  <span className="rounded bg-[#d6ad79]/15 border border-[#d6ad79]/20 px-2 py-0.5 text-[10px] text-[#ead5ba] font-bold">
                    Ativo
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Audit Logs list */}
        {activeTab === 'audit' && (
          <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-5 space-y-4 animate-fadeIn">
            <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider">Histórico de Auditoria do Sistema</h3>
            <div className="space-y-3.5 text-xs text-[#bba890] max-h-96 overflow-y-auto pr-1 scrollbar-thin">
              {auditLogs.map(l => (
                <div key={l.id} className="flex items-center justify-between border-b border-[#e8d4b8]/6 pb-2.5">
                  <div>
                    <span className="font-bold text-white block">{l.action}</span>
                    <span className="text-[10px] text-[#766756] mt-0.5">Executor: {l.user}</span>
                  </div>
                  <span className="text-[9px] text-[#766756]">{l.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

    </div>
  );
}

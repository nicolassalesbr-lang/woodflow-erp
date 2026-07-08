"use client";

import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Clock, 
  QrCode, 
  User, 
  CheckCircle,
  Play,
  AlertOctagon
} from 'lucide-react';
import { motion } from 'framer-motion';
import { getApiUrl } from '../../utils/api';

interface ProductionTask {
  id: string;
  projectId: string;
  sector: string;
  status: string;
  qrCode: string;
  startedAt?: string;
  completedAt?: string;
  project: {
    name: string;
    description: string;
  };
}

export default function ProductionKanban() {
  const [tasks, setTasks] = useState<ProductionTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/production`, {
        headers: { 'Authorization': 'Bearer mock-jwt-token-2026' }
      });
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch {
      // Offline fallback mock data
      const mock = [
        {
          id: 'task-1',
          projectId: 'proj-1',
          sector: 'DESIGN',
          status: 'COMPLETED',
          qrCode: 'QR-WF-PROJ1-DES',
          startedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
          completedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
          project: { name: 'Cozinha Gourmet Alphaville', description: 'MDF Louro Freijó' }
        },
        {
          id: 'task-2',
          projectId: 'proj-1',
          sector: 'CUTTING',
          status: 'IN_PROGRESS',
          qrCode: 'QR-WF-PROJ1-CUT',
          startedAt: new Date(Date.now() - 3600000).toISOString(),
          project: { name: 'Cozinha Gourmet Alphaville', description: 'MDF Louro Freijó' }
        },
        {
          id: 'task-3',
          projectId: 'proj-1',
          sector: 'EDGING',
          status: 'WAITING',
          qrCode: 'QR-WF-PROJ1-EDG',
          project: { name: 'Cozinha Gourmet Alphaville', description: 'MDF Louro Freijó' }
        },
        {
          id: 'task-4',
          projectId: 'proj-1',
          sector: 'ASSEMBLY',
          status: 'WAITING',
          qrCode: 'QR-WF-PROJ1-ASM',
          project: { name: 'Cozinha Gourmet Alphaville', description: 'MDF Louro Freijó' }
        },
        {
          id: 'task-5',
          projectId: 'proj-1',
          sector: 'QUALITY',
          status: 'WAITING',
          qrCode: 'QR-WF-PROJ1-QLT',
          project: { name: 'Cozinha Gourmet Alphaville', description: 'MDF Louro Freijó' }
        }
      ];
      setTasks(mock);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/production/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026',
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        fetchTasks();
      }
    } catch {
      // Local fallback
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t))
      );
    }
  };

  const sectors = [
    { key: 'DESIGN', label: 'Desenho 3D' },
    { key: 'CUTTING', label: 'Corte' },
    { key: 'EDGING', label: 'Fita de Borda' },
    { key: 'ASSEMBLY', label: 'Montagem' },
    { key: 'QUALITY', label: 'Qualidade' },
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
      
      {/* Header */}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Kanban PCP & Produção</h1>
        <p className="text-gray-400 text-sm">Controle as ordens de produção e check-ins do chão de fábrica.</p>
      </div>

      {/* Production sectors columns */}
      <div className="flex gap-4 overflow-x-auto pb-4 min-h-[60vh]">
        {sectors.map((sec) => {
          const secTasks = tasks.filter((t) => t.sector === sec.key);
          return (
            <div key={sec.key} className="flex-1 min-w-[280px] max-w-[320px] bg-gray-950/20 rounded-2xl p-4 flex flex-col border border-border/5">
              
              {/* Sector Header */}
              <div className="flex items-center justify-between mb-4 px-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{sec.label}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-900 text-gray-400 border border-border">
                  {secTasks.length}
                </span>
              </div>

              {/* Task list inside sector */}
              <div className="space-y-3 flex-1 overflow-y-auto">
                {secTasks.map((task) => (
                  <div 
                    key={task.id}
                    className={`glass p-4 rounded-xl space-y-4 flex flex-col justify-between ${
                      task.status === 'IN_PROGRESS' 
                        ? 'border-emerald-500/30 bg-emerald-500/5 shadow-glow-emerald' 
                        : ''
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                          task.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' :
                          task.status === 'IN_PROGRESS' ? 'bg-cyan-500/10 text-cyan-400' :
                          'bg-gray-800 text-gray-400'
                        }`}>{task.status}</span>
                        <div className="flex items-center gap-1 text-[10px] text-gray-500">
                          <QrCode className="w-3.5 h-3.5" />
                          <span className="font-mono">{task.qrCode}</span>
                        </div>
                      </div>
                      
                      <h4 className="text-sm font-bold text-white tracking-tight">{task.project?.name}</h4>
                      <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{task.project?.description}</p>
                    </div>

                    {/* Operator/Timer section */}
                    <div className="flex items-center justify-between pt-3 border-t border-border/30 text-xs">
                      {task.status === 'IN_PROGRESS' ? (
                        <div className="flex items-center gap-1.5 text-cyan-400">
                          <Clock className="w-3.5 h-3.5 animate-spin" />
                          <span>Em andamento</span>
                        </div>
                      ) : task.status === 'COMPLETED' ? (
                        <div className="flex items-center gap-1.5 text-emerald-400">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Concluído</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">Aguardando</span>
                      )}

                      {/* Interactive mock checklist trigger */}
                      <div className="flex gap-1">
                        {task.status === 'WAITING' && (
                          <button 
                            onClick={() => updateStatus(task.id, 'IN_PROGRESS')}
                            className="p-1.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20"
                            title="Iniciar"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        )}
                        {task.status === 'IN_PROGRESS' && (
                          <button 
                            onClick={() => updateStatus(task.id, 'COMPLETED')}
                            className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                            title="Concluir"
                          >
                            <CheckCircle className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

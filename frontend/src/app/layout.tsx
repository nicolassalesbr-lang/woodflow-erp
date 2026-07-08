"use client";

import React, { useState, useEffect } from 'react';
import './index.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users2, 
  Layers, 
  Calculator, 
  Activity, 
  Bot, 
  Sparkles,
  Menu,
  X
} from 'lucide-react';
import CopilotDrawer from '../components/copilot-drawer';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Auto-authenticate mock user for development
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mockUser = {
        token: 'mock-jwt-token-2026',
        name: 'Giselle Sousa',
        email: 'giselle.sousa@kazahome.co',
        role: 'ADMIN',
        tenant: { name: 'Kaza Home Design', id: 'kaza-tenant-id' }
      };
      localStorage.setItem('user', JSON.stringify(mockUser));
    }
  }, []);

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'CRM & WhatsApp', path: '/crm', icon: Users2 },
    { name: 'Leitura de Projetos', path: '/projects', icon: Layers },
    { name: 'Orçamentos & Plano', path: '/budget', icon: Calculator },
    { name: 'Kanban de Produção', path: '/production', icon: Activity },
  ];

  return (
    <html lang="pt-BR">
      <head>
        <title>WoodFlow ERP — Marcenaria Inteligente</title>
        <meta name="description" content="Plataforma SaaS premium de gestão e IA para marcenarias de alto padrão." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-background bg-grid-pattern relative min-h-screen">
        
        {/* Glow ambient effects */}
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-[150px] pointer-events-none"></div>

        <div className="flex min-h-screen">
          
          {/* Sidebar Navigation */}
          <aside className={`glass border-r border-border fixed md:static inset-y-0 left-0 z-40 w-64 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-0'} transition-transform duration-300 ease-in-out flex flex-col`}>
            
            {/* Logo */}
            <div className="h-20 flex items-center px-6 border-b border-border gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shadow-glow-emerald">
                <Sparkles className="w-5 h-5 text-background" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">WoodFlow</h1>
                <p className="text-[10px] text-gray-500 font-medium tracking-widest uppercase">Kaza Home Design</p>
              </div>
            </div>

            {/* Menu Navigation */}
            <nav className="flex-1 px-4 py-6 space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.path || (item.path !== '/' && pathname?.startsWith(item.path));
                return (
                  <Link key={item.path} href={item.path}>
                    <span className={`flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                      isActive 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-glow-emerald' 
                        : 'text-gray-400 hover:bg-gray-800/30 hover:text-gray-200 border border-transparent'
                    }`}>
                      <item.icon className="w-5 h-5" />
                      {item.name}
                    </span>
                  </Link>
                );
              })}
            </nav>

            {/* AI Assistant Drawer Trigger */}
            <div className="p-4 border-t border-border">
              <button 
                onClick={() => setCopilotOpen(true)}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-background font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-95 transition-opacity shadow-glow-emerald group"
              >
                <Bot className="w-5 h-5 group-hover:scale-110 transition-transform" />
                Copiloto WoodFlow
              </button>
            </div>
          </aside>

          {/* Main Area */}
          <div className="flex-1 flex flex-col min-w-0">
            
            {/* Header */}
            <header className="h-20 glass border-b border-border flex items-center justify-between px-6 md:px-10 sticky top-0 z-30">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold tracking-tight text-white capitalize">
                  {pathname?.split('/')?.[1] || 'Dashboard'}
                </h2>
              </div>
              
              <div className="flex items-center gap-4">
                {/* Active user status tag */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/40 border border-border">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
                  <span className="text-xs font-semibold text-gray-300">Giselle Sousa</span>
                </div>
              </div>
            </header>

            {/* Page content */}
            <main className="flex-1 p-6 md:p-10">
              {children}
            </main>
          </div>
        </div>

        {/* Copilot Drawer Panel */}
        <CopilotDrawer isOpen={copilotOpen} onClose={() => setCopilotOpen(false)} />
      </body>
    </html>
  );
}

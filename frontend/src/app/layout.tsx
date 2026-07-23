"use client";

import React, { useState, useEffect } from "react";
import "./index.css";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  Activity, 
  Bot, 
  Calculator, 
  Home, 
  Layers, 
  LogOut, 
  Menu, 
  Users2, 
  X,
  BarChart2,
  Package,
  ShoppingCart,
  DollarSign,
  Settings,
  HelpCircle
} from "lucide-react";
import CopilotDrawer from "../components/copilot-drawer";

const navItems = [
  { name: "Clientes", path: "/crm", icon: Users2 },
  { name: "Projetos", path: "/projects", icon: Layers },
  { name: "Orcamentos", path: "/budget", icon: Calculator },
];

const pageTitles: Record<string, string> = {
  dashboard: "Inicio",
  crm: "Clientes",
  projects: "Projetos",
  budget: "Orcamentos",
  production: "Entregas",
  analytics: "Relatórios",
  inventory: "Estoque",
  purchases: "Compras",
  financial: "Financeiro",
  settings: "Configurações",
  help: "Suporte",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isLogin = pathname === "/login";
  const currentSection = pathname?.split("/")?.[1] || "dashboard";

  // Auto-authenticate mock user for development
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mockUser = {
        token: 'mock-jwt-token-2026',
        name: 'Gustavo',
        email: 'gustavo@kazahome.co',
        role: 'ADMIN',
        tenant: { name: 'Kaza Home Design', id: 'kaza-tenant-id' }
      };
      localStorage.setItem('user', JSON.stringify(mockUser));
    }
  }, []);

  async function logout() {
    await fetch("/kazahome/api/logout", {
      method: "POST"
    });
    router.replace("/login");
    router.refresh();
  }

  return (
    <html lang="pt-BR">
      <head>
        <title>KazaHomeDesign | Painel interno</title>
        <meta name="description" content="Painel privado KazaHomeDesign para clientes, projetos, orcamentos e entregas sob medida." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-[#18120d] text-[#f8f0e6]">
        {isLogin ? (
          children
        ) : (
          <div className="min-h-screen bg-[radial-gradient(circle_at_10%_0%,rgba(207,158,99,0.16),transparent_32%),linear-gradient(135deg,#1e160f_0%,#18120d_42%,#0b0907_100%)]">
            <div className="flex min-h-screen w-full">
              {/* Sidebar Navigation - Flush to left edge */}
              <aside className="hidden w-72 shrink-0 border-r border-[#e8d4b8]/10 bg-[#211811]/92 px-5 py-5 backdrop-blur-xl lg:flex lg:flex-col">
                {/* Logo */}
                <div className="mb-8 flex items-center gap-3 px-2">
                  <Logo />
                  <div>
                    <h1 className="text-xl font-semibold tracking-tight text-[#fff8f0]">KazaHomeDesign</h1>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#c89a63]">moveis sob medida</p>
                  </div>
                </div>

                {/* Navigation Menu */}
                <nav className="flex-1 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                  {navItems.map((item) => (
                    <NavLink
                      key={item.path}
                      item={item}
                      pathname={pathname}
                      onClick={() => setMobileMenuOpen(false)}
                    />
                  ))}
                </nav>

                {/* Copilot Drawer & Logout Triggers */}
                <div className="space-y-3 border-t border-[#e8d4b8]/10 pt-4">
                  <button
                    onClick={() => setCopilotOpen(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ead5ba] px-4 py-3 text-sm font-bold text-[#20170f] transition hover:bg-[#ffe4bf]"
                  >
                    <Bot className="h-4 w-4" />
                    Assistente Kaza
                  </button>
                  <button
                    onClick={logout}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#e8d4b8]/12 bg-[#fff7ed]/[0.04] px-4 py-2.5 text-sm font-semibold text-[#bba890] transition hover:text-[#fff8f0]"
                  >
                    <LogOut className="h-4 w-4" />
                    Sair
                  </button>
                </div>
              </aside>

              {/* Main Content Area - Expands to fill 100% of remaining width */}
              <div className="flex min-w-0 flex-1 flex-col">
                {/* Header */}
                <header className="sticky top-0 z-40 border-b border-[#e8d4b8]/10 bg-[#18120d]/92 px-6 py-4 backdrop-blur-xl md:px-8">
                  <div className="flex w-full items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setMobileMenuOpen((value) => !value)}
                        className="rounded-xl border border-[#e8d4b8]/12 bg-[#fff7ed]/[0.05] p-2 text-[#ead5ba] lg:hidden"
                        aria-label="Abrir menu"
                      >
                        {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                      </button>
                      <div className="lg:hidden">
                        <Logo />
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#c89a63]">KazaHomeDesign</p>
                        <h2 className="text-xl font-semibold tracking-tight text-[#fff8f0]">
                          {pageTitles[currentSection] || "Painel"}
                        </h2>
                      </div>
                    </div>

                    {/* Profile indicator */}
                    <div className="hidden items-center gap-2 rounded-full border border-[#e8d4b8]/12 bg-[#fff7ed]/[0.05] px-3 py-1.5 text-xs font-semibold text-[#d4c1aa] sm:flex">
                      <span className="h-2 w-2 rounded-full bg-[#d6ad79] animate-pulse"></span>
                      Gustavo
                    </div>
                  </div>

                  {/* Mobile Navigation Menu */}
                  {mobileMenuOpen && (
                    <nav className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:hidden max-h-60 overflow-y-auto pr-1">
                      {navItems.map((item) => (
                        <NavLink
                          key={item.path}
                          item={item}
                          pathname={pathname}
                          onClick={() => setMobileMenuOpen(false)}
                          compact
                        />
                      ))}
                    </nav>
                  )}
                </header>

                {/* Page Content */}
                <main className="flex-1 px-6 py-6 md:px-8 md:py-8">
                  <div className="w-full space-y-6">
                    {children}
                  </div>
                </main>
              </div>
            </div>

            {/* Copilot Drawer Panel */}
            <CopilotDrawer isOpen={copilotOpen} onClose={() => setCopilotOpen(false)} />
          </div>
        )}
      </body>
    </html>
  );
}

function Logo() {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#f0d8ba]/40 bg-[#ead5ba] text-[#20170f] shadow-[0_14px_36px_rgba(0,0,0,0.24)]">
      <span className="text-sm font-black tracking-tight">KH</span>
    </div>
  );
}

function NavLink({ 
  item, 
  pathname, 
  onClick, 
  compact = false 
}: { 
  item: typeof navItems[0]; 
  pathname: string; 
  onClick: () => void; 
  compact?: boolean;
}) {
  const isActive = pathname === item.path || Boolean(pathname?.startsWith(`${item.path}/`));
  const Icon = item.icon;
  return (
    <Link href={item.path} onClick={onClick}>
      <span className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
        isActive 
          ? "border-[#d6ad79]/35 bg-[#d6ad79]/14 text-[#fff8f0] shadow-[0_14px_32px_rgba(0,0,0,0.18)]" 
          : "border-transparent text-[#bba890] hover:border-[#e8d4b8]/12 hover:bg-[#fff7ed]/[0.05] hover:text-[#fff8f0]"
      } ${compact ? "justify-center px-3 text-xs" : ""}`}>
        <Icon className="h-4 w-4" />
        {item.name}
      </span>
    </Link>
  );
}

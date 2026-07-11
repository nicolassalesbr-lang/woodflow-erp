"use client";

import React, { useState } from 'react';
import { 
  HelpCircle, 
  Compass, 
  Keyboard, 
  BookOpen, 
  Sparkles, 
  LifeBuoy, 
  ArrowRight,
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function HelpScreen() {
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  const tourSteps = [
    { title: '1. O Quadro Geral (Dashboard)', text: 'Aqui você acompanha o faturamento do mês, ticket médio, rankings de vendedores e as próximas instalações na fábrica de forma otimizada.' },
    { title: '2. Upload Inteligente de Plantas', text: 'Vá no menu Projetos, clique em "Upload Inteligente" e suba o PDF ou DWG da sua planta. A IA extrairá todas as chapas de MDF, fitas de borda e ferragens gerando a tabela editável e o plano de corte.' },
    { title: '3. Motor de Orçamentos', text: 'Na tela de Orçamentos, defina seu markup e margens. O motor calcula impostos, frete, comissão do arquiteto especificador (RT) e gera o contrato em PDF pronto para assinatura e Pix.' }
  ];

  const handleNextTourStep = () => {
    if (tourStep < tourSteps.length - 1) {
      setTourStep(prev => prev + 1);
    } else {
      setShowTour(false);
      setTourStep(0);
      alert('Tour guiado concluído! Você está pronto para operar o WoodFlow ERP.');
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#fff8f0]">Central de Ajuda</h1>
          <p className="mt-1 text-sm text-[#bba890]">Consulte tutoriais, atalhos de teclado globais e inicie o tour de boas-vindas.</p>
        </div>
        <button
          onClick={() => {
            setShowTour(true);
            setTourStep(0);
          }}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#ead5ba] px-4 py-2.5 text-sm font-bold text-[#20170f] hover:bg-[#ffe4bf] active:scale-95 transition shadow-md animate-pulse"
        >
          <Compass className="h-4 w-4" /> Iniciar Tour do ERP
        </button>
      </div>

      {/* Main help panels grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Keyboard shortcuts */}
        <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-6 space-y-4">
          <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider flex items-center gap-1.5">
            <Keyboard className="h-4.5 w-4.5 text-[#d6ad79]" /> Atalhos de Teclado Globais
          </h3>
          
          <div className="space-y-3.5 text-xs text-[#bba890]">
            <div className="flex justify-between items-center border-b border-[#e8d4b8]/6 pb-2">
              <span>Busca Global (Notion-style)</span>
              <kbd className="bg-[#211811] border border-[#e8d4b8]/12 px-2 py-1 rounded text-white font-mono text-[10px]">Ctrl + K</kbd>
            </div>
            <div className="flex justify-between items-center border-b border-[#e8d4b8]/6 pb-2">
              <span>Abrir Copiloto de IA</span>
              <kbd className="bg-[#211811] border border-[#e8d4b8]/12 px-2 py-1 rounded text-white font-mono text-[10px]">Shift + C</kbd>
            </div>
            <div className="flex justify-between items-center border-b border-[#e8d4b8]/6 pb-2">
              <span>Novo Cliente (CRM)</span>
              <kbd className="bg-[#211811] border border-[#e8d4b8]/12 px-2 py-1 rounded text-white font-mono text-[10px]">Ctrl + Alt + N</kbd>
            </div>
            <div className="flex justify-between items-center">
              <span>Gerar Orçamento Rápido</span>
              <kbd className="bg-[#211811] border border-[#e8d4b8]/12 px-2 py-1 rounded text-white font-mono text-[10px]">Ctrl + Alt + B</kbd>
            </div>
          </div>
        </div>

        {/* Guides accordions */}
        <div className="rounded-2xl border border-[#e8d4b8]/8 bg-[#fff7ed]/[0.02] p-6 space-y-4">
          <h3 className="text-xs font-bold text-[#ead5ba] uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen className="h-4.5 w-4.5 text-[#d6ad79]" /> Tutoriais Rápidos de Marcenaria
          </h3>

          <div className="space-y-3 text-xs leading-relaxed text-[#bba890]">
            <div className="p-3 bg-[#1e160f]/60 rounded-xl border border-[#e8d4b8]/6">
              <span className="font-bold text-white block">Como funciona o cálculo de chapas MDF?</span>
              <p className="mt-1">A IA soma toda a área de superfície de caixas, portas e prateleiras dos ambientes, adiciona a taxa de desperdício configurada (waste %) e divide pela área padrão de uma chapa (5.06 m²), arredondando para cima.</p>
            </div>
            <div className="p-3 bg-[#1e160f]/60 rounded-xl border border-[#e8d4b8]/6">
              <span className="font-bold text-white block">O que é a comissão RT e como pagar?</span>
              <p className="mt-1">RT (Reserva Técnica) é a comissão repassada para arquitetos especificadores parceiros. No módulo financeiro, você acompanha os percentuais acumulados e liquida os pagamentos enviando via Pix.</p>
            </div>
          </div>
        </div>

      </div>

      {/* Guided Tour Modal Simulator */}
      <AnimatePresence>
        {showTour && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
            <div className="w-full max-w-md rounded-2xl border border-[#d6ad79]/20 bg-[#211811] p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[#d6ad79]" />
                <h3 className="text-base font-bold text-white">Tour Guiado KazaHome ERP</h3>
              </div>
              
              <div className="p-4 rounded-xl bg-[#d6ad79]/5 border border-[#d6ad79]/10 space-y-2 text-xs">
                <span className="font-bold text-[#ead5ba] block">{tourSteps[tourStep].title}</span>
                <p className="text-[#bba890] leading-relaxed">{tourSteps[tourStep].text}</p>
              </div>

              {/* Progress dots */}
              <div className="flex justify-between items-center pt-2">
                <div className="flex gap-1.5">
                  {tourSteps.map((_, idx) => (
                    <span 
                      key={idx}
                      className={`h-2 w-2 rounded-full transition ${
                        idx === tourStep ? 'bg-[#d6ad79]' : 'bg-[#e8d4b8]/15'
                      }`}
                    />
                  ))}
                </div>

                <button
                  onClick={handleNextTourStep}
                  className="flex items-center gap-1 bg-[#ead5ba] hover:bg-[#ffe4bf] text-[#20170f] font-bold text-xs px-4 py-2 rounded-lg transition"
                >
                  <span>{tourStep === tourSteps.length - 1 ? 'Concluir' : 'Próximo'}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

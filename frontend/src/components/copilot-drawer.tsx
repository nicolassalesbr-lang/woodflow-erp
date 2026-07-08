"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Sparkles, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  sender: 'user' | 'assistant';
  text: string;
}

interface CopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CopilotDrawer({ isOpen, onClose }: CopilotDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([
    { sender: 'assistant', text: 'Olá! Sou o Copiloto WoodFlow. Posso te ajudar a automatizar tarefas da sua marcenaria. Experimente pedir para "gerar um orçamento", "abastecer o estoque de MDF" ou "cobrar os clientes".' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToEnd();
  }, [messages]);

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || input;
    if (!text.trim() || loading) return;

    if (!textToSend) setInput('');
    setMessages((prev) => [...prev, { sender: 'user', text }]);
    setLoading(true);

    try {
      const response = await fetch('http://localhost:3009/api/copilot/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-jwt-token-2026',
        },
        body: JSON.stringify({ message: text }),
      });

      const data = await response.json();
      setMessages((prev) => [...prev, { sender: 'assistant', text: data.reply }]);
    } catch {
      // Offline fallback
      setMessages((prev) => [
        ...prev,
        { sender: 'assistant', text: 'Desculpe, ocorreu um erro de conexão com o servidor local. Certifique-se de que o backend NestJS está rodando na porta 3009.' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions = [
    'Calcular orçamento',
    'Cobre o cliente',
    'Comprar MDF',
    'Gere relatório financeiro'
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black z-50"
          />

          {/* Drawer container */}
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md glass border-l border-border z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="h-20 px-6 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shadow-glow-emerald">
                  <Bot className="w-5 h-5 text-background" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Copiloto Inteligente</h3>
                  <span className="text-[10px] text-emerald-400 font-semibold tracking-wider uppercase">Online</span>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-gray-800/40 border border-transparent hover:border-border text-gray-400 hover:text-white transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Message Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((msg, index) => (
                <div 
                  key={index}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-background font-medium rounded-tr-none'
                      : 'bg-gray-800/60 border border-border text-gray-200 rounded-tl-none'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-800/60 border border-border text-gray-400 rounded-2xl rounded-tl-none p-4 text-sm flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce delay-100"></div>
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce delay-200"></div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Suggestions list */}
            <div className="px-6 py-3 border-t border-border flex flex-wrap gap-2">
              {suggestions.map((sug) => (
                <button
                  key={sug}
                  onClick={() => handleSend(sug)}
                  className="px-3 py-1.5 rounded-lg border border-border hover:border-emerald-500/40 bg-gray-900/30 hover:bg-emerald-500/5 text-xs text-gray-400 hover:text-emerald-400 transition-all font-medium"
                >
                  {sug}
                </button>
              ))}
            </div>

            {/* Input area */}
            <div className="p-4 border-t border-border bg-gray-950/20">
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2"
              >
                <input 
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Peça ajuda da IA..."
                  className="flex-1 py-3 px-4 rounded-xl bg-gray-900/60 border border-border focus:border-emerald-500/40 text-sm text-white focus:outline-none placeholder-gray-500 transition-all"
                />
                <button 
                  type="submit"
                  className="p-3 rounded-xl bg-emerald-500 text-background hover:opacity-90 shadow-glow-emerald transition-opacity"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

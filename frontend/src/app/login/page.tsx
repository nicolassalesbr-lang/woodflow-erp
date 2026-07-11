"use client";

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Lock, Users2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('Gustavo');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/kazahome/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Nao foi possivel entrar.');
      }

      const next = searchParams.get('next') || '/dashboard';
      router.replace(next.startsWith('/') ? next : '/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao autenticar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#18120d] px-5 text-[#f8f0e6]">
      <section className="w-full max-w-[420px]">
        <div className="mb-8 flex items-center justify-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#f0d8ba]/40 bg-[#ead5ba] text-[#20170f] shadow-[0_18px_45px_rgba(0,0,0,0.24)]">
            <span className="text-lg font-black tracking-tight">KH</span>
          </div>
          <div>
            <div className="text-2xl font-semibold tracking-tight text-[#fff8f0]">KazaHomeDesign</div>
            <div className="text-xs uppercase tracking-[0.3em] text-[#c89a63]">Acesso interno</div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#e8d4b8]/14 bg-[#211811]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.34)] sm:p-8">
          <div className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c89a63]">Acesso interno</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#fff8f0]">Entrar no painel</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Usuario" icon={<Users2 className="h-5 w-5" />}>
              <input value={username} onChange={(event) => setUsername(event.target.value)} className="w-full bg-transparent text-sm text-[#fff8f0] outline-none placeholder:text-[#766756]" placeholder="Digite seu usuario" autoComplete="username" />
            </Field>
            <Field label="Senha" icon={<Lock className="h-5 w-5" />}>
              <input value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-transparent text-sm text-[#fff8f0] outline-none placeholder:text-[#766756]" placeholder="Digite sua senha" type={showPassword ? 'text' : 'password'} autoComplete="current-password" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} className="rounded-lg p-1 text-[#a99680] transition hover:text-[#f0d8ba]" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </Field>
            {error ? <div className="rounded-xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}
            <button disabled={loading} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#ead5ba] px-5 py-4 text-sm font-bold text-[#20170f] shadow-[0_16px_36px_rgba(214,173,121,0.18)] transition hover:bg-[#ffe4bf] disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? 'Entrando...' : 'Entrar no painel'}
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[#a99680]">{label}</span>
      <div className="flex items-center gap-3 rounded-xl border border-[#e8d4b8]/14 bg-[#fff7ed]/[0.055] px-4 py-3.5 text-[#a99680] focus-within:border-[#d6ad79]/70 focus-within:ring-4 focus-within:ring-[#d6ad79]/10">
        {icon}
        {children}
      </div>
    </label>
  );
}

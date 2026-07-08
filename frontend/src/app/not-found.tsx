import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
      <h2 className="text-2xl font-extrabold text-white tracking-tight">404 - Página Não Encontrada</h2>
      <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
        A página que você tentou acessar não existe ou foi movida para outro diretório.
      </p>
      <Link href="/dashboard">
        <span className="py-2.5 px-5 rounded-xl bg-emerald-500 text-background font-bold text-xs cursor-pointer shadow-glow-emerald">
          Voltar ao Dashboard
        </span>
      </Link>
    </div>
  );
}

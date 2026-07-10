"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowRight, 
  CheckCircle, 
  FileUp, 
  Layers, 
  Maximize2, 
  Plus, 
  Sparkles 
} from 'lucide-react';
import { getApiUrl } from '../../utils/api';

const statusLabel: Record<string, string> = {
  DRAFT: "Briefing",
  REVIEW: "Em revisao",
  BUDGET: "Orcamento",
  APPROVED: "Aprovado"
};

export default function Projects() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProj, setSelectedProj] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [newProjDesc, setNewProjDesc] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const selectedItems = selectedProj?.items || [];
  
  const environments = useMemo(() => {
    const names = selectedItems.map((item: any) => item.environment);
    return Array.from(new Set(names));
  }, [selectedItems]);

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/projects`, {
        headers: {
          Authorization: "Bearer mock-jwt-token-2026"
        }
      });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setProjects(list);
      setSelectedProj((current: any) => current || list[0] || null);
    } catch {
      const mock = [
        {
          id: "proj-1",
          name: "Apartamento Jardins",
          description: "Cozinha integrada, home office e closet com acabamento amadeirado claro.",
          status: "BUDGET",
          originalFileUrl: "planta-apartamento-jardins.pdf",
          items: [
            {
              id: "1",
              environment: "Cozinha",
              itemType: "Modulo inferior",
              description: "Gabinete sob pia com portas lisas",
              width: 2200,
              height: 820,
              depth: 600,
              thickness: 18,
              quantity: 1,
              materialType: "MDF Freijo claro 18mm"
            },
            {
              id: "2",
              environment: "Cozinha",
              itemType: "Aereo",
              description: "Armario superior com portas de abrir",
              width: 1800,
              height: 720,
              depth: 350,
              thickness: 18,
              quantity: 1,
              materialType: "MDF Off White 18mm"
            },
            {
              id: "3",
              environment: "Closet",
              itemType: "Roupeiro",
              description: "Modulo principal com cabideiros e gavetas",
              width: 2600,
              height: 2600,
              depth: 620,
              thickness: 18,
              quantity: 1,
              materialType: "MDF Carvalho 18mm"
            },
            {
              id: "4",
              environment: "Home office",
              itemType: "Painel",
              description: "Painel ripado decorativo com bancada",
              width: 2400,
              height: 2600,
              depth: 450,
              thickness: 18,
              quantity: 1,
              materialType: "MDF Naturale 18mm"
            }
          ]
        },
        {
          id: "proj-2",
          name: "Casa Alphaville",
          description: "Area gourmet, sala de TV e suite master em conceito contemporaneo.",
          status: "REVIEW",
          items: [
            {
              id: "5",
              environment: "Gourmet",
              itemType: "Bancada",
              description: "Base de apoio com portas e nichos",
              width: 3200,
              height: 900,
              depth: 650,
              thickness: 18,
              quantity: 1,
              materialType: "MDF Noce 18mm"
            }
          ]
        }
      ];
      setProjects(mock);
      setSelectedProj(mock[0]);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newProjName.trim()) return;
    try {
      const res = await fetch(`${getApiUrl()}/api/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mock-jwt-token-2026"
        },
        body: JSON.stringify({
          name: newProjName,
          description: newProjDesc
        })
      });
      if (res.ok) {
        setNewProjName("");
        setNewProjDesc("");
        setShowAddForm(false);
        fetchProjects();
      }
    } catch {
      const project = {
        id: `mock-${Date.now()}`,
        name: newProjName,
        description: newProjDesc || "Projeto sob medida em fase de briefing.",
        status: "DRAFT",
        items: []
      };
      setProjects((current: any) => [project, ...current]);
      setSelectedProj(project);
      setNewProjName("");
      setNewProjDesc("");
      setShowAddForm(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>, projectId: string) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const res = await fetch(`${getApiUrl()}/api/projects/${projectId}/parse`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer mock-jwt-token-2026"
          },
          body: JSON.stringify({
            filename: file.name,
            fileBase64: base64,
            mimeType: file.type
          })
        });
        if (res.ok) fetchProjects();
      };
      reader.readAsDataURL(file);
    } catch {
      setProjects((current: any) =>
        current.map((project: any) =>
          project.id === projectId ? { ...project, originalFileUrl: file.name } : project
        )
      );
      setSelectedProj((current: any) =>
        current ? { ...current, originalFileUrl: file.name } : current
      );
    } finally {
      setUploading(false);
    }
  };

  const simulateAiParsing = () => {
    if (!selectedProj) return;
    const parsed = {
      ...selectedProj,
      originalFileUrl: selectedProj.originalFileUrl || "planta-baixa-kazahome.pdf",
      status: "BUDGET",
      items: selectedProj.items.length ? selectedProj.items : [
        {
          id: "m1",
          environment: "Cozinha",
          itemType: "Modulo inferior",
          description: "Gabinete sob pia com portas lisas",
          width: 2200,
          height: 820,
          depth: 600,
          thickness: 18,
          quantity: 1,
          materialType: "MDF Freijo claro 18mm"
        },
        {
          id: "m2",
          environment: "Cozinha",
          itemType: "Aereo",
          description: "Armario superior com portas de abrir",
          width: 1800,
          height: 720,
          depth: 350,
          thickness: 18,
          quantity: 1,
          materialType: "MDF Off White 18mm"
        },
        {
          id: "m3",
          environment: "Closet",
          itemType: "Roupeiro",
          description: "Modulo com cabideiros e gavetas",
          width: 2600,
          height: 2600,
          depth: 620,
          thickness: 18,
          quantity: 1,
          materialType: "MDF Carvalho 18mm"
        }
      ]
    };
    setSelectedProj(parsed);
    setProjects((current: any) =>
      current.map((project: any) => (project.id === parsed.id ? parsed : project))
    );
  };

  return (
    <div className="space-y-6">
      {/* Upper Hero Card */}
      <section className="overflow-hidden rounded-2xl border border-[#e8d4b8]/12 bg-[#211811]/78">
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="p-6 md:p-8">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#d6ad79]/28 bg-[#d6ad79]/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#ead5ba]">
              <Sparkles className="h-3.5 w-3.5" />
              Projetos sob medida
            </div>
            <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-[#fff8f0] md:text-4xl">
              Cada ambiente organizado do briefing ate a entrega.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#cdbca7]">
              Cadastre o cliente, acompanhe arquivos, ambientes, medidas e status em uma tela simples para vender e executar melhor.
            </p>
          </div>

          <div className="border-t border-[#e8d4b8]/10 bg-[#fff7ed]/[0.035] p-6 md:p-8 lg:border-l lg:border-t-0">
            <button
              onClick={() => setShowAddForm((value) => !value)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ead5ba] px-5 py-3 text-sm font-bold text-[#20170f] transition hover:bg-[#ffe4bf]"
            >
              <Plus className="h-4 w-4" />
              Novo projeto
            </button>
            
            {showAddForm ? (
              <form onSubmit={createProject} className="mt-4 space-y-3">
                <input
                  value={newProjName}
                  onChange={(event) => setNewProjName(event.target.value)}
                  className="w-full rounded-xl border border-[#e8d4b8]/12 bg-[#211811] px-4 py-3 text-sm text-[#fff8f0] outline-none placeholder:text-[#7f705f] focus:border-[#d6ad79]/60"
                  placeholder="Nome do projeto"
                />
                <textarea
                  value={newProjDesc}
                  onChange={(event) => setNewProjDesc(event.target.value)}
                  className="min-h-[92px] w-full rounded-xl border border-[#e8d4b8]/12 bg-[#211811] px-4 py-3 text-sm text-[#fff8f0] outline-none placeholder:text-[#7f705f] focus:border-[#d6ad79]/60"
                  placeholder="Ambientes, estilo, prazo ou observacoes"
                />
                <button className="w-full rounded-xl border border-[#d6ad79]/30 bg-[#d6ad79]/12 px-4 py-3 text-sm font-bold text-[#ead5ba]">
                  Criar projeto
                </button>
              </form>
            ) : (
              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                <Metric value={projects.length} label="Projetos" />
                <Metric value={environments.length || "-"} label="Ambientes" />
                <Metric value={selectedItems.length || "-"} label="Itens" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Main Grid */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
        {/* Left projects list */}
        <aside className="space-y-3">
          {projects.map((project) => {
            const active = selectedProj?.id === project.id;
            return (
              <button
                key={project.id}
                onClick={() => setSelectedProj(project)}
                className={`w-full rounded-2xl border p-5 text-left transition ${
                  active 
                    ? "border-[#d6ad79]/38 bg-[#d6ad79]/12" 
                    : "border-[#e8d4b8]/12 bg-[#fff7ed]/[0.04] hover:border-[#d6ad79]/28"
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="rounded-full border border-[#e8d4b8]/12 bg-[#211811]/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#d6ad79]">
                    {statusLabel[project.status] || project.status}
                  </span>
                  <span className="text-xs text-[#a99680]">
                    {project.items.length} itens
                  </span>
                </div>
                <h3 className="font-semibold tracking-tight text-[#fff8f0]">
                  {project.name}
                </h3>
                <p className="mt-2 line-clamp-2 text-sm leading-5 text-[#bba890]">
                  {project.description}
                </p>
              </button>
            );
          })}
        </aside>

        {/* Right selected project details */}
        <main className="min-h-[520px] rounded-2xl border border-[#e8d4b8]/12 bg-[#211811]/70 p-5 md:p-7">
          {selectedProj ? (
            <div className="space-y-7">
              {/* Selected Project Header */}
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#d6ad79]/14 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[#ead5ba]">
                      {statusLabel[selectedProj.status] || selectedProj.status}
                    </span>
                    {selectedProj.originalFileUrl && (
                      <span className="rounded-full border border-[#e8d4b8]/12 px-3 py-1 text-xs text-[#bba890]">
                        {selectedProj.originalFileUrl}
                      </span>
                    )}
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-[#fff8f0] md:text-3xl">
                    {selectedProj.name}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[#cdbca7]">
                    {selectedProj.description}
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <label
                    className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#d6ad79]/30 bg-[#d6ad79]/10 px-4 py-3 text-sm font-bold text-[#ead5ba] transition hover:bg-[#d6ad79]/16 ${
                      uploading ? "pointer-events-none opacity-60" : ""
                    }`}
                  >
                    <FileUp className="h-4 w-4" />
                    {uploading ? "Enviando..." : "Subir arquivo"}
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg"
                      onChange={(event) => handleFileChange(event, selectedProj.id)}
                    />
                  </label>
                  <button
                    onClick={simulateAiParsing}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#ead5ba] px-4 py-3 text-sm font-bold text-[#20170f] transition hover:bg-[#ffe4bf]"
                  >
                    Organizar projeto
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Selected Project Stats */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <ProjectStat label="Ambientes" value={environments.length || 0} />
                <ProjectStat label="Itens planejados" value={selectedItems.length || 0} />
                <ProjectStat
                  label="Qtd. total"
                  value={selectedItems.reduce((sum: number, item: any) => sum + item.quantity, 0)}
                />
              </div>

              {/* Ambientes & Medidas / Fluxo Grid */}
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
                {/* Left: Ambientes e Medidas */}
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold tracking-tight text-[#fff8f0]">
                      Ambientes e medidas
                    </h3>
                    <Layers className="h-5 w-5 text-[#d6ad79]" />
                  </div>

                  {selectedItems.length ? (
                    <div className="space-y-3">
                      {selectedItems.map((item: any) => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-[#e8d4b8]/12 bg-[#fff7ed]/[0.04] p-4"
                        >
                          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#c89a63]">
                                {item.environment}
                              </p>
                              <h4 className="mt-1 font-semibold text-[#fff8f0]">
                                {item.description}
                              </h4>
                              <p className="mt-1 text-sm text-[#bba890]">
                                {item.materialType}
                              </p>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center text-xs text-[#cdbca7]">
                              <Measure label="L" value={item.width} />
                              <Measure label="A" value={item.height} />
                              <Measure label="P" value={item.depth} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[#e8d4b8]/18 bg-[#fff7ed]/[0.035] p-8 text-center">
                      <Maximize2 className="mx-auto h-7 w-7 text-[#d6ad79]" />
                      <h4 className="mt-4 font-semibold text-[#fff8f0]">
                        Nenhum ambiente organizado ainda
                      </h4>
                      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#bba890]">
                        Suba uma planta ou clique em organizar projeto para criar uma estrutura inicial.
                      </p>
                    </div>
                  )}
                </div>

                {/* Right: Fluxo do Projeto */}
                <aside className="rounded-xl border border-[#d6ad79]/18 bg-[#d6ad79]/10 p-5">
                  <h3 className="font-semibold tracking-tight text-[#fff8f0]">
                    Fluxo do projeto
                  </h3>
                  <div className="mt-5 space-y-4">
                    {[
                      "Briefing recebido",
                      "Ambientes definidos",
                      "Medidas revisadas",
                      "Orcamento pronto"
                    ].map((step, index) => (
                      <div key={step} className="flex gap-3">
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#ead5ba] text-[#20170f]">
                          <CheckCircle className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#fff8f0]">
                            {step}
                          </p>
                          <p className="text-xs text-[#bba890]">
                            Etapa {index + 1}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </aside>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center text-center">
              <div>
                <Layers className="mx-auto h-8 w-8 text-[#d6ad79]" />
                <h2 className="mt-4 text-xl font-semibold text-[#fff8f0]">
                  Crie o primeiro projeto
                </h2>
                <p className="mt-2 text-sm text-[#bba890]">
                  Use o botao Novo projeto para comecar.
                </p>
              </div>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

function Metric({ value, label }: { value: any; label: string }) {
  return (
    <div className="rounded-xl border border-[#e8d4b8]/12 bg-[#211811]/66 p-3">
      <div className="text-xl font-semibold text-[#fff8f0]">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#a99680]">
        {label}
      </div>
    </div>
  );
}

function ProjectStat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-[#e8d4b8]/12 bg-[#fff7ed]/[0.04] p-4">
      <div className="text-2xl font-semibold text-[#fff8f0]">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-[#a99680]">
        {label}
      </div>
    </div>
  );
}

function Measure({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-[#e8d4b8]/10 bg-[#211811]/70 px-3 py-2">
      <div className="font-bold text-[#fff8f0]">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[#a99680]">
        {label}
      </div>
    </div>
  );
}

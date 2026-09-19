import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CockpitView } from "@/components/simbionte/cockpit/CockpitView";
import type { CockpitReadModel } from "@/lib/simbionte/cockpit/read-model";

function model(overrides: Partial<CockpitReadModel> = {}): CockpitReadModel {
  return {
    gerado_em: "2026-09-17T12:00:00.000Z",
    resumo: {
      fila_humana: { estado: "disponivel", valor: 0 },
      riscos_criticos: { estado: "disponivel", valor: 0 },
      tarefas_atrasadas: { estado: "disponivel", valor: 0 },
      avisos_da_ia: { estado: "disponivel", valor: 0 },
    },
    prioridades: { estado: "disponivel", itens: [], fontes_indisponiveis: [] },
    atendimento: {
      estado: "disponivel",
      dados: { fila_humana: 0, em_atendimento_automatico: 0, abertas: 0 },
    },
    ia: {
      estado: "disponivel",
      dados: {
        configurada: false,
        agentes_publicados: 0,
        agentes_no_ar: 0,
        avisos_abertos: 0,
        execucoes_24h: 0,
        falhas_24h: 0,
      },
    },
    atividades: { estado: "disponivel", dados: [] },
    ...overrides,
  };
}

describe("apresentação do Cockpit", () => {
  it("mostra vazio honesto e não simula Aprovações ou Supervisor", () => {
    const html = renderToStaticMarkup(
      <CockpitView model={model()} idioma="pt-BR" timezone="UTC" />,
    );

    expect(html).toContain("Nenhuma prioridade crítica foi encontrada agora.");
    expect(html).toContain("Nenhum agente de IA foi configurado nesta organização.");
    expect(html).toContain("Ainda não há atividade registrada.");
    expect(html.match(/Disponível em próxima etapa/g)).toHaveLength(2);
  });

  it("nomeia falha parcial e não apresenta a fonte indisponível como zero", () => {
    const base = model();
    const html = renderToStaticMarkup(
      <CockpitView
        idioma="pt-BR"
        timezone="UTC"
        model={{
          ...base,
          resumo: {
            ...base.resumo,
            riscos_criticos: { estado: "indisponivel", valor: null },
          },
          prioridades: {
            estado: "parcial",
            itens: [],
            fontes_indisponiveis: ["radar"],
          },
        }}
      />,
    );

    expect(html).toContain("Parte das prioridades não pôde ser carregada.");
    expect(html).toContain("Fonte indisponível agora");
    expect(html).toContain(">—<");
  });

  it("renderiza os principais estados também em espanhol", () => {
    const html = renderToStaticMarkup(
      <CockpitView model={model()} idioma="es" timezone="UTC" />,
    );

    expect(html).toContain("Panel de control");
    expect(html).toContain("Resumen de la operación");
    expect(html).toContain("Disponible en una próxima etapa");
  });

  it("formata atualização, prazo e atividade no timezone explícito do usuário", () => {
    const base = model();
    const html = renderToStaticMarkup(
      <CockpitView
        idioma="pt-BR"
        timezone="America/Manaus"
        model={{
          ...base,
          gerado_em: "2026-09-17T12:00:00.000Z",
          prioridades: {
            estado: "disponivel",
            fontes_indisponiveis: [],
            itens: [
              {
                id: "tarefa:task-1",
                origem: "tarefa",
                nivel: "alta",
                titulo: "Enviar proposta",
                fato: { tipo: "prazo_vencido", em: "2026-09-17T15:00:00.000Z" },
                inferencia: null,
                recomendacao: "concluir_ou_reagendar",
                href: "/app/tasks",
              },
            ],
          },
          atividades: {
            estado: "disponivel",
            dados: [
              {
                id: "atividade-1",
                rotulo: "Lead atualizado",
                ator: "Pessoa",
                realizada_em: "2026-09-17T18:00:00.000Z",
                href: "/app/leads/lead-1",
              },
            ],
          },
        }}
      />,
    );

    expect(html).toContain("08:00");
    expect(html).toContain("11:00");
    expect(html).toContain("14:00");
  });

  it("usa o parâmetro canônico do filtro da fila no link do Inbox", () => {
    const html = renderToStaticMarkup(
      <CockpitView model={model()} idioma="pt-BR" timezone="UTC" />,
    );

    expect(html).toContain('href="/app/inbox?filter=unassigned"');
    expect(html).not.toContain("/app/inbox?tab=unassigned");
  });
});

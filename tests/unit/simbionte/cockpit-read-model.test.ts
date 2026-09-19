import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { RadarDeRisco } from "@/lib/leads/radar-de-risco";
import {
  FONTES_PADRAO_DO_COCKPIT,
  carregarCockpit,
  montarPrioridades,
  type FontesDoCockpit,
  type TarefasDoCockpit,
} from "@/lib/simbionte/cockpit/read-model";

const ORG = "00000000-0000-4000-8000-0000000000c0";
const AGORA = new Date("2026-09-17T12:00:00.000Z");
const CLIENT = {} as SupabaseClient;

const RADAR_VAZIO: RadarDeRisco = {
  items: [],
  counts: { critico: 0, em_risco: 0, em_voo: 0 },
  total: 0,
  sem_proximo_passo: [],
  total_sem_proximo_passo: 0,
};

const TAREFAS_VAZIAS: TarefasDoCockpit = { atrasadas: 0, itens: [] };

function fontes(overrides: Partial<FontesDoCockpit> = {}): FontesDoCockpit {
  return {
    radar: async () => RADAR_VAZIO,
    tarefas: async () => TAREFAS_VAZIAS,
    atendimento: async () => ({ fila_humana: 0, em_atendimento_automatico: 0, abertas: 0 }),
    ia: async () => ({
      configurada: false,
      agentes_publicados: 0,
      agentes_no_ar: 0,
      avisos_abertos: 0,
      execucoes_24h: 0,
      falhas_24h: 0,
    }),
    atividades: async () => [],
    ...overrides,
  };
}

describe("read model do Cockpit", () => {
  it("representa uma organização sem dados como vazio real, não como falha", async () => {
    const model = await carregarCockpit(
      { client: CLIENT, organizationId: ORG, role: "manager", now: AGORA },
      fontes(),
    );

    expect(model.gerado_em).toBe(AGORA.toISOString());
    expect(model.resumo).toEqual({
      fila_humana: { estado: "disponivel", valor: 0 },
      riscos_criticos: { estado: "disponivel", valor: 0 },
      tarefas_atrasadas: { estado: "disponivel", valor: 0 },
      avisos_da_ia: { estado: "disponivel", valor: 0 },
    });
    expect(model.prioridades).toEqual({
      estado: "disponivel",
      itens: [],
      fontes_indisponiveis: [],
    });
    expect(model.ia).toMatchObject({ estado: "disponivel", dados: { configurada: false } });
  });

  it("isola uma falha e não fabrica zero para a fonte indisponível", async () => {
    const model = await carregarCockpit(
      { client: CLIENT, organizationId: ORG, role: "manager", now: AGORA },
      fontes({
        radar: async () => {
          throw new Error("radar fora");
        },
        atendimento: async () => ({ fila_humana: 7, em_atendimento_automatico: 3, abertas: 12 }),
      }),
    );

    expect(model.resumo.riscos_criticos).toEqual({ estado: "indisponivel", valor: null });
    expect(model.resumo.fila_humana).toEqual({ estado: "disponivel", valor: 7 });
    expect(model.prioridades.estado).toBe("parcial");
    expect(model.prioridades.fontes_indisponiveis).toEqual(["radar"]);
    expect(model.atendimento).toMatchObject({ estado: "disponivel" });
  });

  it("não publica a fila como fato quando a leitura real de ai_agents falha", async () => {
    const consulta = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "ai_agents indisponível" },
      }),
    };
    const client = {
      from: vi.fn((tabela: string) => {
        expect(tabela).toBe("ai_agents");
        return consulta;
      }),
    } as unknown as SupabaseClient;

    const model = await carregarCockpit(
      { client, organizationId: ORG, role: "manager", now: AGORA },
      fontes({ atendimento: FONTES_PADRAO_DO_COCKPIT.atendimento }),
    );

    expect(model.atendimento).toEqual({ estado: "indisponivel" });
    expect(model.resumo.fila_humana).toEqual({ estado: "indisponivel", valor: null });
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("deriva prioridade sem misturar fato, inferência e recomendação", () => {
    const radar: RadarDeRisco = {
      ...RADAR_VAZIO,
      items: [
        {
          id: "lead-1",
          title: "Renovação",
          contact_id: "contact-1",
          contact_name: "Pessoa A",
          owner_user_id: null,
          owner_kind: null,
          owner_agent_id: null,
          owner_agent_name: null,
          assignee_kind: null,
          last_activity_at: "2026-09-14T12:00:00.000Z",
          hours_since_activity: 72,
          risk: "critico",
          in_flight: false,
          next_followup_at: null,
          conversation_id: "conversation-1",
          pipeline_id: "pipeline-1",
        },
      ],
      counts: { critico: 1, em_risco: 0, em_voo: 0 },
      total: 1,
    };
    const prioridades = montarPrioridades(
      { estado: "disponivel", dados: radar },
      {
        estado: "disponivel",
        dados: {
          atrasadas: 1,
          itens: [
            {
              id: "task-1",
              titulo: "Enviar proposta",
              vence_em: "2026-09-16T12:00:00.000Z",
              prioridade: "high",
            },
          ],
        },
      },
    );

    expect(prioridades.itens[0]).toMatchObject({
      id: "radar:lead-1",
      fato: { tipo: "sem_atividade", horas: 72 },
      inferencia: "risco_critico",
      recomendacao: "retomar_contato",
      href: "/app/inbox/conversation-1",
    });
    expect(prioridades.itens[1]).toMatchObject({
      id: "tarefa:task-1",
      fato: { tipo: "prazo_vencido", em: "2026-09-16T12:00:00.000Z" },
      inferencia: null,
      recomendacao: "concluir_ou_reagendar",
    });
  });

  it("propaga somente a organização confiável para todas as fontes", async () => {
    const recebidas: string[] = [];
    const observar = <T,>(valor: T) => async (contexto: { organizationId: string }) => {
      recebidas.push(contexto.organizationId);
      return valor;
    };
    const f = fontes({
      radar: observar(RADAR_VAZIO),
      tarefas: observar(TAREFAS_VAZIAS),
      atendimento: observar({ fila_humana: 0, em_atendimento_automatico: 0, abertas: 0 }),
      ia: observar({
        configurada: false,
        agentes_publicados: 0,
        agentes_no_ar: 0,
        avisos_abertos: 0,
        execucoes_24h: 0,
        falhas_24h: 0,
      }),
      atividades: observar([]),
    });

    await carregarCockpit(
      { client: CLIENT, organizationId: ORG, role: "manager", now: AGORA },
      f,
    );

    expect(recebidas).toEqual([ORG, ORG, ORG, ORG, ORG]);
    expect(recebidas).not.toContain("organization_id_do_browser");
  });

  it("consulta as cinco fontes em paralelo", async () => {
    const radar = vi.fn(async () => RADAR_VAZIO);
    const tarefas = vi.fn(async () => TAREFAS_VAZIAS);
    await carregarCockpit(
      { client: CLIENT, organizationId: ORG, role: "manager", now: AGORA },
      fontes({ radar, tarefas }),
    );
    expect(radar).toHaveBeenCalledOnce();
    expect(tarefas).toHaveBeenCalledOnce();
  });
});

import type { SupabaseClient } from "@supabase/supabase-js";

import { orgTemAutomatico } from "@/lib/ai/agents/org-tem-automatico";
import { agenteAtende } from "@/lib/ai/agents/no-ar";
import type { Role } from "@/lib/auth/types";
import { comandosDaFila } from "@/lib/inbox/comando-da-conversa";
import { activityLabel, actorLabel } from "@/lib/leads/activity-vocabulary";
import { carregaRadarDeRisco, type RadarDeRisco } from "@/lib/leads/radar-de-risco";
import { logger } from "@/lib/logger";
import { CONVERSATION_TERMINAL_STATUSES } from "@/lib/schemas";
import { estaAtrasada, type Tarefa } from "@/lib/tarefas/tipos";

export type EstadoDaFonte<T> =
  | { estado: "disponivel"; dados: T }
  | { estado: "indisponivel" };

export interface NumeroDoCockpit {
  estado: "disponivel" | "indisponivel";
  valor: number | null;
}

export interface AtendimentoDoCockpit {
  fila_humana: number;
  em_atendimento_automatico: number;
  abertas: number;
}

export interface IaDoCockpit {
  configurada: boolean;
  agentes_publicados: number;
  agentes_no_ar: number;
  avisos_abertos: number;
  execucoes_24h: number;
  falhas_24h: number;
}

export interface AtividadeDoCockpit {
  id: string;
  rotulo: string;
  ator: string;
  realizada_em: string;
  href: string;
}

export interface TarefaDoCockpit {
  id: string;
  titulo: string;
  vence_em: string;
  prioridade: Tarefa["priority"];
}

export interface TarefasDoCockpit {
  atrasadas: number;
  itens: TarefaDoCockpit[];
}

export type NivelDaPrioridade = "critica" | "alta";

/**
 * A forma separa o que aconteceu do que o sistema concluiu e do que recomenda.
 * A UI não recebe uma frase única capaz de transformar inferência em fato.
 */
export interface PrioridadeDoCockpit {
  id: string;
  origem: "radar" | "demanda" | "tarefa";
  nivel: NivelDaPrioridade;
  titulo: string;
  fato:
    | { tipo: "sem_atividade"; horas: number }
    | { tipo: "sem_proximo_passo"; horas: number }
    | { tipo: "prazo_vencido"; em: string };
  inferencia: "risco_critico" | "em_risco" | null;
  recomendacao: "retomar_contato" | "definir_proximo_passo" | "concluir_ou_reagendar";
  href: string;
}

export interface PrioridadesDoCockpit {
  estado: "disponivel" | "parcial" | "indisponivel";
  itens: PrioridadeDoCockpit[];
  fontes_indisponiveis: Array<"radar" | "tarefas">;
}

export interface CockpitReadModel {
  gerado_em: string;
  resumo: {
    fila_humana: NumeroDoCockpit;
    riscos_criticos: NumeroDoCockpit;
    tarefas_atrasadas: NumeroDoCockpit;
    avisos_da_ia: NumeroDoCockpit;
  };
  prioridades: PrioridadesDoCockpit;
  atendimento: EstadoDaFonte<AtendimentoDoCockpit>;
  ia: EstadoDaFonte<IaDoCockpit>;
  atividades: EstadoDaFonte<AtividadeDoCockpit[]>;
}

export interface ContextoDoCockpit {
  client: SupabaseClient;
  organizationId: string;
  role: Role;
  now: Date;
}

export interface FontesDoCockpit {
  radar(contexto: ContextoDoCockpit): Promise<RadarDeRisco>;
  tarefas(contexto: ContextoDoCockpit): Promise<TarefasDoCockpit>;
  atendimento(contexto: ContextoDoCockpit): Promise<AtendimentoDoCockpit>;
  ia(contexto: ContextoDoCockpit): Promise<IaDoCockpit>;
  atividades(contexto: ContextoDoCockpit): Promise<AtividadeDoCockpit[]>;
}

function numero<T>(fonte: EstadoDaFonte<T>, ler: (dados: T) => number): NumeroDoCockpit {
  if (fonte.estado === "indisponivel") return { estado: "indisponivel", valor: null };
  return { estado: "disponivel", valor: ler(fonte.dados) };
}

async function lerFonte<T>(
  nome: keyof FontesDoCockpit,
  leitura: () => Promise<T>,
): Promise<EstadoDaFonte<T>> {
  try {
    return { estado: "disponivel", dados: await leitura() };
  } catch (error) {
    logger.warn("[simbionte.cockpit] fonte indisponivel", {
      fonte: nome,
      erro: error instanceof Error ? error.message : "erro_desconhecido",
    });
    return { estado: "indisponivel" };
  }
}

function hrefDoRadar(item: RadarDeRisco["items"][number]): string {
  if (item.conversation_id) return `/app/inbox/${item.conversation_id}`;
  return `/app/pipelines/${item.pipeline_id}?lead=${item.id}`;
}

function prioridadesDoRadar(radar: RadarDeRisco): PrioridadeDoCockpit[] {
  const leads = radar.items
    .filter((item) => item.risk === "critico" || item.risk === "em_risco")
    .map<PrioridadeDoCockpit>((item) => ({
      id: `radar:${item.id}`,
      origem: "radar",
      nivel: item.risk === "critico" ? "critica" : "alta",
      titulo: item.contact_name ?? item.title,
      fato: { tipo: "sem_atividade", horas: item.hours_since_activity },
      inferencia: item.risk === "critico" ? "risco_critico" : "em_risco",
      recomendacao: "retomar_contato",
      href: hrefDoRadar(item),
    }));

  const demandas = radar.sem_proximo_passo.slice(0, 3).map<PrioridadeDoCockpit>((item) => ({
    id: `demanda:${item.id}`,
    origem: "demanda",
    // Sem limiar inventado pelo Cockpit: o fato canônico é "sem próximo passo".
    // Crítico só vem de regras que já existem (Radar ou prioridade urgente da tarefa).
    nivel: "alta",
    titulo: item.contact_name ?? "Demanda aberta",
    fato: { tipo: "sem_proximo_passo", horas: item.horas_aberta },
    inferencia: null,
    recomendacao: "definir_proximo_passo",
    href: "/app/radar",
  }));

  return [...leads, ...demandas];
}

function prioridadesDasTarefas(tarefas: TarefasDoCockpit): PrioridadeDoCockpit[] {
  return tarefas.itens.map((item) => ({
    id: `tarefa:${item.id}`,
    origem: "tarefa",
    nivel: item.prioridade === "urgent" ? "critica" : "alta",
    titulo: item.titulo,
    fato: { tipo: "prazo_vencido", em: item.vence_em },
    inferencia: null,
    recomendacao: "concluir_ou_reagendar",
    href: "/app/tasks",
  }));
}

export function montarPrioridades(
  radar: EstadoDaFonte<RadarDeRisco>,
  tarefas: EstadoDaFonte<TarefasDoCockpit>,
): PrioridadesDoCockpit {
  const indisponiveis: PrioridadesDoCockpit["fontes_indisponiveis"] = [];
  const itens: PrioridadeDoCockpit[] = [];

  if (radar.estado === "disponivel") itens.push(...prioridadesDoRadar(radar.dados));
  else indisponiveis.push("radar");

  if (tarefas.estado === "disponivel") itens.push(...prioridadesDasTarefas(tarefas.dados));
  else indisponiveis.push("tarefas");

  const peso: Record<NivelDaPrioridade, number> = { critica: 2, alta: 1 };
  itens.sort((a, b) => peso[b.nivel] - peso[a.nivel]);

  return {
    estado:
      indisponiveis.length === 0
        ? "disponivel"
        : indisponiveis.length === 2
          ? "indisponivel"
          : "parcial",
    itens: itens.slice(0, 6),
    fontes_indisponiveis: indisponiveis,
  };
}

async function lerRadar(contexto: ContextoDoCockpit): Promise<RadarDeRisco> {
  return carregaRadarDeRisco(contexto.client, {
    organizationId: contexto.organizationId,
    humanRole: contexto.role,
    limit: 6,
    now: contexto.now,
  });
}

async function lerTarefas(contexto: ContextoDoCockpit): Promise<TarefasDoCockpit> {
  const resultado = await contexto.client
    .from("crm_tasks")
    .select("id, title, due_date, priority, status", { count: "exact" })
    .eq("organization_id", contexto.organizationId)
    .in("status", ["pending", "in_progress"])
    .lt("due_date", contexto.now.toISOString())
    .order("due_date", { ascending: true })
    .limit(4);
  if (resultado.error) throw new Error(`cockpit_tasks_failed: ${resultado.error.message}`);

  const rows = (resultado.data ?? []) as Array<
    Pick<Tarefa, "id" | "title" | "due_date" | "priority" | "status">
  >;
  const atrasadas = rows.filter((tarefa) => estaAtrasada(tarefa, contexto.now));
  return {
    atrasadas: resultado.count ?? atrasadas.length,
    itens: atrasadas.flatMap((tarefa) =>
      tarefa.due_date
        ? [
            {
              id: tarefa.id,
              titulo: tarefa.title,
              vence_em: tarefa.due_date,
              prioridade: tarefa.priority,
            },
          ]
        : [],
    ),
  };
}

async function lerAtendimento(contexto: ContextoDoCockpit): Promise<AtendimentoDoCockpit> {
  const automaticoDaOrg = await orgTemAutomatico(contexto.client, contexto.organizationId);
  if (automaticoDaOrg === undefined) {
    throw new Error("cockpit_automatico_failed");
  }
  const contar = () =>
    contexto.client
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", contexto.organizationId);

  const [fila, automatico, abertas] = await Promise.all([
    contar().in("comando_da_conversa", comandosDaFila(automaticoDaOrg)),
    contar().eq("comando_da_conversa", "automatico"),
    contar().not("status", "in", `(${CONVERSATION_TERMINAL_STATUSES.join(",")})`),
  ]);
  const erro = fila.error ?? automatico.error ?? abertas.error;
  if (erro) throw new Error(`cockpit_inbox_failed: ${erro.message}`);
  return {
    fila_humana: fila.count ?? 0,
    em_atendimento_automatico: automatico.count ?? 0,
    abertas: abertas.count ?? 0,
  };
}

async function lerIa(contexto: ContextoDoCockpit): Promise<IaDoCockpit> {
  const desde = new Date(contexto.now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const [agentes, avisos, execucoes, falhas] = await Promise.all([
    contexto.client
      .from("ai_agents")
      .select("kind, is_active, paused_at, published_version_id, archived_at")
      .eq("organization_id", contexto.organizationId)
      .is("archived_at", null),
    contexto.client
      .from("agent_inbox_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", contexto.organizationId)
      .eq("status", "open"),
    contexto.client
      .from("llm_calls")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", contexto.organizationId)
      .gte("created_at", desde),
    contexto.client
      .from("llm_calls")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", contexto.organizationId)
      .gte("created_at", desde)
      .eq("status", "erro"),
  ]);
  const erro = agentes.error ?? avisos.error ?? execucoes.error ?? falhas.error;
  if (erro) throw new Error(`cockpit_ai_failed: ${erro.message}`);

  const rows = agentes.data ?? [];
  return {
    configurada: rows.length > 0,
    agentes_publicados: rows.filter((agente) => agente.published_version_id !== null).length,
    agentes_no_ar: rows.filter(agenteAtende).length,
    avisos_abertos: avisos.count ?? 0,
    execucoes_24h: execucoes.count ?? 0,
    falhas_24h: falhas.count ?? 0,
  };
}

async function lerAtividades(contexto: ContextoDoCockpit): Promise<AtividadeDoCockpit[]> {
  const resultado = await contexto.client
    .from("crm_lead_activities")
    .select("id, type, performed_at, actor_kind, lead_id")
    .eq("organization_id", contexto.organizationId)
    .order("performed_at", { ascending: false })
    .limit(6);
  if (resultado.error) throw new Error(`cockpit_activities_failed: ${resultado.error.message}`);

  return (resultado.data ?? []).map((atividade) => ({
    id: atividade.id,
    rotulo: activityLabel(atividade.type),
    ator: actorLabel(atividade.actor_kind),
    realizada_em: atividade.performed_at,
    href: `/app/leads/${atividade.lead_id}`,
  }));
}

export const FONTES_PADRAO_DO_COCKPIT: FontesDoCockpit = {
  radar: lerRadar,
  tarefas: lerTarefas,
  atendimento: lerAtendimento,
  ia: lerIa,
  atividades: lerAtividades,
};

export async function carregarCockpit(
  input: Omit<ContextoDoCockpit, "now"> & { now?: Date },
  fontes: FontesDoCockpit = FONTES_PADRAO_DO_COCKPIT,
): Promise<CockpitReadModel> {
  const contexto: ContextoDoCockpit = { ...input, now: input.now ?? new Date() };
  const [radar, tarefas, atendimento, ia, atividades] = await Promise.all([
    lerFonte("radar", () => fontes.radar(contexto)),
    lerFonte("tarefas", () => fontes.tarefas(contexto)),
    lerFonte("atendimento", () => fontes.atendimento(contexto)),
    lerFonte("ia", () => fontes.ia(contexto)),
    lerFonte("atividades", () => fontes.atividades(contexto)),
  ]);

  return {
    gerado_em: contexto.now.toISOString(),
    resumo: {
      fila_humana: numero(atendimento, (dados) => dados.fila_humana),
      riscos_criticos: numero(radar, (dados) => dados.counts.critico),
      tarefas_atrasadas: numero(tarefas, (dados) => dados.atrasadas),
      avisos_da_ia: numero(ia, (dados) => dados.avisos_abertos),
    },
    prioridades: montarPrioridades(radar, tarefas),
    atendimento,
    ia,
    atividades,
  };
}

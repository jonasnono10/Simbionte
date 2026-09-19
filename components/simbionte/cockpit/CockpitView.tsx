import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import type {
  CockpitReadModel,
  NumeroDoCockpit,
  PrioridadeDoCockpit,
} from "@/lib/simbionte/cockpit/read-model";
import {
  ArrowRight,
  Brain,
  ChartBar,
  Clock,
  Gauge,
  ListChecks,
  Sparkle,
  Tray,
  Warning,
} from "@/lib/ui/icons";

interface CockpitViewProps {
  model: CockpitReadModel;
  idioma: Idioma;
  timezone: string;
}

function LinkDaSecao({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
    >
      {children}
      <ArrowRight aria-hidden size={14} />
    </Link>
  );
}

function CardDeNumero({
  titulo,
  numero,
  detalhe,
  href,
  idioma,
}: {
  titulo: string;
  numero: NumeroDoCockpit;
  detalhe: string;
  href: string;
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-xs font-medium text-text-muted">{t(titulo)}</p>
        <p className="text-2xl font-semibold tabular-nums">
          {numero.estado === "disponivel"
            ? numero.valor?.toLocaleString(idioma === "es" ? "es" : "pt-BR")
            : "—"}
        </p>
        <p className="text-xs text-text-muted">
          {numero.estado === "disponivel" ? t(detalhe) : t("Fonte indisponível agora")}
        </p>
        <LinkDaSecao href={href}>{t("Ver detalhes")}</LinkDaSecao>
      </CardContent>
    </Card>
  );
}

function AvisoDeFonte({ texto, idioma }: { texto: string; idioma: Idioma }) {
  const t = (chave: string) => traduzir(chave, idioma);
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning-fg/20 bg-warning-bg p-3 text-sm text-warning-fg">
      <Warning aria-hidden className="mt-0.5 shrink-0" size={16} />
      <p>{t(texto)}</p>
    </div>
  );
}

function Prioridade({
  item,
  idioma,
  timezone,
}: {
  item: PrioridadeDoCockpit;
  idioma: Idioma;
  timezone: string;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const tag = idioma === "es" ? "es" : "pt-BR";
  const fato =
    item.fato.tipo === "prazo_vencido"
      ? `${t("Prazo vencido em")} ${new Date(item.fato.em).toLocaleString(tag, {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: timezone,
        })}`
      : item.fato.tipo === "sem_atividade"
        ? `${t("Sem atividade há")} ${item.fato.horas.toLocaleString(tag)} h`
        : `${t("Aberta há")} ${item.fato.horas.toLocaleString(tag)} h ${t("sem próximo passo registrado")}`;
  const inferencia =
    item.inferencia === "risco_critico"
      ? t("Risco crítico")
      : item.inferencia === "em_risco"
        ? t("Em risco")
        : null;
  const recomendacao =
    item.recomendacao === "retomar_contato"
      ? t("Retomar contato")
      : item.recomendacao === "definir_proximo_passo"
        ? t("Definir o próximo passo")
        : t("Concluir ou reagendar");

  return (
    <li className="rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-text">
            {item.titulo === "Demanda aberta" ? t("Demanda aberta") : item.titulo}
          </p>
          <p className="mt-1 text-sm text-text-muted">{fato}</p>
        </div>
        <Badge variant={item.nivel === "critica" ? "error" : "warning"}>
          {item.nivel === "critica" ? t("Crítica") : t("Alta")}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <span>
          <strong className="font-medium text-text">{t("Fato")}:</strong>{" "}
          <span className="text-text-muted">{fato}</span>
        </span>
        {inferencia ? (
          <span>
            <strong className="font-medium text-text">{t("Inferência")}:</strong>{" "}
            <span className="text-text-muted">{inferencia}</span>
          </span>
        ) : null}
        <span>
          <strong className="font-medium text-text">{t("Recomendação")}:</strong>{" "}
          <span className="text-text-muted">{recomendacao}</span>
        </span>
      </div>
      <div className="mt-3">
        <LinkDaSecao href={item.href}>{t("Abrir contexto")}</LinkDaSecao>
      </div>
    </li>
  );
}

function Placeholder({
  titulo,
  descricao,
  icone: Icon,
  idioma,
}: {
  titulo: string;
  descricao: string;
  icone: typeof Sparkle;
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon aria-hidden className="text-text-muted" size={20} weight="duotone" />
          <CardTitle>
            <h2>{t(titulo)}</h2>
          </CardTitle>
        </div>
        <CardDescription>{t(descricao)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Badge variant="neutral">{t("Disponível em próxima etapa")}</Badge>
      </CardContent>
    </Card>
  );
}

export function CockpitView({ model, idioma, timezone }: CockpitViewProps) {
  const t = (texto: string) => traduzir(texto, idioma);
  const tag = idioma === "es" ? "es" : "pt-BR";

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Gauge aria-hidden className="text-accent" size={28} weight="duotone" />
            <h1 className="text-2xl font-semibold tracking-tight">{t("Cockpit")}</h1>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {t("O que pede atenção agora, reunido sem alterar a operação.")}
          </p>
        </div>
        <p className="text-xs text-text-muted">
          {t("Atualizado em")} {new Date(model.gerado_em).toLocaleString(tag, {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: timezone,
          })}
        </p>
      </header>

      <section aria-labelledby="resumo-operacao">
        <div className="mb-3 flex items-center gap-2">
          <ChartBar aria-hidden size={20} />
          <h2 id="resumo-operacao" className="text-lg font-semibold">
            {t("Resumo da operação")}
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CardDeNumero
            titulo="Na fila humana"
            numero={model.resumo.fila_humana}
            detalhe="Conversas que pedem uma pessoa agora"
            href="/app/inbox?filter=unassigned"
            idioma={idioma}
          />
          <CardDeNumero
            titulo="Riscos críticos"
            numero={model.resumo.riscos_criticos}
            detalhe="Classificação do Radar de Risco"
            href="/app/radar"
            idioma={idioma}
          />
          <CardDeNumero
            titulo="Tarefas atrasadas"
            numero={model.resumo.tarefas_atrasadas}
            detalhe="Tarefas abertas com prazo vencido"
            href="/app/tasks"
            idioma={idioma}
          />
          <CardDeNumero
            titulo="Avisos da IA"
            numero={model.resumo.avisos_da_ia}
            detalhe="Avisos abertos na Central da IA"
            href="/app/ai/inbox"
            idioma={idioma}
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ListChecks aria-hidden size={20} />
              <CardTitle>
                <h2>{t("Prioridades")}</h2>
              </CardTitle>
            </div>
            <CardDescription>
              {t("Fatos, inferências e recomendações aparecem separados para você decidir.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {model.prioridades.estado === "parcial" ? (
              <AvisoDeFonte
                texto="Parte das prioridades não pôde ser carregada. O restante continua disponível."
                idioma={idioma}
              />
            ) : null}
            {model.prioridades.estado === "indisponivel" ? (
              <AvisoDeFonte
                texto="As fontes de prioridades estão indisponíveis agora. Tente novamente em instantes."
                idioma={idioma}
              />
            ) : model.prioridades.itens.length === 0 ? (
              <p className="text-sm text-text-muted">
                {t("Nenhuma prioridade crítica foi encontrada agora.")}
              </p>
            ) : (
              <ul className="space-y-3">
                {model.prioridades.itens.map((item) => (
                  <Prioridade
                    key={item.id}
                    item={item}
                    idioma={idioma}
                    timezone={timezone}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Tray aria-hidden size={20} />
              <CardTitle>
                <h2>{t("Atendimento")}</h2>
              </CardTitle>
            </div>
            <CardDescription>{t("Estado atual das conversas abertas.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {model.atendimento.estado === "indisponivel" ? (
              <AvisoDeFonte
                texto="Não foi possível ler os indicadores do Inbox agora."
                idioma={idioma}
              />
            ) : (
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-text-muted">{t("Na fila humana")}</dt>
                  <dd className="font-semibold tabular-nums">
                    {model.atendimento.dados.fila_humana.toLocaleString(tag)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-text-muted">{t("Com a IA")}</dt>
                  <dd className="font-semibold tabular-nums">
                    {model.atendimento.dados.em_atendimento_automatico.toLocaleString(tag)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-text-muted">{t("Conversas abertas")}</dt>
                  <dd className="font-semibold tabular-nums">
                    {model.atendimento.dados.abertas.toLocaleString(tag)}
                  </dd>
                </div>
              </dl>
            )}
            <LinkDaSecao href="/app/inbox">{t("Abrir Inbox")}</LinkDaSecao>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Brain aria-hidden size={20} />
              <CardTitle>
                <h2>{t("IA")}</h2>
              </CardTitle>
            </div>
            <CardDescription>{t("Configuração e sinais das últimas 24 horas.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {model.ia.estado === "indisponivel" ? (
              <AvisoDeFonte texto="Não foi possível ler o estado da IA agora." idioma={idioma} />
            ) : !model.ia.dados.configurada ? (
              <div className="space-y-3">
                <p className="text-sm text-text-muted">
                  {t("Nenhum agente de IA foi configurado nesta organização.")}
                </p>
                <LinkDaSecao href="/app/ai/agents">{t("Configurar agentes")}</LinkDaSecao>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-surface-elevated p-3">
                  <dt className="text-xs text-text-muted">{t("Agentes no ar")}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {model.ia.dados.agentes_no_ar.toLocaleString(tag)}
                  </dd>
                </div>
                <div className="rounded-md bg-surface-elevated p-3">
                  <dt className="text-xs text-text-muted">{t("Publicados")}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {model.ia.dados.agentes_publicados.toLocaleString(tag)}
                  </dd>
                </div>
                <div className="rounded-md bg-surface-elevated p-3">
                  <dt className="text-xs text-text-muted">{t("Execuções em 24 h")}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {model.ia.dados.execucoes_24h.toLocaleString(tag)}
                  </dd>
                </div>
                <div className="rounded-md bg-surface-elevated p-3">
                  <dt className="text-xs text-text-muted">{t("Falhas em 24 h")}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {model.ia.dados.falhas_24h.toLocaleString(tag)}
                  </dd>
                </div>
              </dl>
            )}
            <LinkDaSecao href="/app/ai/runs">{t("Ver execuções da IA")}</LinkDaSecao>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock aria-hidden size={20} />
              <CardTitle>
                <h2>{t("Atividade recente")}</h2>
              </CardTitle>
            </div>
            <CardDescription>{t("Últimos movimentos registrados no CRM.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {model.atividades.estado === "indisponivel" ? (
              <AvisoDeFonte texto="Não foi possível ler a atividade recente agora." idioma={idioma} />
            ) : model.atividades.dados.length === 0 ? (
              <p className="text-sm text-text-muted">{t("Ainda não há atividade registrada.")}</p>
            ) : (
              <ol className="divide-y divide-border">
                {model.atividades.dados.map((atividade) => (
                  <li
                    key={atividade.id}
                    className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-text">{t(atividade.rotulo)}</p>
                      <p className="text-xs text-text-muted">
                        {t(atividade.ator)} · {new Date(atividade.realizada_em).toLocaleString(tag, {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: timezone,
                        })}
                      </p>
                    </div>
                    <LinkDaSecao href={atividade.href}>{t("Abrir")}</LinkDaSecao>
                  </li>
                ))}
              </ol>
            )}
            <LinkDaSecao href="/app/activities">{t("Ver relatório de atividades")}</LinkDaSecao>
          </CardContent>
        </Card>

        <Placeholder
          titulo="Aprovações"
          descricao="Decisões que exigem confirmação humana aparecerão aqui."
          icone={ListChecks}
          idioma={idioma}
        />
        <Placeholder
          titulo="Supervisor"
          descricao="A conversa com o Supervisor ainda não está ativa neste Cockpit."
          icone={Sparkle}
          idioma={idioma}
        />
      </div>
    </div>
  );
}

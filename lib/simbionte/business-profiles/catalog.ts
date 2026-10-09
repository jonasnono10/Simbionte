import { parseBusinessProfileManifest, type BusinessProfileManifest } from "./manifest";

/** Propostas locais: não instalam nem ativam recursos ao serem importadas. */
export const GENERIC_PROFILE: BusinessProfileManifest = parseBusinessProfileManifest({
  formatVersion: 1,
  id: "generico",
  version: "1.0.0",
  displayName: "Genérico",
  description: "Um quadro adicional e neutro para acompanhar clientes, sem alterar a operação existente.",
  compatibility: { profileApi: { min: 1, max: 1 } },
  contributions: [
    { kind: "pipeline", key: "pipeline.main", name: "Clientes", isDefault: false },
    { kind: "stage", key: "stage.main.new", pipelineKey: "pipeline.main", name: "Novo contato", step: "new", position: 1 },
    { kind: "stage", key: "stage.main.contacted", pipelineKey: "pipeline.main", name: "Já respondi", step: "contacted", position: 2 },
    { kind: "stage", key: "stage.main.qualifying", pipelineKey: "pipeline.main", name: "Entendendo a necessidade", step: "qualifying", position: 3 },
    { kind: "stage", key: "stage.main.qualified", pipelineKey: "pipeline.main", name: "Proposta enviada", step: "qualified", position: 4 },
    { kind: "stage", key: "stage.main.negotiating", pipelineKey: "pipeline.main", name: "Negociando", step: "negotiating", position: 5 },
    { kind: "stage", key: "stage.main.won", pipelineKey: "pipeline.main", name: "Fechou", step: "won", position: 6 },
    { kind: "stage", key: "stage.main.lost", pipelineKey: "pipeline.main", name: "Não fechou", step: "lost", position: 7 },
  ],
});

export const SALON_PROFILE: BusinessProfileManifest = parseBusinessProfileManifest({
  formatVersion: 1,
  id: "salao-barbearia",
  version: "1.0.0",
  displayName: "Salão / Barbearia",
  description: "Um quadro adicional de agendamentos, sem criar reservas ou enviar mensagens.",
  compatibility: { profileApi: { min: 1, max: 1 } },
  contributions: [
    { kind: "pipeline", key: "pipeline.main", name: "Agendamentos", isDefault: false },
    { kind: "stage", key: "stage.main.new", pipelineKey: "pipeline.main", name: "Novo contato", step: "new", position: 1 },
    { kind: "stage", key: "stage.main.contacted", pipelineKey: "pipeline.main", name: "Já respondi", step: "contacted", position: 2 },
    { kind: "stage", key: "stage.main.qualifying", pipelineKey: "pipeline.main", name: "Entendendo serviço", step: "qualifying", position: 3 },
    { kind: "stage", key: "stage.main.qualified", pipelineKey: "pipeline.main", name: "Quer agendar", step: "qualified", position: 4 },
    { kind: "stage", key: "stage.main.negotiating", pipelineKey: "pipeline.main", name: "Escolhendo horário", step: "negotiating", position: 5 },
    { kind: "stage", key: "stage.main.won", pipelineKey: "pipeline.main", name: "Agendado", step: "won", position: 6 },
    { kind: "stage", key: "stage.main.lost", pipelineKey: "pipeline.main", name: "Não agendou", step: "lost", position: 7 },
    { kind: "field", key: "field.main.servico_desejado", pipelineKey: "pipeline.main", fieldKey: "servico_desejado", label: "Serviço desejado", type: "text", required: false },
    { kind: "field", key: "field.main.profissional_preferido", pipelineKey: "pipeline.main", fieldKey: "profissional_preferido", label: "Profissional preferido", type: "text", required: false },
  ],
});

export const BUSINESS_PROFILE_CATALOG = [GENERIC_PROFILE, SALON_PROFILE] as const;

export function getBusinessProfile(id: string): BusinessProfileManifest | undefined {
  return BUSINESS_PROFILE_CATALOG.find((profile) => profile.id === id);
}

# Business Profile preview — F2.3C

Camada **read-only** que responde o que mudaria se um profile fosse aplicado agora.
Não aplica, prepara ou grava operações. `capabilities.apply` permanece false.

## Fluxo e conexões reais

```text
GET preview -> requireRole(manager, allowPlatformAdmin: leitura) -> authz.org.orgId
            -> client de sessão/RLS -> installations + contributions (BASE)
                                    -> crm_pipelines + crm_stages (LOCAL)
catálogo local (TARGET) + BASE + LOCAL -> planBusinessProfileChanges -> JSON/summary/hash
```

O core puro (manifest, catalog, canonical, planner) permanece intacto e não importa
esta camada. Não existe dependência core -> SIMBIONTE. A classificação pertence
exclusivamente ao planner; a rota só traduz nomes de wire para snake_case.

## Proveniência e identidade

BASE usa profile_id/applied_version da instalação e managed_value persistido, nunca
uma versão antiga reconstruída do catálogo. managed/drifted participam de BASE;
released/retired ficam fora e, se ainda reais, aparecem em LOCAL não gerido.
Parsing explícito por resource_kind valida managed_value como **value** do snapshot,
não como linha CRM nem como snapshot completo. Shape inválido aborta integralmente.

resourceRef é referência opaca: UUID real de pipeline/stage ou configuração embutida.
Para fields: `crm-pipeline:<pipeline-id>:field:<field-key>`, estável e determinística.
Nenhuma referência é inferida pelo nome. Filho gerido usa parent_contribution_key
persistido; a correspondência com o pipeline real também é validada. Proveniência
inconsistente/movida falha fechado porque este contrato não contempla reparenting.
Filho não gerido usa a contributionKey do pipeline gerido, ou `local-pipeline:<id>`
se o pipeline é inteiramente não gerido. Jamais fabrica chave TARGET.

## Leitura, erros e isolamento

Todas as queries filtram organization_id confiável, mesmo com RLS de sessão.
Contributions também filtram profile_id. Projeções explícitas; fields vêm de settings.
São 3 leituras sem instalação ou 4 com instalação, antes da paginação; sem N+1.
Listas usam ordem por id, páginas de 1000 e count exact. Count ausente ou limite
servidor truncando uma página aborta em vez de produzir plano parcial.
Não há transação de snapshot entre as quatro leituras: concorrência operacional
pode exigir novo preview. Não é promessa de aplicabilidade nem autorização de apply.

agent_stage_hint null significa stage sem mapping, independentemente de flags,
nome ou posição. Hint inválido não vira null. Settings/fields ausentes válidos
significam lista vazia; fields presente inválido aborta.
Recurso ausente legítimo fica ausente e o planner decide CONFLICT.
Falhas DB/shape geram 500 sanitizado, logger com requestId/source/code sem SQL/PII.
Profile desconhecido 404; profile switch 409 PROFILE_SWITCH_NOT_SUPPORTED.
Sem contrato de query/body nem organização fornecida pelo cliente.
Auth, MFA, suporte e platform admin seguem o guard real, sem RBAC paralelo.
O guard pode emitir seu audit de segurança canônico em recusas; o preview não
produz audit de mutação, evento operacional nem escrita CRM/Business Profile.

## Prova de zero escrita

Testes usam query builder Supabase real com transporte local instrumentado:
somente GET de tabelas; única exceção é POST da RPC **de leitura** do guard canônico.
Métodos mutantes são bloqueados, nenhuma operation é consultada/criada.
Rota é testada com requireRole real (fontes de sessão e transporte controladas).
Cerca AST cobre runtime do preview e rota: não chama insert/update/delete/upsert
nem RPC própria, não importa admin/browser/service-role nem contém casts inseguros.
Isso não é execução da API contra PostgREST/RLS real: isolamento de policies
permanece coberto pelos invariantes F2.3B do CI, sem alterar schema ou infraestrutura.

## Living System Checklist

- Alimentado por catálogo local, proveniência F2.3B e CRM real; alimenta a resposta
  GET e seu consumidor/revisor de integração. Não há tela/aplicador nesta fase,
  exceção deliberada à experiência completa por escopo autorizado.
- Atividade operacional: N/A (leitura); erro observável no logger correlacionado.
- Porta concreta: GET /api/v1/simbionte/business-profiles/[profileId]/preview.
- Anti-morte e handoff IA/humano: N/A, não trata demanda nem agente.
- Configuração: catálogo e fontes canônicas existentes; ausência de installation
  mostra installed=false, ausência de recurso não é fabricada.
- Laço de retorno: erro explícito/read-only, testes de fail-closed e classificação
  de conflitos; nenhuma adaptação automática nem efeito externo.
- Mapa: conexões acima documentadas dentro da boundary GREEN. Atualização em
  docs/architecture fica para autorização própria; graphify indisponível localmente.

# Business Profiles — fundação F2.3A

Contrato declarativo local do SIMBIONTE. Um manifesto tem identidade e versão SemVer, compatibilidade com a API de perfis e contribuições de `pipeline`, `stage` ou definição opcional de campo de funil. Chaves semânticas não dependem do nome exibido. Agentes, automações, mensagens, autonomia, dados de clientes e efeitos externos são recusados.

`normalizeBusinessProfileManifest()` valida e ordena contribuições; `businessProfileDigest()` calcula SHA-256 do JSON canônico, sem timestamps. O planner recebe `BASE` (último valor aplicado), `LOCAL` (projeção atual dos **campos geridos**) e `TARGET` (manifesto). Ele ordena pipeline → etapas → campos e devolve classes, motivos, bloqueios e hash do plano. O adaptador futuro terá de fornecer o conjunto completo de recursos relevantes para detectar colisões; não se deve projetar contatos, leads ou conversas.

`resourceRef` é uma referência opaca ao recurso canônico, fornecida pelo adaptador. Pode ser o UUID de uma linha, uma referência canônica de configuração embutida ou outro identificador estável. O planner compara a referência sem presumir formato UUID. F2.3B a guarda como `resource_ref text`; a persistência de cada tipo no CRM continua fora desta fase.

`SAFE_ADD` e `SAFE_METADATA` são propostas, não autorização de escrita. `LOCAL_DRIFT` é preservado; `CONFLICT` e `DESTRUCTIVE` bloqueiam. Se `LOCAL` já for igual a `TARGET` mas divergir de `BASE`, a gestão não é reassumida sem decisão explícita. `PRIVILEGE_EXPANSION` e `EXTERNAL_EFFECT` são categorias de recusa para domínios futuros, nunca contribuições aplicáveis nesta fase.

## F2.3C.0 — etapa observada sem mapeamento

No snapshot de BASE/LOCAL, `step` aceita somente um dos sete `STAGE_STEPS` ou `null`. `step:null` significa ausência declarada de mapeamento para passo do agente: a etapa existe e foi lida corretamente. Não significa erro de banco/parser, timeout, recurso ausente ou dado desconhecido. Snapshot ausente significa recurso não encontrado. O adapter futuro deve abortar o preview em falha de leitura/projeção, nunca fabricar LOCAL vazio ou converter erro em `step:null`.

Não há inferência por nome, posição, slug, `isWon` ou `isLost`; essas duas marcações continuam independentes do passo observado. TARGET permanece estrito e exige um dos sete passos, sem `null`, inclusive nos perfis Genérico e Salão. O three-way preserva LOCAL com passo removido como `LOCAL_DRIFT` quando TARGET=BASE; se o TARGET também muda o passo, classifica `CONFLICT`. Etapa não gerida sem passo continua participando das colisões por nome.

Esta microfase ajusta somente o contrato puro consumido por `planBusinessProfileChanges()` e seus testes. Não cria adapter, API, tela, audit/evento, persistência ou mecanismo operacional; portanto não há nova porta, configuração, decisão automática, anti-morte ou laço runtime. A entrada é o snapshot validado; a saída são classes e `planHash`, provados nos testes do planner. Nenhuma peça nova exige alteração do mapa; a conexão real com preview permanece pendente na F2.3C.

## F2.3B — memória sem aplicador

A migration `20261003212120_0623_business_profile_persistence.sql` e seu apêndice idempotente no baseline preservam o mesmo DDL. O propósito está no cabeçalho `-- manifest:`; o `MANIFEST.md` histórico não recebe nova entrada. Na integração upstream, somente o número documental foi realocado para evitar colisão; o timestamp `20261003212120`, identidade da migration no Supabase, e o SQL executável foram preservados.

O banco mantém três tabelas, todas por organização: `business_profile_installations` (perfil atual, versão, digest, status e revisão monotônica positiva), `business_profile_contributions` (proveniência e último `managed_value` realmente aplicado, a BASE do próximo three-way diff) e `business_profile_operations` (chave idempotente, snapshot declarativo do manifesto e recibo terminal). Não há tabela separada de recibos. Perfil `active` não significa funil padrão; `disabled` não apaga a configuração. `managed_value` contém somente configuração gerida, nunca objeto bruto do CRM ou dados de cliente; o contrato semântico por tipo permanece na camada de aplicação futura. O snapshot da operação é imutável mesmo enquanto ela está `prepared`, para que uma versão antiga não dependa do catálogo de código atual.

RLS oferece leitura apenas a manager/admin da organização por `fn_user_org_ids()` e `fn_role_at_least()`; suporte full/read-only segue o RBAC canônico. Platform admin fora de uma organização não ganha leitura implícita. Não há policy ou GRANT de escrita para cliente nem para `service_role`; um aplicador futuro precisará de autorização própria e migration explícita. O trigger novo só impede reescrita do pedido e de recibos terminais; não toca CRM, não faz HTTP e não emite evento. `ON DELETE CASCADE` da organização segue a política de remoção do projeto.

**Não existe aplicação nesta entrega:** nenhuma rota, UI, RPC, worker, criação de pipeline/etapa/campo ou escrita operacional. A entrada futura é o planner puro F2.3A; a saída futura é um preview/recibo legível e um aplicador autorizado, ambos ainda inexistentes. A observabilidade, porta de UI, audit e laço de retorno são decisões das fases operacionais posteriores, não capacidades desta fundação.

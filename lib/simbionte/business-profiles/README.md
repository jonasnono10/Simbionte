# Business Profiles — fundação F2.3A

Contrato declarativo local do SIMBIONTE. Um manifesto tem identidade e versão SemVer, compatibilidade com a API de perfis e contribuições de `pipeline`, `stage` ou definição opcional de campo de funil. Chaves semânticas não dependem do nome exibido. Agentes, automações, mensagens, autonomia, dados de clientes e efeitos externos são recusados.

`normalizeBusinessProfileManifest()` valida e ordena contribuições; `businessProfileDigest()` calcula SHA-256 do JSON canônico, sem timestamps. O planner recebe `BASE` (último valor aplicado), `LOCAL` (projeção atual dos **campos geridos**) e `TARGET` (manifesto). Ele ordena pipeline → etapas → campos e devolve classes, motivos, bloqueios e hash do plano. O adaptador futuro terá de fornecer o conjunto completo de recursos relevantes para detectar colisões; não se deve projetar contatos, leads ou conversas.

`resourceRef` é uma referência opaca ao recurso canônico, fornecida pelo adaptador. Pode ser o UUID de uma linha, uma referência canônica de configuração embutida ou outro identificador estável. O planner compara a referência sem presumir formato UUID; a persistência por tipo de recurso será decidida na F2.3B.

`SAFE_ADD` e `SAFE_METADATA` são propostas, não autorização de escrita. `LOCAL_DRIFT` é preservado; `CONFLICT` e `DESTRUCTIVE` bloqueiam. Se `LOCAL` já for igual a `TARGET` mas divergir de `BASE`, a gestão não é reassumida sem decisão explícita. `PRIVILEGE_EXPANSION` e `EXTERNAL_EFFECT` são categorias de recusa para domínios futuros, nunca contribuições aplicáveis nesta fase.

**Não existe aplicação nesta entrega:** nenhum banco, RLS, API, UI, recibo ou escrita no CRM. A integração com o fluxo operacional e o mapa vivo ficam para as microfases autorizadas depois da revisão arquitetural.

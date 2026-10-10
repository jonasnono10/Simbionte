-- manifest: Autoriza somente os digests das versões oficiais de Business Profiles, sem expor RPC nem conceder escrita.
-- F2.3D1: registry fixo, não catálogo nem autorização de Apply.
create or replace function public.fn_business_profile_manifest_authorized(
  p_profile_id text,
  p_version text,
  p_digest text
) returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from (values
      ('generico', '1.0.0', 'ad9f6d328137d243b76301efa66ab6a78938119dea05554b9b9933086496d43b'),
      ('salao-barbearia', '1.0.0', '5cf0f6a9ceb1160e8c92b2c8f56759fc1acbdfa5e865f3c1edfad9f338ddb83d')
    ) as official(profile_id, version, digest)
    where official.profile_id = p_profile_id
      and official.version = p_version
      and official.digest = p_digest
  );
$function$;

revoke execute on function public.fn_business_profile_manifest_authorized(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_business_profile_manifest_authorized(text, text, text)
  to postgres;

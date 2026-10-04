-- 0535 — Memória dos Business Profiles. Nenhuma função aplica configuração ao CRM.
-- manifest: Guarda instalação, proveniência e recibos imutáveis por organização para o planner, sem aplicador nem escrita operacional no CRM.
-- A escrita fica sem GRANT/policy de cliente até existir um aplicador autorizado.
create table if not exists public.business_profile_installations (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  profile_id text not null check (profile_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  applied_version text not null check (applied_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'),
  manifest_digest text not null check (manifest_digest ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('active', 'disabled')),
  revision integer not null check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_profile_contributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id text not null check (profile_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  contribution_key text not null check (
    contribution_key ~ '^(pipeline|stage|field)\.[a-z0-9_]+(\.[a-z0-9_]+)*$'
  ),
  resource_kind text not null check (resource_kind in ('pipeline', 'stage', 'field')),
  resource_ref text not null check (length(btrim(resource_ref)) between 1 and 512),
  parent_contribution_key text,
  managed_value jsonb not null check (
    jsonb_typeof(managed_value) = 'object' and octet_length(managed_value::text) <= 8192
  ),
  managed_fingerprint text not null check (managed_fingerprint ~ '^[a-f0-9]{64}$'),
  applied_version text not null check (applied_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'),
  state text not null check (state in ('managed', 'drifted', 'released', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_profile_contributions_identity
    unique (organization_id, profile_id, contribution_key),
  constraint business_profile_contributions_kind_key
    check (split_part(contribution_key, '.', 1) = resource_kind),
  constraint business_profile_contributions_parent
    check (
      (resource_kind = 'pipeline' and parent_contribution_key is null)
      or (resource_kind in ('stage', 'field') and parent_contribution_key is not null
        and parent_contribution_key ~ '^pipeline\.[a-z0-9_]+$')
    ),
  constraint business_profile_contributions_parent_fkey
    foreign key (organization_id, profile_id, parent_contribution_key)
    references public.business_profile_contributions(organization_id, profile_id, contribution_key)
);
create index if not exists business_profile_contributions_org_profile
  on public.business_profile_contributions(organization_id, profile_id);

-- Uma idempotency_key pertence a um único request_hash por organização.
-- Repetição do mesmo hash lê a mesma linha; hash diferente colide no UNIQUE.
-- O snapshot não depende de o catálogo de código conservar versões antigas.
create table if not exists public.business_profile_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Referência histórica: FK SET NULL reescreveria recibo terminal no delete do usuário.
  actor_id uuid,
  operation_type text not null check (operation_type in ('install', 'upgrade', 'enable', 'disable')),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  profile_id text not null check (profile_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  target_version text not null check (target_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'),
  target_digest text not null check (target_digest ~ '^[a-f0-9]{64}$'),
  manifest_snapshot jsonb not null check (
    jsonb_typeof(manifest_snapshot) = 'object' and octet_length(manifest_snapshot::text) <= 65536
  ),
  expected_revision integer not null check (expected_revision >= 0),
  plan_hash text not null check (plan_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'prepared' check (status in ('prepared', 'completed', 'failed', 'cancelled')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint business_profile_operations_idempotency unique (organization_id, idempotency_key),
  constraint business_profile_operations_receipt check (
    (status = 'prepared' and finished_at is null and result is null)
    or (status in ('completed', 'failed', 'cancelled') and finished_at is not null
      and result is not null and jsonb_typeof(result) = 'object')
  ),
  constraint business_profile_operations_time check (
    updated_at >= created_at and (finished_at is null or finished_at >= created_at)
  )
);
create index if not exists business_profile_operations_org_recent
  on public.business_profile_operations(organization_id, created_at desc);

-- Toda troca do estado atual avança a revisão; no-op idempotente é permitido.
create or replace function public.fn_business_profile_installation_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  if new is not distinct from old then return new; end if;
  if new.organization_id is distinct from old.organization_id
     or new.created_at is distinct from old.created_at
     or new.revision <= old.revision then
    raise exception 'business_profile_revision_not_monotonic' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_business_profile_installation_revision()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_business_profile_installation_revision on public.business_profile_installations;
create trigger trg_business_profile_installation_revision
  before update on public.business_profile_installations
  for each row execute function public.fn_business_profile_installation_revision();

-- O pedido e o manifesto nunca são reescritos, nem enquanto prepared.
-- Um recibo terminal não pode mudar de estado nem de conteúdo. A exclusão
-- direta é revogada; ON DELETE CASCADE da organização permanece possível.
create or replace function public.fn_business_profile_operation_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status in ('completed', 'failed', 'cancelled') then
    raise exception 'business_profile_terminal_immutable' using errcode = '23514';
  end if;
  if row(new.id, new.organization_id, new.actor_id, new.operation_type,
         new.idempotency_key, new.request_hash, new.profile_id, new.target_version,
         new.target_digest, new.manifest_snapshot, new.expected_revision,
         new.plan_hash, new.created_at)
     is distinct from
     row(old.id, old.organization_id, old.actor_id, old.operation_type,
         old.idempotency_key, old.request_hash, old.profile_id, old.target_version,
         old.target_digest, old.manifest_snapshot, old.expected_revision,
         old.plan_hash, old.created_at) then
    raise exception 'business_profile_request_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_business_profile_operation_immutable()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_business_profile_operation_immutable on public.business_profile_operations;
create trigger trg_business_profile_operation_immutable
  before update on public.business_profile_operations
  for each row execute function public.fn_business_profile_operation_immutable();

alter table public.business_profile_installations enable row level security;
alter table public.business_profile_contributions enable row level security;
alter table public.business_profile_operations enable row level security;
revoke all on public.business_profile_installations,
  public.business_profile_contributions, public.business_profile_operations
  from public, anon, authenticated, service_role;
grant select on public.business_profile_installations,
  public.business_profile_contributions, public.business_profile_operations
  to authenticated, service_role;

drop policy if exists business_profile_installations_read on public.business_profile_installations;
create policy business_profile_installations_read on public.business_profile_installations
  for select to authenticated using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
    and (
      exists (select 1 from public.user_organizations u
        where u.organization_id = business_profile_installations.organization_id
          and u.user_id = auth.uid() and u.accepted_at is not null and u.revoked_at is null)
      or exists (select 1 from (select public.fn_support_context() s) c
        where c.s->>'status' = 'active'
          and (c.s->>'organization_id')::uuid = business_profile_installations.organization_id)
    )
  );
drop policy if exists business_profile_contributions_read on public.business_profile_contributions;
create policy business_profile_contributions_read on public.business_profile_contributions
  for select to authenticated using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
    and (
      exists (select 1 from public.user_organizations u
        where u.organization_id = business_profile_contributions.organization_id
          and u.user_id = auth.uid() and u.accepted_at is not null and u.revoked_at is null)
      or exists (select 1 from (select public.fn_support_context() s) c
        where c.s->>'status' = 'active'
          and (c.s->>'organization_id')::uuid = business_profile_contributions.organization_id)
    )
  );
drop policy if exists business_profile_operations_read on public.business_profile_operations;
create policy business_profile_operations_read on public.business_profile_operations
  for select to authenticated using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
    and (
      exists (select 1 from public.user_organizations u
        where u.organization_id = business_profile_operations.organization_id
          and u.user_id = auth.uid() and u.accepted_at is not null and u.revoked_at is null)
      or exists (select 1 from (select public.fn_support_context() s) c
        where c.s->>'status' = 'active'
          and (c.s->>'organization_id')::uuid = business_profile_operations.organization_id)
    )
  );

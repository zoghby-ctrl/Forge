-- Forge Milestone 2: authenticated, user-owned decision memory.
-- This schema deliberately contains no GitHub or AI-side effects. Repository and
-- pull-request identifiers are shaped for the next milestone, but are populated
-- only by Forge's persisted sample workspace in this milestone.

create extension if not exists pgcrypto;

create type public.forge_guarantee_status as enum (
  'proposed',
  'confirmed',
  'revised',
  'retired'
);

create type public.forge_verdict as enum (
  'ship',
  'ship_with_conditions',
  'hold',
  'insufficient_evidence'
);

create type public.forge_pull_request_status as enum (
  'needs_decision',
  'ready',
  'in_review',
  'closed'
);

create type public.forge_evidence_kind as enum (
  'intent',
  'guarantee',
  'path',
  'contradiction',
  'repair'
);

create type public.forge_evidence_tone as enum (
  'default',
  'alert',
  'repair'
);

create type public.forge_decision_action as enum (
  'ship',
  'ship_with_conditions',
  'hold',
  'insufficient_evidence'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'ready' check (status in ('draft', 'ready', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  updated_by uuid not null references auth.users (id) on delete cascade,
  unique (owner_id, slug)
);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  provider text not null default 'github' check (provider in ('github', 'manual')),
  provider_repository_id text,
  full_name text not null check (char_length(full_name) between 1 and 255),
  description text,
  default_branch text not null check (char_length(default_branch) between 1 and 255),
  language text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  updated_by uuid not null references auth.users (id) on delete cascade,
  unique (project_id, provider, full_name),
  unique (id, project_id)
);

create unique index repositories_provider_external_id_unique
  on public.repositories (provider, provider_repository_id)
  where provider_repository_id is not null;

create table public.pull_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  repository_id uuid not null references public.repositories (id) on delete cascade,
  provider_pull_request_id text,
  number integer not null check (number > 0),
  title text not null check (char_length(title) between 1 and 500),
  author_display_name text not null,
  author_login text,
  base_ref text not null,
  head_ref text not null,
  base_sha text,
  head_sha text,
  files_changed integer not null default 0 check (files_changed >= 0),
  review_status public.forge_pull_request_status not null default 'in_review',
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  updated_by uuid not null references auth.users (id) on delete cascade,
  unique (repository_id, number),
  unique (id, repository_id, project_id),
  foreign key (repository_id, project_id)
    references public.repositories (id, project_id)
);

create unique index pull_requests_provider_external_id_unique
  on public.pull_requests (repository_id, provider_pull_request_id)
  where provider_pull_request_id is not null;

create table public.system_guarantees (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  repository_id uuid references public.repositories (id) on delete cascade,
  statement text not null check (char_length(statement) between 1 and 1000),
  detail text not null check (char_length(detail) between 1 and 4000),
  status public.forge_guarantee_status not null default 'proposed',
  confidence_label text not null check (char_length(confidence_label) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  updated_by uuid not null references auth.users (id) on delete cascade,
  unique (project_id, statement),
  unique (id, project_id),
  foreign key (repository_id, project_id)
    references public.repositories (id, project_id)
);

create table public.change_passports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  repository_id uuid not null references public.repositories (id) on delete cascade,
  pull_request_id uuid not null references public.pull_requests (id) on delete cascade,
  passport_version integer not null default 1 check (passport_version > 0),
  verdict public.forge_verdict not null,
  summary text not null check (char_length(summary) between 1 and 8000),
  required_condition text not null check (char_length(required_condition) between 1 and 8000),
  confidence_label text not null check (char_length(confidence_label) between 1 and 160),
  review_state text not null default 'awaiting_repair' check (review_state in ('awaiting_repair', 'ready_for_decision', 'decided')),
  repair_staged_at timestamptz,
  repair_staged_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  updated_by uuid not null references auth.users (id) on delete cascade,
  unique (pull_request_id, passport_version),
  unique (id, project_id),
  foreign key (repository_id, project_id)
    references public.repositories (id, project_id),
  foreign key (pull_request_id, repository_id, project_id)
    references public.pull_requests (id, repository_id, project_id)
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  passport_id uuid not null references public.change_passports (id) on delete cascade,
  guarantee_id uuid references public.system_guarantees (id) on delete set null,
  ordinal smallint not null check (ordinal > 0),
  kind public.forge_evidence_kind not null,
  tone public.forge_evidence_tone not null default 'default',
  label text not null check (char_length(label) between 1 and 120),
  title text not null check (char_length(title) between 1 and 1000),
  detail text not null check (char_length(detail) between 1 and 4000),
  source_label text not null check (char_length(source_label) between 1 and 1000),
  source_path text,
  commit_sha text,
  line_start integer check (line_start is null or line_start > 0),
  line_end integer check (line_end is null or line_end >= line_start),
  excerpt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  updated_by uuid not null references auth.users (id) on delete cascade,
  unique (passport_id, ordinal),
  foreign key (passport_id, project_id)
    references public.change_passports (id, project_id),
  foreign key (guarantee_id, project_id)
    references public.system_guarantees (id, project_id)
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  passport_id uuid not null references public.change_passports (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  action public.forge_decision_action not null,
  rationale text,
  idempotency_key uuid not null default gen_random_uuid(),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (passport_id, actor_id, action),
  unique (actor_id, idempotency_key),
  unique (id, passport_id, project_id),
  foreign key (passport_id, project_id)
    references public.change_passports (id, project_id)
);

create table public.decision_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  passport_id uuid not null references public.change_passports (id) on delete cascade,
  decision_id uuid not null unique references public.decisions (id) on delete cascade,
  summary text not null check (char_length(summary) between 1 and 8000),
  required_condition text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  foreign key (passport_id, project_id)
    references public.change_passports (id, project_id),
  foreign key (decision_id, passport_id, project_id)
    references public.decisions (id, passport_id, project_id)
);

create index projects_owner_id_idx on public.projects (owner_id);
create index repositories_project_id_idx on public.repositories (project_id);
create index pull_requests_repository_id_updated_at_idx on public.pull_requests (repository_id, source_updated_at desc nulls last);
create index pull_requests_project_id_idx on public.pull_requests (project_id);
create index system_guarantees_project_id_idx on public.system_guarantees (project_id);
create index system_guarantees_repository_id_idx on public.system_guarantees (repository_id) where repository_id is not null;
create index change_passports_project_id_updated_at_idx on public.change_passports (project_id, updated_at desc);
create index change_passports_repository_id_idx on public.change_passports (repository_id);
create index evidence_passport_id_ordinal_idx on public.evidence (passport_id, ordinal);
create index evidence_guarantee_id_idx on public.evidence (guarantee_id) where guarantee_id is not null;
create index decisions_passport_id_recorded_at_idx on public.decisions (passport_id, recorded_at desc);
create index decision_memory_project_id_created_at_idx on public.decision_memory (project_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

create trigger projects_set_updated_at
before update on public.projects
for each row execute procedure public.set_updated_at();

create trigger repositories_set_updated_at
before update on public.repositories
for each row execute procedure public.set_updated_at();

create trigger pull_requests_set_updated_at
before update on public.pull_requests
for each row execute procedure public.set_updated_at();

create trigger system_guarantees_set_updated_at
before update on public.system_guarantees
for each row execute procedure public.set_updated_at();

create trigger change_passports_set_updated_at
before update on public.change_passports
for each row execute procedure public.set_updated_at();

create trigger evidence_set_updated_at
before update on public.evidence
for each row execute procedure public.set_updated_at();

-- The auth trigger needs elevated privileges because auth.users is owned by
-- Supabase Auth. It is not callable by API roles and uses an empty search path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Users created before this migration do not pass through the trigger. Backfill
-- those profiles once, while keeping the primary key relationship idempotent.
insert into public.profiles (id, email, display_name)
select
  id,
  coalesce(email, ''),
  coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name')
from auth.users
on conflict (id) do nothing;

-- This is the sole privileged decision-write path. It validates the caller's
-- ownership explicitly before atomically storing a decision and its durable
-- memory, while direct INSERT access to those tables stays revoked.
create or replace function public.record_forge_decision(
  p_passport_id uuid,
  p_action public.forge_decision_action,
  p_idempotency_key uuid,
  p_rationale text default null
)
returns public.decisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_passport public.change_passports%rowtype;
  v_decision public.decisions%rowtype;
begin
  select change_passports.* into v_passport
  from public.change_passports
  join public.projects on projects.id = change_passports.project_id
  where change_passports.id = p_passport_id
    and projects.owner_id = (select auth.uid());

  if not found then
    raise exception 'Passport not found or not accessible' using errcode = 'P0002';
  end if;

  if v_passport.verdict::text <> p_action::text then
    raise exception 'Decision must match the current passport verdict' using errcode = '22023';
  end if;

  select * into v_decision
  from public.decisions
  where passport_id = p_passport_id
    and actor_id = (select auth.uid())
    and action = p_action;

  if found then
    return v_decision;
  end if;

  insert into public.decisions (
    project_id,
    passport_id,
    actor_id,
    action,
    rationale,
    idempotency_key
  )
  values (
    v_passport.project_id,
    v_passport.id,
    (select auth.uid()),
    p_action,
    p_rationale,
    p_idempotency_key
  )
  returning * into v_decision;

  insert into public.decision_memory (
    project_id,
    passport_id,
    decision_id,
    summary,
    required_condition,
    created_by
  )
  values (
    v_passport.project_id,
    v_passport.id,
    v_decision.id,
    v_passport.summary,
    v_passport.required_condition,
    (select auth.uid())
  );

  update public.change_passports
  set review_state = 'decided',
      updated_by = (select auth.uid())
  where id = v_passport.id;

  return v_decision;
end;
$$;

revoke all on function public.record_forge_decision(uuid, public.forge_decision_action, uuid, text) from public, anon;
grant execute on function public.record_forge_decision(uuid, public.forge_decision_action, uuid, text) to authenticated;

grant usage on schema public to authenticated;
grant select, insert on public.profiles to authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;
grant select, insert on public.projects to authenticated;
grant select, insert on public.repositories to authenticated;
grant select, insert on public.pull_requests to authenticated;
grant select, insert on public.system_guarantees to authenticated;
grant select, insert on public.change_passports to authenticated;
grant update (repair_staged_at, repair_staged_by, updated_by) on public.change_passports to authenticated;
grant select, insert on public.evidence to authenticated;
grant select on public.decisions to authenticated;
grant select on public.decision_memory to authenticated;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.repositories enable row level security;
alter table public.pull_requests enable row level security;
alter table public.system_guarantees enable row level security;
alter table public.change_passports enable row level security;
alter table public.evidence enable row level security;
alter table public.decisions enable row level security;
alter table public.decision_memory enable row level security;

create policy "Profiles are visible to their owner"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "Profiles can be created by their owner"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

create policy "Profiles can be updated by their owner"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Projects are visible to their owner"
on public.projects for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Projects can be created by their owner"
on public.projects for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
);

create policy "Projects can be updated by their owner"
on public.projects for update to authenticated
using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
);

create policy "Projects can be deleted by their owner"
on public.projects for delete to authenticated
using ((select auth.uid()) = owner_id);

create policy "Repositories follow project ownership"
on public.repositories for select to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = repositories.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Repositories can be created in owned projects"
on public.repositories for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
  and exists (
    select 1 from public.projects
    where projects.id = repositories.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Repositories can be updated in owned projects"
on public.repositories for update to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = repositories.project_id
      and projects.owner_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
  and exists (
    select 1 from public.projects
    where projects.id = repositories.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Repositories can be deleted in owned projects"
on public.repositories for delete to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = repositories.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Pull requests follow repository ownership"
on public.pull_requests for select to authenticated
using (
  exists (
    select 1
    from public.repositories
    join public.projects on projects.id = repositories.project_id
    where repositories.id = pull_requests.repository_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Pull requests can be created in owned repositories"
on public.pull_requests for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
  and exists (
    select 1
    from public.repositories
    join public.projects on projects.id = repositories.project_id
    where repositories.id = pull_requests.repository_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Pull requests can be updated in owned repositories"
on public.pull_requests for update to authenticated
using (
  exists (
    select 1
    from public.repositories
    join public.projects on projects.id = repositories.project_id
    where repositories.id = pull_requests.repository_id
      and projects.owner_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
  and exists (
    select 1
    from public.repositories
    join public.projects on projects.id = repositories.project_id
    where repositories.id = pull_requests.repository_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Pull requests can be deleted in owned repositories"
on public.pull_requests for delete to authenticated
using (
  exists (
    select 1
    from public.repositories
    join public.projects on projects.id = repositories.project_id
    where repositories.id = pull_requests.repository_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Guarantees follow project ownership"
on public.system_guarantees for select to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = system_guarantees.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Guarantees can be created in owned projects"
on public.system_guarantees for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
  and exists (
    select 1 from public.projects
    where projects.id = system_guarantees.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Guarantees can be updated in owned projects"
on public.system_guarantees for update to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = system_guarantees.project_id
      and projects.owner_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
  and exists (
    select 1 from public.projects
    where projects.id = system_guarantees.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Guarantees can be deleted in owned projects"
on public.system_guarantees for delete to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = system_guarantees.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Passports follow project ownership"
on public.change_passports for select to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = change_passports.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Passports can be created in owned projects"
on public.change_passports for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
  and exists (
    select 1 from public.projects
    where projects.id = change_passports.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Passports can be updated in owned projects"
on public.change_passports for update to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = change_passports.project_id
      and projects.owner_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
  and (repair_staged_by is null or repair_staged_by = (select auth.uid()))
  and exists (
    select 1 from public.projects
    where projects.id = change_passports.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Passports can be deleted in owned projects"
on public.change_passports for delete to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = change_passports.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Evidence follows passport ownership"
on public.evidence for select to authenticated
using (
  exists (
    select 1
    from public.change_passports
    join public.projects on projects.id = change_passports.project_id
    where change_passports.id = evidence.passport_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Evidence can be created in owned passports"
on public.evidence for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
  and exists (
    select 1
    from public.change_passports
    join public.projects on projects.id = change_passports.project_id
    where change_passports.id = evidence.passport_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Evidence can be updated in owned passports"
on public.evidence for update to authenticated
using (
  exists (
    select 1
    from public.change_passports
    join public.projects on projects.id = change_passports.project_id
    where change_passports.id = evidence.passport_id
      and projects.owner_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = created_by
  and (select auth.uid()) = updated_by
  and exists (
    select 1
    from public.change_passports
    join public.projects on projects.id = change_passports.project_id
    where change_passports.id = evidence.passport_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Evidence can be deleted in owned passports"
on public.evidence for delete to authenticated
using (
  exists (
    select 1
    from public.change_passports
    join public.projects on projects.id = change_passports.project_id
    where change_passports.id = evidence.passport_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Decisions follow project ownership"
on public.decisions for select to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = decisions.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Decisions can be recorded in owned projects"
on public.decisions for insert to authenticated
with check (
  (select auth.uid()) = actor_id
  and exists (
    select 1
    from public.change_passports
    join public.projects on projects.id = change_passports.project_id
    where change_passports.id = decisions.passport_id
      and change_passports.project_id = decisions.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Decision memory follows project ownership"
on public.decision_memory for select to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = decision_memory.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "Decision memory can be created in owned projects"
on public.decision_memory for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and exists (
    select 1
    from public.change_passports
    join public.projects on projects.id = change_passports.project_id
    join public.decisions on decisions.id = decision_memory.decision_id
    where change_passports.id = decision_memory.passport_id
      and change_passports.project_id = decision_memory.project_id
      and decisions.passport_id = decision_memory.passport_id
      and decisions.project_id = decision_memory.project_id
      and projects.owner_id = (select auth.uid())
  )
);

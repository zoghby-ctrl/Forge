-- Forge Milestone 3: real GitHub OAuth connections and source-backed records.
-- OAuth credentials remain server-only: authenticated browser sessions have no
-- grants or RLS policies for either credential or transient OAuth-state rows.

alter table public.repositories
  add column if not exists owner_login text,
  add column if not exists visibility text not null default 'private'
    check (visibility in ('public', 'private', 'internal')),
  add column if not exists is_private boolean not null default false,
  add column if not exists html_url text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists last_activity_at timestamptz,
  add column if not exists is_selected boolean not null default false,
  add column if not exists selected_at timestamptz;

drop index if exists public.repositories_provider_external_id_unique;
create unique index if not exists repositories_project_provider_external_id_unique
  on public.repositories (project_id, provider, provider_repository_id)
  where provider_repository_id is not null;
create index if not exists repositories_project_selected_idx
  on public.repositories (project_id, is_selected)
  where provider = 'github';
create unique index if not exists repositories_one_selected_github_per_project_unique
  on public.repositories (project_id)
  where provider = 'github' and is_selected;

alter table public.pull_requests
  add column if not exists additions integer not null default 0 check (additions >= 0),
  add column if not exists deletions integer not null default 0 check (deletions >= 0),
  add column if not exists commits_count integer not null default 0 check (commits_count >= 0),
  add column if not exists github_state text not null default 'open' check (github_state in ('open', 'closed')),
  add column if not exists is_draft boolean not null default false,
  add column if not exists source_created_at timestamptz,
  add column if not exists source_closed_at timestamptz,
  add column if not exists source_merged_at timestamptz,
  add column if not exists source_url text,
  add column if not exists source_fetched_at timestamptz;

alter table public.evidence
  add column if not exists provider text not null default 'manual'
    check (provider in ('github', 'manual')),
  add column if not exists provider_object_id text,
  add column if not exists source_url text,
  add column if not exists source_fetched_at timestamptz;

create table if not exists public.github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  github_user_id text not null,
  github_login text not null,
  access_token_ciphertext text not null,
  token_type text not null,
  granted_scopes text[] not null default '{}',
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_validated_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.github_oauth_states (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  state_hash text not null unique,
  code_verifier_ciphertext text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table if not exists public.pull_request_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  repository_id uuid not null references public.repositories (id) on delete cascade,
  pull_request_id uuid not null references public.pull_requests (id) on delete cascade,
  provider_file_sha text not null,
  path text not null,
  previous_path text,
  status text not null,
  additions integer not null default 0 check (additions >= 0),
  deletions integer not null default 0 check (deletions >= 0),
  changes integer not null default 0 check (changes >= 0),
  source_url text,
  source_fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  updated_by uuid not null references auth.users (id) on delete cascade,
  unique (pull_request_id, path),
  foreign key (pull_request_id, repository_id, project_id)
    references public.pull_requests (id, repository_id, project_id)
);

create table if not exists public.pull_request_commits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  repository_id uuid not null references public.repositories (id) on delete cascade,
  pull_request_id uuid not null references public.pull_requests (id) on delete cascade,
  commit_sha text not null,
  subject text not null,
  author_login text,
  author_name text,
  authored_at timestamptz,
  committed_at timestamptz,
  source_url text not null,
  source_fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  updated_by uuid not null references auth.users (id) on delete cascade,
  unique (pull_request_id, commit_sha),
  foreign key (pull_request_id, repository_id, project_id)
    references public.pull_requests (id, repository_id, project_id)
);

create index if not exists github_oauth_states_expiration_idx
  on public.github_oauth_states (expires_at)
  where used_at is null;
create index if not exists pull_request_files_pull_request_idx
  on public.pull_request_files (pull_request_id, path);
create index if not exists pull_request_commits_pull_request_idx
  on public.pull_request_commits (pull_request_id, committed_at desc nulls last);

-- A repository becomes active only after all GitHub source records have been
-- written. This preserves the previous selected source if a later sync fails.
create or replace function public.activate_github_repository(
  p_project_id uuid,
  p_repository_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
set search_path = public
as $$
begin
  -- Serialize switches for one Forge project so concurrent browser tabs cannot
  -- race the one-selected-repository invariant.
  perform pg_advisory_xact_lock(hashtext(p_project_id::text));

  if not exists (
    select 1
    from public.repositories
    where id = p_repository_id
      and project_id = p_project_id
      and provider = 'github'
  ) then
    raise exception 'GitHub repository does not belong to this Forge project';
  end if;

  update public.repositories
  set is_selected = false,
      updated_by = p_user_id
  where project_id = p_project_id
    and provider = 'github'
    and is_selected
    and id <> p_repository_id;

  update public.repositories
  set is_selected = true,
      selected_at = now(),
      updated_by = p_user_id
  where id = p_repository_id
    and project_id = p_project_id
    and provider = 'github';
end;
$$;

create trigger github_connections_set_updated_at
before update on public.github_connections
for each row execute procedure public.set_updated_at();

create trigger pull_request_files_set_updated_at
before update on public.pull_request_files
for each row execute procedure public.set_updated_at();

create trigger pull_request_commits_set_updated_at
before update on public.pull_request_commits
for each row execute procedure public.set_updated_at();

alter table public.github_connections enable row level security;
alter table public.github_oauth_states enable row level security;
alter table public.pull_request_files enable row level security;
alter table public.pull_request_commits enable row level security;

-- Credential and OAuth-state records are accessed only through the narrowly
-- scoped server service-role client after Forge has authenticated the owner.
revoke all on table public.github_connections from public, anon, authenticated;
revoke all on table public.github_oauth_states from public, anon, authenticated;
grant all on table public.github_connections to service_role;
grant all on table public.github_oauth_states to service_role;
grant usage on schema public to service_role;

grant select on table public.pull_request_files to authenticated;
grant select on table public.pull_request_commits to authenticated;
grant all on table public.pull_request_files to service_role;
grant all on table public.pull_request_commits to service_role;
grant all on table public.projects, public.repositories, public.pull_requests,
  public.change_passports, public.evidence to service_role;
revoke all on function public.activate_github_repository(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_github_repository(uuid, uuid, uuid) to service_role;

create policy "GitHub pull request files follow repository ownership"
on public.pull_request_files for select to authenticated
using (
  exists (
    select 1
    from public.repositories
    join public.projects on projects.id = repositories.project_id
    where repositories.id = pull_request_files.repository_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "GitHub pull request commits follow repository ownership"
on public.pull_request_commits for select to authenticated
using (
  exists (
    select 1
    from public.repositories
    join public.projects on projects.id = repositories.project_id
    where repositories.id = pull_request_commits.repository_id
      and projects.owner_id = (select auth.uid())
  )
);

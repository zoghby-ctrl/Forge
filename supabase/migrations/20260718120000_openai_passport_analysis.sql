-- Forge Milestone 4: server-side OpenAI Change Passport analysis.
-- The raw GitHub source remains in the existing PR/file/commit records. The
-- analysis cache stores only the structured Passport result and its inputs'
-- fingerprint; no provider credentials are ever persisted here.

alter table public.pull_requests
  add column if not exists description text;

alter table public.pull_request_files
  add column if not exists patch text;

alter table public.change_passports
  add column if not exists analysis_source_head_sha text,
  add column if not exists analysis_input_hash text,
  add column if not exists analysis_model text,
  add column if not exists analysis_prompt_version text,
  add column if not exists analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'running', 'complete', 'failed')),
  add column if not exists analysis_completed_at timestamptz,
  add column if not exists analysis_error_code text,
  add column if not exists analysis_error_message text,
  add column if not exists analysis_payload jsonb;

create index if not exists change_passports_analysis_cache_idx
  on public.change_passports (pull_request_id, analysis_source_head_sha, analysis_model, analysis_prompt_version)
  where analysis_status = 'complete';

-- An analysis replaces the derived Passport and its evidence in one database
-- transaction. A failed OpenAI call happens before this function is invoked,
-- preserving the last successful Passport for retry and inspection.
create or replace function public.persist_forge_passport_analysis(
  p_passport_id uuid,
  p_user_id uuid,
  p_analysis_source_head_sha text,
  p_analysis_input_hash text,
  p_analysis_model text,
  p_analysis_prompt_version text,
  p_analysis_payload jsonb,
  p_verdict public.forge_verdict,
  p_summary text,
  p_required_condition text,
  p_confidence_label text,
  p_evidence jsonb
)
returns public.change_passports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passport public.change_passports%rowtype;
begin
  select change_passports.* into v_passport
  from public.change_passports
  join public.projects on projects.id = change_passports.project_id
  where change_passports.id = p_passport_id
    and projects.owner_id = p_user_id
  for update;

  if not found then
    raise exception 'Change Passport not found or not accessible' using errcode = 'P0002';
  end if;

  update public.change_passports
  set verdict = p_verdict,
      summary = p_summary,
      required_condition = p_required_condition,
      confidence_label = p_confidence_label,
      review_state = 'ready_for_decision',
      analysis_source_head_sha = p_analysis_source_head_sha,
      analysis_input_hash = p_analysis_input_hash,
      analysis_model = p_analysis_model,
      analysis_prompt_version = p_analysis_prompt_version,
      analysis_status = 'complete',
      analysis_completed_at = now(),
      analysis_error_code = null,
      analysis_error_message = null,
      analysis_payload = p_analysis_payload,
      updated_by = p_user_id
  where id = v_passport.id;

  delete from public.evidence where passport_id = v_passport.id;

  insert into public.evidence (
    project_id,
    passport_id,
    guarantee_id,
    ordinal,
    kind,
    tone,
    label,
    title,
    detail,
    source_label,
    source_path,
    commit_sha,
    line_start,
    line_end,
    excerpt,
    provider,
    provider_object_id,
    source_url,
    source_fetched_at,
    created_by,
    updated_by
  )
  select
    v_passport.project_id,
    v_passport.id,
    null,
    item.ordinal,
    item.kind,
    item.tone,
    item.label,
    item.title,
    item.detail,
    item.source_label,
    item.source_path,
    item.commit_sha,
    item.line_start,
    item.line_end,
    item.excerpt,
    'github',
    item.provider_object_id,
    item.source_url,
    now(),
    p_user_id,
    p_user_id
  from jsonb_to_recordset(p_evidence) as item(
    ordinal smallint,
    kind public.forge_evidence_kind,
    tone public.forge_evidence_tone,
    label text,
    title text,
    detail text,
    source_label text,
    source_path text,
    commit_sha text,
    line_start integer,
    line_end integer,
    excerpt text,
    provider_object_id text,
    source_url text
  )
  order by item.ordinal;

  select * into v_passport from public.change_passports where id = v_passport.id;
  return v_passport;
end;
$$;

revoke all on function public.persist_forge_passport_analysis(
  uuid, uuid, text, text, text, text, jsonb, public.forge_verdict, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_forge_passport_analysis(
  uuid, uuid, text, text, text, text, jsonb, public.forge_verdict, text, text, text, jsonb
) to service_role;

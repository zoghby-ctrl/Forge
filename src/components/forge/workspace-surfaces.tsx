"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GitHubMark } from "@/components/forge/github-mark";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import type {
  ForgePassport,
  ForgePullRequest,
  ForgeRepository,
  ForgeWorkspace,
  WorkspaceStage,
} from "@/domain/forge-workspace";
import type { GitHubRepositorySummary } from "@/integrations/github/repositories";

type StatusTone = "neutral" | "proof" | "success" | "warning";

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 10h12M10.5 5.5 15 10l-4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m12.2 12.2 4.1 4.1" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.5" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.7 7A6 6 0 1 0 16 11M15.7 7V3.5M15.7 7h-3.5" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.5" />
    </svg>
  );
}

function StatusMark({ children, tone = "neutral" }: { children: React.ReactNode; tone?: StatusTone }) {
  return <span className={`workspace-status tone-${tone}`}><i aria-hidden="true" />{children}</span>;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function relativeTime(timestamp: string) {
  const elapsed = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function passportState(passport: ForgePassport | undefined) {
  if (!passport) return { label: "Source pending", tone: "neutral" as const };
  if (passport.analysisStatus === "failed") return { label: "Analysis failed", tone: "warning" as const };
  if (passport.analysisStatus === "running") return { label: "Analyzing", tone: "proof" as const };
  if (passport.analysisStatus === "complete" && passport.decision) return { label: "Decision recorded", tone: "success" as const };
  if (passport.analysisStatus === "complete") return { label: "Decision ready", tone: "proof" as const };
  return { label: "Source ready", tone: "neutral" as const };
}

function WorkspaceAction({
  children,
  onClick,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "quiet";
}) {
  return (
    <button className={`workspace-action is-${variant}`} type="button" onClick={onClick}>
      <span>{children}</span><ArrowIcon />
    </button>
  );
}

export function WorkspaceOverview({
  workspace,
  repository,
  pullRequests,
  onConnect,
  onNavigate,
  onOpenPassport,
}: {
  workspace: ForgeWorkspace;
  repository: ForgeRepository | null;
  pullRequests: ForgePullRequest[];
  onConnect: () => void;
  onNavigate: (stage: WorkspaceStage) => void;
  onOpenPassport: (passport: ForgePassport) => void;
}) {
  const connected = workspace.github.status === "connected";
  const repositoryPassports = useMemo(
    () => workspace.passports.filter((passport) => passport.repositoryId === repository?.id),
    [repository?.id, workspace.passports],
  );
  const passportByPullRequest = useMemo(
    () => new Map(repositoryPassports.map((passport) => [passport.pullRequestId, passport])),
    [repositoryPassports],
  );
  const attentionCount = pullRequests.filter((pullRequest) => {
    const passport = passportByPullRequest.get(pullRequest.id);
    return pullRequest.status === "needs_decision" || passport?.analysisStatus === "failed";
  }).length;
  const nextPassport = repositoryPassports.find((passport) => passport.analysisStatus === "failed")
    ?? repositoryPassports.find((passport) => passport.analysisStatus === "complete" && !passport.decision)
    ?? pullRequests
      .filter((pullRequest) => pullRequest.status === "needs_decision")
      .map((pullRequest) => passportByPullRequest.get(pullRequest.id))
      .find((passport): passport is ForgePassport => Boolean(passport && !passport.decision))
    ?? repositoryPassports.find((passport) => !passport.decision)
    ?? null;
  const nextPullRequest = nextPassport
    ? pullRequests.find((pullRequest) => pullRequest.id === nextPassport.pullRequestId) ?? null
    : null;

  const heading = !connected
    ? "Connect a source of truth."
    : !repository
      ? "Choose your working repository."
      : "Keep the next decision moving.";
  const introduction = !connected
    ? "Forge needs read-only GitHub access before it can create an inspectable source record."
    : !repository
      ? "Your GitHub connection is ready. Select the repository that should anchor this decision workspace."
      : `Forge is oriented around ${repository.fullName} and its captured pull request records.`;

  const nextTitle = !connected
    ? "Connect GitHub"
    : !repository
      ? "Select an active repository"
      : nextPassport && nextPullRequest
        ? nextPassport.analysisStatus === "failed"
          ? `Retry PR #${nextPullRequest.number}`
          : nextPassport.analysisStatus === "complete"
            ? `Decide PR #${nextPullRequest.number}`
            : `Analyze PR #${nextPullRequest.number}`
        : pullRequests.length > 0
          ? "Review captured pull requests"
          : "Choose a repository with an open change";
  const nextCopy = !connected
    ? "Authorize read-only access. Tokens remain server-side and Forge sends no write requests."
    : !repository
      ? "Repository selection establishes the active source record for this workspace."
      : nextPassport?.analysisStatus === "failed"
        ? nextPassport.analysisError ?? "The last analysis did not complete. The captured source record is still available."
        : nextPassport?.analysisStatus === "complete"
          ? "The source-backed analysis is complete and waiting for a human decision."
          : nextPassport && nextPullRequest
            ? "The pull request source record is ready for on-demand analysis."
            : pullRequests.length > 0
              ? "Open the repository queue to inspect its current source records."
              : "No recent pull requests were returned for the active repository.";

  const runNextAction = () => {
    if (!connected) {
      onConnect();
      return;
    }
    if (!repository || pullRequests.length === 0) {
      onNavigate("repositories");
      return;
    }
    if (nextPassport) {
      onOpenPassport(nextPassport);
      return;
    }
    onNavigate("pull-requests");
  };

  const workflow = [
    {
      label: "Connection",
      detail: connected ? `GitHub · ${workspace.github.login ?? "connected"}` : "GitHub access required",
      state: connected ? "complete" : "current",
      action: connected ? null : onConnect,
    },
    {
      label: "Repository",
      detail: repository?.fullName ?? (connected ? "Choose a source" : "Waiting for connection"),
      state: repository ? "complete" : connected ? "current" : "waiting",
      action: connected ? () => onNavigate("repositories") : null,
    },
    {
      label: "Source record",
      detail: repository ? `${pluralize(pullRequests.length, "pull request")} captured` : "Waiting for a repository",
      state: repository ? "complete" : "waiting",
      action: repository ? () => onNavigate("scanning") : null,
    },
    {
      label: "Pull requests",
      detail: repository ? (pullRequests.length > 0 ? `${pullRequests.length} available` : "No recent changes") : "Waiting for source",
      state: pullRequests.length > 0 ? "available" : "waiting",
      action: pullRequests.length > 0 ? () => onNavigate("pull-requests") : null,
    },
    {
      label: "Decision",
      detail: repositoryPassports.some((passport) => passport.decision)
        ? `${repositoryPassports.filter((passport) => passport.decision).length} recorded`
        : repositoryPassports.length > 0
          ? "Ready on demand"
          : "Waiting for a change",
      state: repositoryPassports.some((passport) => passport.decision)
        ? "complete"
        : repositoryPassports.length > 0
          ? "available"
          : "waiting",
      action: nextPassport ? () => onOpenPassport(nextPassport) : null,
    },
  ];

  return (
    <section className="overview-stage workspace-stage stage-view" aria-labelledby="overview-title">
      <header className="workspace-page-heading">
        <div>
          <p className="eyebrow">{workspace.project.name} / decision ledger</p>
          <h1 id="overview-title">{heading}</h1>
        </div>
        <p>{introduction}</p>
      </header>

      <div className="overview-ledger">
        <article className="repository-context-card glow-surface">
          <GlowingEffect disabled={false} glow />
          <header>
            <p>Active repository</p>
            <StatusMark tone={repository ? "success" : connected ? "proof" : "warning"}>
              {repository ? "Current" : connected ? "Connected" : "Not connected"}
            </StatusMark>
          </header>
          {repository ? (
            <>
              <div className="repository-context-title"><GitHubMark /><div><h2>{repository.fullName}</h2><p>{repository.description ?? "No repository description provided."}</p></div></div>
              <dl className="repository-context-facts">
                <div><dt>Branch</dt><dd>{repository.branch}</dd></div>
                <div><dt>Visibility</dt><dd>{repository.visibility}</dd></div>
                <div><dt>Language</dt><dd>{repository.language ?? "Not reported"}</dd></div>
                <div><dt>Last activity</dt><dd>{repository.lastActivityLabel}</dd></div>
              </dl>
              <div className="repository-context-actions">
                <WorkspaceAction variant="quiet" onClick={() => onNavigate("scanning")}>Open source record</WorkspaceAction>
                <WorkspaceAction variant="quiet" onClick={() => onNavigate("repositories")}>Switch repository</WorkspaceAction>
              </div>
            </>
          ) : (
            <div className="repository-context-empty">
              <GitHubMark />
              <h2>{connected ? `Connected as ${workspace.github.login ?? "GitHub user"}` : "GitHub is not connected"}</h2>
              <p>{connected ? "Select a repository to create the active workspace context." : "Authorize a read-only connection to begin."}</p>
            </div>
          )}
        </article>

        <aside className="next-decision-card glow-surface" aria-labelledby="next-decision-title">
          <div><p>Next action</p><StatusMark tone={attentionCount > 0 || !connected ? "warning" : "proof"}>{attentionCount > 0 ? `${attentionCount} need attention` : !connected ? "Connection required" : !repository ? "Repository required" : "Workspace current"}</StatusMark></div>
          <GlowingEffect disabled={false} glow spread={18} />
          <span className="next-decision-index" aria-hidden="true">→</span>
          <h2 id="next-decision-title">{nextTitle}</h2>
          <p>{nextCopy}</p>
          <WorkspaceAction onClick={runNextAction}>{nextTitle}</WorkspaceAction>
        </aside>
      </div>

      <dl className="workspace-facts" aria-label="Workspace status">
        <div><dt>Source record</dt><dd>{repository ? "Captured" : "Not started"}</dd></div>
        <div><dt>PRs ready</dt><dd>{repositoryPassports.length}</dd></div>
        <div><dt>Needs attention</dt><dd>{attentionCount}</dd></div>
      </dl>

      <section className="workflow-section" aria-labelledby="workflow-title">
        <header><div><p>Workflow</p><h2 id="workflow-title">From source to decision</h2></div><span>Only recorded state is shown</span></header>
        <ol className="workflow-rail">
          {workflow.map((item, index) => (
            <li key={item.label} data-state={item.state}>
              {item.action ? (
                <button type="button" onClick={item.action}>
                  <span className="workflow-index">{String(index + 1).padStart(2, "0")}</span>
                  <span><b>{item.label}</b><small>{item.detail}</small></span>
                </button>
              ) : (
                <div>
                  <span className="workflow-index">{String(index + 1).padStart(2, "0")}</span>
                  <span><b>{item.label}</b><small>{item.detail}</small></span>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      {repository && (
        <section className="overview-source-records" aria-labelledby="source-records-title">
          <header>
            <div><p>Current queue</p><h2 id="source-records-title">Pull request source records</h2></div>
            {pullRequests.length > 0 && <button type="button" onClick={() => onNavigate("pull-requests")}>View all <ArrowIcon /></button>}
          </header>
          {pullRequests.length === 0 ? (
            <div className="workspace-empty-state is-inline"><p>No recent pull requests were returned by GitHub for {repository.fullName}.</p><button type="button" onClick={() => onNavigate("repositories")}>Choose another repository</button></div>
          ) : (
            <div className="overview-pr-list">
              {pullRequests.slice(0, 3).map((pullRequest) => {
                const passport = passportByPullRequest.get(pullRequest.id);
                const state = passportState(passport);
                return (
                  <button key={pullRequest.id} type="button" disabled={!passport} onClick={passport ? () => onOpenPassport(passport) : undefined}>
                    <span>#{pullRequest.number}</span>
                    <div><b>{pullRequest.title}</b><small>{pullRequest.author} · {pullRequest.updatedLabel}</small></div>
                    <StatusMark tone={state.tone}>{state.label}</StatusMark>
                    <ArrowIcon />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}
    </section>
  );
}

export function RepositoryPicker({
  repositories,
  currentRepository,
  githubLogin,
  loading,
  error,
  onRetry,
  onSelect,
  onDisconnect,
}: {
  repositories: GitHubRepositorySummary[];
  currentRepository: ForgeRepository | null;
  githubLogin: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (repository: GitHubRepositorySummary) => Promise<void>;
  onDisconnect: () => void;
}) {
  const [query, setQuery] = useState("");
  const [pendingRepository, setPendingRepository] = useState<GitHubRepositorySummary | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  const filteredRepositories = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return repositories;
    return repositories.filter((repository) => [
      repository.fullName,
      repository.description,
      repository.language,
      repository.defaultBranch,
    ].some((value) => value?.toLowerCase().includes(normalized)));
  }, [query, repositories]);

  useEffect(() => {
    if (!pendingRepository) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPendingRepository(null);
        return;
      }
      if (event.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? []);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => confirmButtonRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [pendingRepository]);

  const chooseRepository = (repository: GitHubRepositorySummary) => {
    const isCurrent = repository.fullName === currentRepository?.fullName;
    if (currentRepository && !isCurrent) {
      setPendingRepository(repository);
      return;
    }
    void onSelect(repository);
  };

  return (
    <div className="repository-picker-surface">
      <div className="repository-picker-context">
        <div><GitHubMark /><span><b>GitHub connected</b><small>{githubLogin ?? "Authenticated account"} · read-only requests</small></span></div>
        {currentRepository && <StatusMark tone="success">{currentRepository.fullName} is active</StatusMark>}
      </div>

      {!loading && !error && repositories.length > 0 && (
        <div className="repository-toolbar">
          <label htmlFor="repository-search"><SearchIcon /><span className="sr-only">Filter repositories</span><input id="repository-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by repository, language, or branch" autoComplete="off" /></label>
          <p aria-live="polite">{filteredRepositories.length === repositories.length ? pluralize(repositories.length, "repository", "repositories") : `${filteredRepositories.length} of ${repositories.length} repositories`}</p>
        </div>
      )}

      {loading && (
        <div className="repository-loading" role="status">
          <span className="sr-only">Reading repositories from GitHub</span>
          {[0, 1, 2, 3].map((item) => <div key={item} aria-hidden="true"><i /><span><b /><small /></span><em /></div>)}
        </div>
      )}

      {!loading && error && (
        <div className="workspace-empty-state" role="alert">
          <span>Repository access interrupted</span><h2>Forge could not read this GitHub account.</h2><p>{error}</p>
          <div><button type="button" onClick={onRetry}>Try again</button><button type="button" onClick={onDisconnect}>Disconnect GitHub</button></div>
        </div>
      )}

      {!loading && !error && repositories.length === 0 && (
        <div className="workspace-empty-state">
          <span>No repositories available</span><h2>There is no source to select yet.</h2><p>Check organization access in GitHub, then reconnect if permissions changed.</p>
          <button type="button" onClick={onDisconnect}>Disconnect GitHub</button>
        </div>
      )}

      {!loading && !error && repositories.length > 0 && filteredRepositories.length === 0 && (
        <div className="workspace-empty-state is-compact">
          <span>No matches</span><h2>No repository matches “{query}”.</h2><p>Try a repository name, owner, language, or default branch.</p>
          <button type="button" onClick={() => setQuery("")}>Clear filter</button>
        </div>
      )}

      {!loading && !error && filteredRepositories.length > 0 && (
        <div className="repository-card-list" aria-label="Available repositories">
          {filteredRepositories.map((repository) => {
            const isCurrent = repository.fullName === currentRepository?.fullName;
            return (
              <button className={`repository-card${isCurrent ? " is-current glow-surface" : ""}`} key={repository.id} type="button" aria-current={isCurrent ? "true" : undefined} onClick={() => chooseRepository(repository)}>
                {isCurrent && <GlowingEffect disabled={false} glow spread={16} />}
                <span className="repository-card-icon"><GitHubMark /></span>
                <span className="repository-card-copy"><span><b>{repository.name}</b>{isCurrent && <StatusMark tone="success">Current</StatusMark>}</span><small>{repository.owner} / {repository.name}</small><em>{repository.description ?? "No repository description provided."}</em></span>
                <span className="repository-card-facts"><span><small>Branch</small><b>{repository.defaultBranch}</b></span><span><small>Visibility</small><b>{repository.visibility}</b></span><span><small>Language</small><b>{repository.language ?? "Not reported"}</b></span><span><small>Activity</small><b>{relativeTime(repository.lastActivityAt)}</b></span></span>
                <span className="repository-card-action">{isCurrent ? <><RefreshIcon />Refresh source</> : <>Use repository<ArrowIcon /></>}</span>
              </button>
            );
          })}
        </div>
      )}

      {pendingRepository && (
        <div className="workspace-dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingRepository(null); }}>
          <section ref={dialogRef} className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="switch-repository-title" aria-describedby="switch-repository-copy">
            <button className="workspace-dialog-close" type="button" aria-label="Cancel repository switch" onClick={() => setPendingRepository(null)}><CloseIcon /></button>
            <p>Change active source</p>
            <h2 id="switch-repository-title">Switch to {pendingRepository.fullName}?</h2>
            <p id="switch-repository-copy">Forge will replace the current workspace context and read this repository from GitHub. Existing decision records remain stored.</p>
            <dl><div><dt>Current</dt><dd>{currentRepository?.fullName}</dd></div><div><dt>Next</dt><dd>{pendingRepository.fullName}</dd></div></dl>
            <div className="workspace-dialog-actions">
              <button type="button" onClick={() => setPendingRepository(null)}>Keep current</button>
              <button ref={confirmButtonRef} type="button" onClick={() => { const repository = pendingRepository; setPendingRepository(null); void onSelect(repository); }}>Switch repository</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export function PullRequestWorkspace({
  workspace,
  repository,
  pullRequests,
  onOpenPassport,
  onOpenRepositories,
}: {
  workspace: ForgeWorkspace;
  repository: ForgeRepository | null;
  pullRequests: ForgePullRequest[];
  onOpenPassport: (passport: ForgePassport) => void;
  onOpenRepositories: () => void;
}) {
  const repositoryPassports = workspace.passports.filter((passport) => passport.repositoryId === repository?.id);
  const passportByPullRequest = new Map(repositoryPassports.map((passport) => [passport.pullRequestId, passport]));

  return (
    <section className="pull-requests-stage workspace-stage stage-view" aria-labelledby="pull-requests-title">
      <header className="workspace-page-heading is-compact">
        <div><p className="eyebrow">Workspace / pull request records</p><h1 id="pull-requests-title">Review the change, not the noise.</h1></div>
        <p>{repository ? `Forge captured ${pluralize(pullRequests.length, "pull request")} for ${repository.fullName}. Analysis begins only when you open a Change Passport.` : "Choose a repository to load its pull request records."}</p>
      </header>

      {repository && (
        <div className="workspace-context-bar">
          <div><GitHubMark /><span><b>{repository.fullName}</b><small>{workspace.project.name}</small></span></div>
          <dl><div><dt>Branch</dt><dd>{repository.branch}</dd></div><div><dt>Visibility</dt><dd>{repository.visibility}</dd></div><div><dt>Source records</dt><dd>{repositoryPassports.length}</dd></div></dl>
          <button type="button" onClick={onOpenRepositories}>Switch repository</button>
        </div>
      )}

      {!repository || pullRequests.length === 0 ? (
        <div className="workspace-empty-state">
          <span>{repository ? "No recent pull requests" : "No active repository"}</span>
          <h2>{repository ? "This source record has no current changes." : "Choose a source before reviewing changes."}</h2>
          <p>{repository ? `GitHub returned no recent pull requests for ${repository.fullName}.` : "Repository selection establishes the workspace context."}</p>
          <button type="button" onClick={onOpenRepositories}>{repository ? "Choose another repository" : "Choose repository"}</button>
        </div>
      ) : (
        <div className="workspace-pr-list" aria-label="Pull request source records">
          {pullRequests.map((pullRequest) => {
            const passport = passportByPullRequest.get(pullRequest.id);
            const state = passportState(passport);
            const actionLabel = !passport
              ? "Source pending"
              : passport.analysisStatus === "failed"
                ? "Retry analysis"
                : passport.analysisStatus === "complete"
                  ? "Open Passport"
                  : "Analyze change";
            return (
              <article className="workspace-pr-row" key={pullRequest.id}>
                <span className="workspace-pr-number">#{pullRequest.number}</span>
                <div className="workspace-pr-copy">
                  <div><h2>{pullRequest.title}</h2><StatusMark tone={state.tone}>{state.label}</StatusMark></div>
                  <p>{pullRequest.author} · {pullRequest.branch} · updated {pullRequest.updatedLabel}</p>
                </div>
                <dl className="workspace-pr-facts">
                  <div><dt>Files</dt><dd>{pullRequest.filesChanged}</dd></div>
                  <div><dt>Diff</dt><dd><span>+{pullRequest.additions}</span> / -{pullRequest.deletions}</dd></div>
                  <div><dt>Commits</dt><dd>{pullRequest.commitsCount}</dd></div>
                </dl>
                <div className="workspace-pr-actions">
                  <span>{pullRequest.statusLabel}</span>
                  {pullRequest.htmlUrl && <a href={pullRequest.htmlUrl} target="_blank" rel="noreferrer">GitHub ↗</a>}
                  <button type="button" disabled={!passport} onClick={passport ? () => onOpenPassport(passport) : undefined}>{actionLabel}<ArrowIcon /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

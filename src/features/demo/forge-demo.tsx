"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { ChangePassportCard } from "@/components/passport/change-passport";
import type {
  ForgeEvidence,
  ForgePassport,
  ForgePullRequest,
  ForgeWorkspace,
  WorkspaceStage,
} from "@/domain/forge-workspace";
import type { GitHubRepositorySummary } from "@/integrations/github/repositories";
import {
  analyzePassport,
  disconnectGitHub,
  fetchGitHubRepositories,
  persistPassportDecision,
  persistRepairPath,
  selectGitHubRepository,
} from "@/features/workspace/client";

const scanStepCount = 4;

const stageLabels: Record<WorkspaceStage, string> = {
  landing: "Forge is ready to connect a repository.",
  oauth: "Establishing repository access.",
  repositories: "Choose a repository to inspect.",
  scanning: "Reading repository history.",
  guarantees: "Repository guarantees are ready for review.",
  "pull-requests": "Recent pull requests are ready to inspect.",
  passport: "Change Passport is open.",
};

const currentProgress: Record<WorkspaceStage, number> = {
  landing: 0.07,
  oauth: 0.18,
  repositories: 0.31,
  scanning: 0.58,
  guarantees: 0.72,
  "pull-requests": 0.84,
  passport: 1,
};

const githubNotices: Record<string, string> = {
  connected: "GitHub is connected. Choose a repository to read.",
  configuration_required: "GitHub connection is not configured for this Forge environment.",
  connection_failed: "Forge could not establish GitHub access. Try again.",
  authorization_cancelled: "GitHub authorization was cancelled.",
  authorization_failed: "GitHub authorization could not be verified. Connect GitHub again.",
  authorization_expired: "GitHub authorization expired before it could be completed. Connect GitHub again.",
};

function ForgeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3h18v5H8v5h9v8H3v-5h9v-5H3V3Z" fill="currentColor" />
    </svg>
  );
}

function GitHubGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 .2a7.8 7.8 0 0 0-2.47 15.2c.39.08.53-.17.53-.37v-1.5c-2.17.47-2.63-.92-2.63-.92-.36-.9-.87-1.14-.87-1.14-.71-.48.05-.47.05-.47.79.05 1.2.81 1.2.81.7 1.2 1.84.86 2.29.66.07-.5.28-.86.5-1.06-1.73-.2-3.55-.87-3.55-3.85 0-.85.31-1.55.8-2.09-.08-.2-.35-1 .08-2.07 0 0 .65-.21 2.14.8A7.4 7.4 0 0 1 8 2.76c.66 0 1.33.09 1.95.27 1.48-1 2.13-.8 2.13-.8.43 1.07.16 1.87.08 2.07.5.54.8 1.24.8 2.09 0 2.99-1.82 3.65-3.56 3.85.28.24.53.69.53 1.39v2.07c0 .2.14.45.54.37A7.8 7.8 0 0 0 8 .2Z"
      />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 10h12M10.5 5.5 15 10l-4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.5" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3 8.3 3 3L13 4.7" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.55" />
    </svg>
  );
}

function relativeTime(timestamp: string) {
  const elapsed = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function EvidenceCurrent({
  stage,
  pullRequest,
  evidence,
  verdict,
}: {
  stage: WorkspaceStage;
  pullRequest: ForgePullRequest | null;
  evidence: ForgeEvidence[];
  verdict: ForgePassport["verdict"] | null;
}) {
  const progress = currentProgress[stage];
  const pathStyle = { strokeDashoffset: String(1 - progress) };
  const diffEvidence = evidence.find((entry) => entry.label === "Diff metadata");
  const commitEvidence = evidence.find((entry) => entry.label === "Commit metadata");

  return (
    <div
      className={"evidence-current current-stage-" + stage}
      aria-label="Evidence Current: pull request, metadata, files, diff, commits, and decision"
    >
      <svg className="current-lines" viewBox="0 0 1000 272" preserveAspectRatio="none" aria-hidden="true">
        <path className="current-ghost" d="M25 144 H185 C248 144 252 82 327 82 H492 C558 82 558 204 630 204 H975" />
        <path className="current-main" pathLength="1" style={pathStyle} d="M25 144 H185 C248 144 252 82 327 82 H492 C558 82 558 204 630 204 H775" />
        <path className="current-repair" pathLength="1" d="M630 204 C710 204 711 116 790 116 H975" />
      </svg>
      <div className="current-label current-source"><span>Source</span><b>{pullRequest ? `PR #${pullRequest.number}` : "GitHub"}</b></div>
      <div className="current-label current-guarantee"><span>Metadata</span><b>{pullRequest ? `${pullRequest.filesChanged} files` : "pending"}</b></div>
      <div className="current-label current-path"><span>Files</span><b>{diffEvidence?.sourcePath ?? "pending"}</b></div>
      <div className="current-label current-contradiction"><span>Diff</span><b>{pullRequest ? `+${pullRequest.additions} / -${pullRequest.deletions}` : "pending"}</b></div>
      <div className="current-label current-repair-label"><span>Commits</span><b>{commitEvidence?.commitSha?.slice(0, 8) ?? (pullRequest ? String(pullRequest.commitsCount) : "pending")}</b></div>
      <div className="current-label current-decision"><span>Decision</span><b>{verdict?.replaceAll("_", " ") ?? "source record"}</b></div>
    </div>
  );
}

function StageIntro({
  eyebrow,
  title,
  copy,
  step,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  step: string;
}) {
  return (
    <header className="stage-intro">
      <div className="stage-intro-meta">
        <p>{eyebrow}</p>
        <span>{step}</span>
      </div>
      <h1>{title}</h1>
      <p>{copy}</p>
    </header>
  );
}

export function ForgeDemo({
  workspace: initialForgeWorkspace,
  initialStage = "landing",
  initialGitHubNotice,
}: {
  workspace?: ForgeWorkspace;
  initialStage?: WorkspaceStage;
  initialGitHubNotice?: string;
}) {
  const [workspace, setWorkspace] = useState(initialForgeWorkspace);
  const [stage, setStage] = useState<WorkspaceStage>(
    initialForgeWorkspace?.github.status === "connected" ? initialStage : "landing",
  );
  const [availableRepositories, setAvailableRepositories] = useState<GitHubRepositorySummary[]>([]);
  const [repositoriesLoading, setRepositoriesLoading] = useState(false);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [repositoryLoadKey, setRepositoryLoadKey] = useState(0);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(
    initialForgeWorkspace?.repositories[0]?.id ?? null,
  );
  const [selectedPassportId, setSelectedPassportId] = useState<string | null>(
    initialForgeWorkspace?.passports[0]?.id ?? null,
  );
  const [selectedRemoteRepository, setSelectedRemoteRepository] = useState<GitHubRepositorySummary | null>(null);
  const [syncingRepository, setSyncingRepository] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [repairOverride, setRepairOverride] = useState<{ passportId: string; value: boolean } | null>(null);
  const [recording, setRecording] = useState(false);
  const [analyzingPassportId, setAnalyzingPassportId] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(
    initialGitHubNotice ? githubNotices[initialGitHubNotice] ?? "GitHub connection needs attention." : null,
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const recordingTimerRef = useRef<number | null>(null);
  const evidenceControls = useRef<Record<string, HTMLButtonElement | null>>({});

  const isConnected = workspace?.github.status === "connected";
  const repositories = workspace?.repositories ?? [];
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepositoryId)
    ?? repositories[0]
    ?? null;
  const pullRequests = (workspace?.pullRequests ?? []).filter(
    (pullRequest) => pullRequest.repositoryId === selectedRepository?.id,
  );
  const selectedPassport = (workspace?.passports ?? []).find(
    (passport) => passport.id === selectedPassportId,
  ) ?? (workspace?.passports ?? []).find(
    (passport) => passport.repositoryId === selectedRepository?.id,
  ) ?? null;
  const selectedPassportPullRequest = selectedPassport
    ? pullRequests.find((pullRequest) => pullRequest.id === selectedPassport.pullRequestId) ?? null
    : null;
  const evidenceEntries = useMemo(() => selectedPassport?.evidence ?? [], [selectedPassport]);
  const activeEvidence = evidenceEntries.find((entry) => entry.id === activeEvidenceId) ?? evidenceEntries[0] ?? null;
  const recorded = Boolean(selectedPassport?.decision);
  const repairStaged = repairOverride && repairOverride.passportId === selectedPassport?.id
    ? repairOverride.value
    : Boolean(selectedPassport?.repairStaged);

  useEffect(() => {
    if (stage !== "repositories" || !isConnected) {
      return;
    }

    let cancelled = false;
    const loadRepositories = async () => {
      setRepositoriesLoading(true);
      setRepositoryError(null);
      try {
        const { repositories: nextRepositories } = await fetchGitHubRepositories();
        if (!cancelled) {
          setAvailableRepositories(nextRepositories);
        }
      } catch (error) {
        if (!cancelled) {
          setRepositoryError(error instanceof Error ? error.message : "Forge could not load GitHub repositories.");
        }
      } finally {
        if (!cancelled) {
          setRepositoriesLoading(false);
        }
      }
    };
    void loadRepositories();

    return () => {
      cancelled = true;
    };
  }, [isConnected, repositoryLoadKey, stage]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [stage]);

  useEffect(() => () => {
    if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
  }, []);

  const changedFiles = pullRequests.reduce((count, pullRequest) => count + pullRequest.filesChanged, 0);
  const commits = pullRequests.reduce((count, pullRequest) => count + pullRequest.commitsCount, 0);
  const scanSteps = [
      {
        title: "Reading repository history",
        detail: syncingRepository
          ? "Fetching recent pull requests from GitHub."
          : `${pullRequests.length} recent pull requests captured from GitHub.`,
        result: `${pullRequests.length} pull requests`,
      },
      {
        title: "Capturing changed-file metadata",
        detail: syncingRepository
          ? "Waiting for GitHub file metadata."
          : `${changedFiles} changed files recorded without copying source code.`,
        result: `${changedFiles} files`,
      },
      {
        title: "Capturing commit metadata",
        detail: syncingRepository
          ? "Waiting for GitHub commit metadata."
          : `${commits} commits retained as traceable source records.`,
        result: `${commits} commits`,
      },
      {
        title: "Mapping changes to guarantees",
        detail: "Forge is ready to analyze a selected pull request against its source evidence.",
        result: "Ready to analyze",
      },
  ];

  const currentIndex = Math.max(0, evidenceEntries.findIndex((entry) => entry.id === activeEvidence?.id));

  const topbarContext = stage === "landing"
    ? "Decision memory for software changes"
    : stage === "oauth"
      ? "Establishing repository access"
      : stage === "repositories"
        ? "GitHub connected / choose a repository"
        : selectedRepository
          ? `${selectedRepository.fullName} · ${selectedRepository.branch}`
          : selectedRemoteRepository
            ? `${selectedRemoteRepository.fullName} · ${selectedRemoteRepository.defaultBranch}`
            : "Forge workspace";

  const updatePassport = useCallback((passportId: string, update: Partial<ForgePassport>) => {
    setWorkspace((currentWorkspace) => currentWorkspace
      ? {
        ...currentWorkspace,
        passports: currentWorkspace.passports.map((passport) => (
          passport.id === passportId ? { ...passport, ...update } : passport
        )),
      }
      : currentWorkspace);
  }, []);

  const resetJourney = useCallback(() => {
    if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
    recordingTimerRef.current = null;
    setStage("landing");
    setScanProgress(0);
    setActiveEvidenceId(null);
    setRecording(false);
    setAnalyzingPassportId(null);
    setAnalysisProgress(null);
    setAnalysisError(null);
    setPersistenceError(null);
  }, []);

  const moveEvidence = useCallback((direction: -1 | 1, moveFocus: boolean) => {
    const next = evidenceEntries[Math.max(0, Math.min(evidenceEntries.length - 1, currentIndex + direction))];
    if (!next) return;
    setActiveEvidenceId(next.id);
    if (moveFocus) {
      window.requestAnimationFrame(() => evidenceControls.current[next.id]?.focus());
    }
  }, [currentIndex, evidenceEntries]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (!target?.closest("input, textarea, select, [contenteditable=true]")) {
          event.preventDefault();
          resetJourney();
        }
      }

      if (stage !== "passport") return;
      const target = event.target as HTMLElement | null;
      const evidenceControl = target?.closest("[data-evidence-control]");
      if (target?.closest("button, a, input, textarea, select, [contenteditable=true]") && !evidenceControl) return;

      if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        moveEvidence(1, Boolean(evidenceControl));
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        moveEvidence(-1, Boolean(evidenceControl));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveEvidence, resetJourney, stage]);

  const beginAuthentication = useCallback(() => {
    setPersistenceError(null);
    if (!workspace) {
      window.location.assign("/sign-in?next=%2Fapi%2Fgithub%2Fconnect");
      return;
    }

    setStage("oauth");
    window.location.assign("/api/github/connect");
  }, [workspace]);

  const selectRepository = useCallback(async (repository: GitHubRepositorySummary) => {
    setSelectedRemoteRepository(repository);
    setStage("scanning");
    setScanProgress(0);
    setSyncingRepository(true);
    setRepositoryError(null);
    setPersistenceError(null);

    try {
      const selected = await selectGitHubRepository(repository.id);
      setWorkspace(selected.workspace);
      setSelectedRepositoryId(selected.repositoryId);
      setSelectedPassportId(selected.workspace.passports.find((passport) => passport.repositoryId === selected.repositoryId)?.id ?? null);
      setScanProgress(scanStepCount);
    } catch (error) {
      setRepositoryError(error instanceof Error ? error.message : "Forge could not read this repository.");
    } finally {
      setSyncingRepository(false);
    }
  }, []);

  const openPassport = useCallback(async (passport: ForgePassport) => {
    setSelectedRepositoryId(passport.repositoryId);
    setSelectedPassportId(passport.id);
    setStage("passport");
    setActiveEvidenceId(passport.evidence[0]?.id ?? null);
    setAnalysisError(null);
    setAnalysisProgress("Reading pull request...");
    setAnalyzingPassportId(passport.id);

    try {
      const completed = await analyzePassport(passport.id, (progress) => {
        setAnalysisProgress(progress.message);
      });
      updatePassport(completed.passport.id, completed.passport);
      setActiveEvidenceId(completed.passport.evidence[0]?.id ?? null);
      setAnalysisProgress(completed.cached ? "Decision complete. Reused the current analysis." : "Decision complete.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Forge could not complete this AI analysis.";
      setAnalysisError(message);
      updatePassport(passport.id, { analysisStatus: "failed", analysisError: message });
      setAnalysisProgress(null);
    } finally {
      setAnalyzingPassportId((current) => current === passport.id ? null : current);
    }
  }, [updatePassport]);

  const stageRepair = useCallback(async () => {
    if (!selectedPassport) return;

    const nextValue = !repairStaged;
    setRepairOverride({ passportId: selectedPassport.id, value: nextValue });
    setPersistenceError(null);

    try {
      const persisted = await persistRepairPath(selectedPassport.id, { repairStaged: nextValue });
      updatePassport(persisted.passportId, { repairStaged: persisted.repairStaged });
      setRepairOverride(null);
    } catch (error) {
      setRepairOverride(null);
      setPersistenceError(error instanceof Error ? error.message : "Forge could not stage this follow-up.");
    }
  }, [repairStaged, selectedPassport, updatePassport]);

  const recordDecision = useCallback(async () => {
    if (!selectedPassport || selectedPassport.analysisStatus !== "complete" || recorded || recording) return;

    setRecording(true);
    setPersistenceError(null);

    try {
      const persisted = await persistPassportDecision(selectedPassport.id, {
        action: selectedPassport.verdict,
        idempotencyKey: crypto.randomUUID(),
      });
      if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = window.setTimeout(() => {
        updatePassport(persisted.passportId, { decision: persisted.decision, reviewState: "decided" });
        setRecording(false);
        recordingTimerRef.current = null;
      }, 240);
    } catch (error) {
      setRecording(false);
      setPersistenceError(error instanceof Error ? error.message : "Forge could not record that decision.");
    }
  }, [recorded, recording, selectedPassport, updatePassport]);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    setPersistenceError(null);
    try {
      await disconnectGitHub();
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
          ...currentWorkspace,
          github: { status: "disconnected", login: null },
          repositories: [],
          pullRequests: [],
          guarantees: [],
          passports: [],
        }
        : currentWorkspace);
      setAvailableRepositories([]);
      setSelectedRepositoryId(null);
      setSelectedRemoteRepository(null);
      setStage("landing");
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : "Forge could not disconnect GitHub.");
    } finally {
      setDisconnecting(false);
    }
  }, []);

  return (
    <main className={"forge-shell stage-" + stage + (recorded ? " is-recorded" : "")} id="forge">
      <a className="skip-link" href="#main-content">Skip to current Forge view</a>
      <p className="sr-only" aria-live="polite">{stageLabels[stage]}</p>

      <header className="forge-topbar">
        <button className="forge-brand" type="button" onClick={resetJourney} aria-label="Restart Forge journey">
          <ForgeGlyph />
          <span>Forge</span>
        </button>
        <div className="topbar-center" aria-hidden="true">
          <span className="topbar-current" />
          <span>{topbarContext}</span>
        </div>
        <div className="topbar-actions">
          {isConnected && <span className="connection-pill"><i />GitHub · {workspace?.github.login ?? "connected"}</span>}
          {isConnected && <button type="button" className="replay-button" onClick={disconnect} disabled={disconnecting}>{disconnecting ? "Disconnecting" : "Disconnect GitHub"}</button>}
          <button type="button" className="replay-button" onClick={resetJourney}>Replay</button>
          {workspace && <form action={signOut}><button type="submit" className="replay-button">Sign out</button></form>}
        </div>
      </header>

      <section className="forge-main" id="main-content" aria-label="Forge workspace">
        {persistenceError && <p className="stage-footnote" role="alert">{persistenceError}</p>}

        {stage === "landing" && (
          <section className="landing-stage stage-view" aria-labelledby="landing-title">
            <div className="landing-copy">
              <p className="eyebrow">The operating system for engineering decisions</p>
              <h1 id="landing-title">Engineering<br /><span>decisions,</span><br />traced.</h1>
              <p className="landing-deck">Forge builds a source-backed record around consequential pull requests—before confidence turns into production risk.</p>
              <button className="primary-action" type="button" onClick={() => isConnected ? setStage("repositories") : beginAuthentication()}>
                <GitHubGlyph />
                <span>{isConnected ? "Choose a repository" : "Connect GitHub"}</span>
                <ArrowGlyph />
              </button>
              <p className="quiet-assurance">GitHub data stays server-side · Forge sends no write requests · Source records before conclusions</p>
            </div>
            <div className="landing-instrument" aria-hidden="true">
              <p>Evidence Current / source-backed</p>
              <EvidenceCurrent stage="landing" pullRequest={null} evidence={[]} verdict={null} />
              <div className="landing-readout">
                <span>Source</span><b>Pull request facts</b>
                <span>Proof</span><b>Diff metadata</b>
                <span>Memory</span><b>Human decision</b>
              </div>
            </div>
          </section>
        )}

        {stage === "oauth" && (
          <section className="oauth-stage stage-view" aria-labelledby="oauth-title">
            <div className="oauth-copy">
              <p className="eyebrow">GitHub OAuth / server-side authorization</p>
              <h1 id="oauth-title">Establishing<br />repository access.</h1>
              <p>Forge is redirecting to GitHub with PKCE and a one-time authorization state. Access tokens never enter the browser.</p>
              <div className="oauth-status" aria-label="Establishing GitHub repository access">
                <GitHubGlyph />
                <div><span>github.com</span><b>Establishing repository access</b></div>
                <span className="scan-marker">…</span>
              </div>
            </div>
            <div className="oauth-protocol" aria-hidden="true">
              <span>01</span><i /> <b>PKCE + one-time state</b>
              <span>02</span><i /> <b>Server-only token storage</b>
              <span>03</span><i /> <b>Read-only GitHub requests</b>
            </div>
          </section>
        )}

        {stage === "repositories" && isConnected && (
          <section className="repositories-stage stage-view" aria-labelledby="repository-title">
            <StageIntro
              eyebrow="GitHub / repository picker"
              step="02 / 06"
              title="Choose the system you want to understand."
              copy="Forge reads repository metadata directly from GitHub before it builds any source record."
            />
            {repositoriesLoading && <p className="stage-footnote" role="status">Reading repositories from GitHub…</p>}
            {repositoryError && (
              <div className="stage-next" role="alert">
                <span>{repositoryError}</span>
                <button className="primary-action" type="button" onClick={() => setRepositoryLoadKey((key) => key + 1)}>Try again <ArrowGlyph /></button>
              </div>
            )}
            {!repositoriesLoading && !repositoryError && availableRepositories.length === 0 && (
              <div className="stage-next">
                <span>No repositories are available to this GitHub account. Check organization access, then reconnect if permissions changed.</span>
                <button className="primary-action" type="button" onClick={disconnect}>Disconnect GitHub <ArrowGlyph /></button>
              </div>
            )}
            {!repositoriesLoading && !repositoryError && availableRepositories.length > 0 && (
              <div className="repository-list" aria-label="Available repositories">
                {availableRepositories.map((repository, index) => (
                  <button
                    className="repository-row"
                    key={repository.id}
                    type="button"
                    onClick={() => selectRepository(repository)}
                  >
                    <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
                    <GitHubGlyph />
                    <span className="repository-row-title"><b>{repository.name}</b><small>{repository.owner} · {repository.visibility} · updated {relativeTime(repository.updatedAt)}</small></span>
                    <span className="repository-branch">{repository.defaultBranch}</span>
                    <span className="repository-meta">{repository.language ?? "Unknown"} · activity {relativeTime(repository.lastActivityAt)}</span>
                    <ArrowGlyph />
                  </button>
                ))}
              </div>
            )}
            <p className="stage-footnote">Repository name · owner · visibility · default branch · language · recent activity</p>
          </section>
        )}

        {stage === "scanning" && (
          <section className="scanning-stage stage-view" aria-labelledby="scan-title">
            <StageIntro
              eyebrow="Repository scan / source ingestion"
              step="03 / 06"
              title={syncingRepository ? "Reading repository history." : "Repository history captured."}
              copy={syncingRepository
                ? `Forge is reading ${selectedRemoteRepository?.fullName ?? "this repository"} from GitHub.`
                : "Forge retained pull request, changed-file, commit, and diff metadata as an inspectable source record."}
            />
            {repositoryError && (
              <div className="stage-next" role="alert">
                <span>{repositoryError}</span>
                <button className="primary-action" type="button" onClick={() => setStage("repositories")}>Return to repository picker <ArrowGlyph /></button>
              </div>
            )}
            {!repositoryError && <div className="scan-surface">
              <div className="scan-repository-line"><GitHubGlyph /><span>{selectedRepository?.fullName ?? selectedRemoteRepository?.fullName ?? "GitHub repository"}</span><b>{selectedRepository?.branch ?? selectedRemoteRepository?.defaultBranch ?? ""}</b><i>read only</i></div>
              <ol className="scan-list">
                {scanSteps.map((step, index) => {
                  const complete = !syncingRepository && index < scanProgress;
                  const working = syncingRepository && index === 0;
                  return (
                    <li key={step.title} className={(complete ? "is-complete" : "") + (working ? " is-working" : "")}>
                      <span className="scan-marker">{complete ? <CheckGlyph /> : String(index + 1).padStart(2, "0")}</span>
                      <div><b>{step.title}</b><small>{step.detail}</small></div>
                      <em>{complete ? step.result : working ? "Reading" : "Queued"}</em>
                    </li>
                  );
                })}
              </ol>
              <div className="scan-finish">
                <span>{syncingRepository ? "Reading repository history" : `${scanProgress}/${scanSteps.length} source records connected`}</span>
                <button type="button" onClick={() => setStage("guarantees")} disabled={syncingRepository || scanProgress !== scanSteps.length}>
                  <span>{syncingRepository ? "Reading repository history" : "Open source boundaries"}</span><ArrowGlyph />
                </button>
              </div>
            </div>}
          </section>
        )}

        {stage === "guarantees" && (
          <section className="guarantees-stage stage-view" aria-labelledby="guarantees-title">
            <StageIntro
              eyebrow="System guarantees / pull-request analysis"
              step="04 / 06"
              title="Select a pull request to reason from evidence."
              copy="Forge keeps repository ingestion factual, then analyzes the selected pull request with its title, description, changed files, diff, and commits."
            />
            <div className="guarantee-list">
              <article className="guarantee-row">
                <span>01</span>
                <div><p>Source record retained</p><small>Changed files, commit metadata, timestamps, and diff totals are attached to the Change Passport.</small></div>
                <b>actual data</b>
              </article>
              <article className="guarantee-row">
                <span>02</span>
                <div><p>Reasoning on demand</p><small>Forge calls the server-side analysis pipeline only after you select a pull request.</small></div>
                <b>selected PR</b>
              </article>
            </div>
            <div className="stage-next"><span>Open a pull request to turn its source record into a reviewable Change Passport.</span><button className="primary-action" type="button" onClick={() => setStage("pull-requests")}>Open recent pull requests <ArrowGlyph /></button></div>
          </section>
        )}

        {stage === "pull-requests" && (
          <section className="pull-requests-stage stage-view" aria-labelledby="pull-requests-title">
            <StageIntro
              eyebrow="Recent pull requests / source records"
              step="05 / 06"
              title="Open the change with its evidence."
              copy={`Forge captured the latest GitHub pull requests for ${selectedRepository?.fullName ?? "this repository"}.`}
            />
            {pullRequests.length === 0 ? (
              <div className="stage-next"><span>No recent pull requests were returned by GitHub for this repository.</span><button className="primary-action" type="button" onClick={() => setStage("repositories")}>Choose another repository <ArrowGlyph /></button></div>
            ) : (
              <div className="pull-request-list" aria-label="Recent pull requests">
                {pullRequests.map((pullRequest) => {
                  const passport = (workspace?.passports ?? []).find((item) => item.pullRequestId === pullRequest.id);
                  return (
                    <button
                      type="button"
                      className={"pull-request-row" + (passport ? " is-priority" : "")}
                      key={pullRequest.id}
                      onClick={passport ? () => openPassport(passport) : undefined}
                      disabled={!passport}
                      aria-label={passport ? `Open Change Passport for pull request ${pullRequest.number}` : `${pullRequest.title} is still ingesting`}
                    >
                      <span className="pr-number">#{pullRequest.number}</span>
                      <div><b>{pullRequest.title}</b><small>{pullRequest.author} · {pullRequest.branch} · +{pullRequest.additions} / -{pullRequest.deletions} · {pullRequest.commitsCount} commits · updated {pullRequest.updatedLabel}</small></div>
                      <span className={"pr-status status-" + pullRequest.status}>{pullRequest.statusLabel}</span>
                      {passport ? <ArrowGlyph /> : <span className="pr-quiet">Ingesting</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {stage === "passport" && selectedPassport && selectedRepository && selectedPassportPullRequest && (
          <section className="passport-stage stage-view" aria-labelledby="passport-title">
            <header className="passport-header">
              <div><p className="eyebrow">Change Passport / {selectedPassport.analysisStatus === "complete" ? "source-backed analysis" : "source record"}</p><span>06 / 06 · {selectedRepository.fullName}</span></div>
              <div className="passport-header-context"><span>PR #{selectedPassportPullRequest.number}</span><span>{selectedPassportPullRequest.base} → {selectedPassportPullRequest.head}</span><span>{selectedPassportPullRequest.filesChanged} files · +{selectedPassportPullRequest.additions} / -{selectedPassportPullRequest.deletions}</span></div>
              <h1 id="passport-title">The decision,<br />with its <em>chain of custody.</em></h1>
            </header>

            {analysisProgress && <p className="stage-footnote" role="status">{analysisProgress}</p>}
            {analysisError && (
              <div className="stage-next" role="alert">
                <span>{analysisError}</span>
                <button className="primary-action" type="button" onClick={() => void openPassport(selectedPassport)} disabled={analyzingPassportId === selectedPassport.id}>
                  {analyzingPassportId === selectedPassport.id ? "Retrying analysis" : "Retry analysis"} <ArrowGlyph />
                </button>
              </div>
            )}

            <div className="passport-layout">
              <aside className="passport-source" aria-label="Pull request source context">
                <p className="panel-label">Source record</p>
                <div className="source-repository"><GitHubGlyph /><span>{selectedRepository.fullName}</span></div>
                <div className="source-pull-request"><span>#{selectedPassportPullRequest.number}</span><b>{selectedPassportPullRequest.title}</b><small>{selectedPassportPullRequest.author} · {selectedPassportPullRequest.base} → {selectedPassportPullRequest.head}</small></div>
                <dl>
                  <div><dt>Branch</dt><dd>{selectedPassportPullRequest.branch}</dd></div>
                  <div><dt>Diff</dt><dd>{selectedPassportPullRequest.filesChanged} files · +{selectedPassportPullRequest.additions} / -{selectedPassportPullRequest.deletions}</dd></div>
                  <div><dt>Commits</dt><dd>{selectedPassportPullRequest.commitsCount} captured</dd></div>
                  <div><dt>Review state</dt><dd>{selectedPassport.reviewState.replaceAll("_", " ")}</dd></div>
                </dl>
              </aside>

              <section className="passport-evidence" aria-label="Evidence Current">
                <div className="evidence-heading"><p className="panel-label">Evidence Current</p><span>↑ ↓ or J K to trace</span></div>
                <EvidenceCurrent stage="passport" pullRequest={selectedPassportPullRequest} evidence={evidenceEntries} verdict={selectedPassport.verdict} />
                <div className="evidence-list">
                  {evidenceEntries.map((entry, index) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={"evidence-row" + (activeEvidence?.id === entry.id ? " is-active" : "") + (entry.tone !== "default" ? " tone-" + entry.tone : "")}
                      ref={(element) => { evidenceControls.current[entry.id] = element; }}
                      onClick={() => setActiveEvidenceId(entry.id)}
                      onFocus={() => setActiveEvidenceId(entry.id)}
                      aria-pressed={activeEvidence?.id === entry.id}
                      data-evidence-control
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div><small>{entry.label}</small><b>{entry.title}</b><em>{entry.detail}</em></div>
                      <i>{entry.source}</i>
                    </button>
                  ))}
                </div>
              </section>

              <ChangePassportCard
                passport={selectedPassport}
                repository={selectedRepository.fullName}
                changeNumber={selectedPassportPullRequest.number}
                recorded={recorded}
                recording={recording}
                repairStaged={repairStaged}
                analysisComplete={selectedPassport.analysisStatus === "complete"}
                evidenceCount={selectedPassport.evidence.length}
                reviewState={selectedPassport.reviewState}
                onStageRepair={stageRepair}
                onRecord={recordDecision}
              />
            </div>
            <footer className="passport-footer"><span>Forge records source evidence before a human decision.</span><span>{recorded ? "Decision memory / recorded" : "Evidence before confidence."}</span></footer>
          </section>
        )}
      </section>
    </main>
  );
}

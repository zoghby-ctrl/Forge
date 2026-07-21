"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "@/components/forge/app-sidebar";
import { ForgeMark } from "@/components/forge/forge-mark";
import { GitHubMark } from "@/components/forge/github-mark";
import {
  PullRequestWorkspace,
  RepositoryPicker,
  WorkspaceOverview,
} from "@/components/forge/workspace-surfaces";
import { ChangePassportCard } from "@/components/passport/change-passport";
import { PassportEvidence } from "@/components/passport/passport-evidence";
import { PassportReviewTools } from "@/components/passport/passport-review-tools";
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
  landing: "Forge workspace overview.",
  oauth: "Establishing repository access.",
  repositories: "Choose or refresh the active repository.",
  scanning: "Repository source record status.",
  guarantees: "Repository source record is ready.",
  "pull-requests": "Pull request source records are ready to inspect.",
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

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function verdictLabel(verdict: ForgePassport["verdict"]) {
  return verdict === "ship_with_conditions"
    ? "Ship with conditions"
    : verdict.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function shortSha(sha: string) {
  return sha.length > 12 ? sha.slice(0, 12) : sha;
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
  const [scanProgress, setScanProgress] = useState(
    initialForgeWorkspace?.repositories.length ? scanStepCount : 0,
  );
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [repairOverride, setRepairOverride] = useState<{ passportId: string; value: boolean } | null>(null);
  const [repairSaving, setRepairSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [analyzingPassportId, setAnalyzingPassportId] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(
    initialGitHubNotice ? githubNotices[initialGitHubNotice] ?? "GitHub connection needs attention." : null,
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
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
  const repositoryPassports = (workspace?.passports ?? []).filter(
    (passport) => passport.repositoryId === selectedRepository?.id,
  );
  const selectedPassport = repositoryPassports.find(
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
  const analyzingSelectedPassport = analyzingPassportId === selectedPassport?.id;
  const selectedAnalysisComplete = selectedPassport?.analysisStatus === "complete";
  const selectedReviewAnswerCount = selectedPassport?.review.messages.filter((message) => message.role === "assistant").length ?? 0;
  const selectedHasReview = Boolean(selectedPassport && (selectedReviewAnswerCount > 0 || selectedPassport.review.insights));
  const selectedSourceEvidenceCount = selectedPassport?.evidence.filter((entry) => (
    entry.label === "Pull request" || entry.label === "Diff metadata" || entry.label === "Commit metadata"
  )).length ?? 0;
  const selectedAnalysisLabel = analyzingSelectedPassport
    ? selectedAnalysisComplete ? "Checking current" : "In progress"
    : selectedPassport?.analysisStatus === "complete"
      ? selectedPassport.verdict === "insufficient_evidence" ? "Evidence insufficient" : "Complete"
      : selectedPassport?.analysisStatus === "failed"
        ? "Needs retry"
        : "Not run";
  const selectedAnalysisDetail = selectedAnalysisComplete && selectedPassport
    ? `${verdictLabel(selectedPassport.verdict)} recommendation`
    : analyzingSelectedPassport
      ? analysisProgress ?? "Reading retained source"
      : selectedPassport?.analysisStatus === "failed"
        ? "Source facts remain available"
        : "Source facts only";
  const selectedReviewLabel = !selectedAnalysisComplete
    ? "Blocked"
    : selectedHasReview
      ? "Available"
      : "Not started";
  const selectedReviewDetail = selectedPassport?.review.insights
    ? "Risk review generated"
    : selectedReviewAnswerCount > 0
      ? `${selectedReviewAnswerCount} cited ${selectedReviewAnswerCount === 1 ? "answer" : "answers"}`
      : selectedAnalysisComplete
        ? "Optional evidence-bound review"
        : "Requires completed analysis";
  const selectedDecisionLabel = selectedPassport?.decision
    ? "Recorded"
    : selectedAnalysisComplete
      ? "Pending"
      : "Blocked";
  const hasAppSidebar = Boolean(workspace);
  const activeNavigationStage: WorkspaceStage = stage === "oauth"
    ? "landing"
    : stage === "guarantees"
      ? "scanning"
      : stage;

  const workspaceNavigation = useMemo(() => [
    { stage: "landing" as const, label: "Overview", description: "Workspace status" },
    { stage: "repositories" as const, label: "Repositories", description: selectedRepository ? "Switch or refresh" : "Choose a source", disabled: !isConnected },
    { stage: "scanning" as const, label: "Source record", description: selectedRepository ? `${formatCount(pullRequests.length, "pull request")} captured` : "Awaiting a repository", disabled: !selectedRepository },
    { stage: "pull-requests" as const, label: "Pull requests", description: `${pullRequests.length} available`, disabled: pullRequests.length === 0 },
    { stage: "passport" as const, label: "Change Passport", description: selectedPassport ? selectedPassport.analysisStatus.replaceAll("_", " ") : "Awaiting a change", disabled: !selectedPassport || !selectedPassportPullRequest },
  ], [isConnected, pullRequests.length, selectedPassport, selectedPassportPullRequest, selectedRepository]);

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
  const displayedPullRequestCount = syncingRepository ? 0 : pullRequests.length;
  const displayedChangedFiles = syncingRepository ? 0 : changedFiles;
  const displayedCommits = syncingRepository ? 0 : commits;
  const displayedPassportCount = syncingRepository ? 0 : repositoryPassports.length;
  const scanSteps = [
      {
        title: "Reading repository history",
        detail: syncingRepository
          ? "Fetching recent pull requests from GitHub."
          : `${formatCount(displayedPullRequestCount, "recent pull request")} captured from GitHub.`,
        result: formatCount(displayedPullRequestCount, "pull request"),
      },
      {
        title: "Capturing changed-file metadata",
        detail: syncingRepository
          ? "Waiting for GitHub file metadata."
          : `${formatCount(displayedChangedFiles, "changed file")} recorded without copying source code.`,
        result: formatCount(displayedChangedFiles, "file"),
      },
      {
        title: "Capturing commit metadata",
        detail: syncingRepository
          ? "Waiting for GitHub commit metadata."
          : `${formatCount(displayedCommits, "commit")} retained as traceable source records.`,
        result: formatCount(displayedCommits, "commit"),
      },
      {
        title: "Preparing Change Passport records",
        detail: syncingRepository
          ? "Waiting for pull request source records."
          : `${formatCount(displayedPassportCount, "source record")} ${displayedPassportCount === 1 ? "is" : "are"} ready for on-demand analysis.`,
        result: `${displayedPassportCount} ready`,
      },
  ];

  const currentIndex = Math.max(0, evidenceEntries.findIndex((entry) => entry.id === activeEvidence?.id));

  const topbarContext = stage === "landing"
    ? workspace
      ? selectedRepository
        ? `${selectedRepository.fullName} · overview`
        : `${workspace.project.name} · overview`
      : "Decision memory for software changes"
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
    setRepairSaving(false);
    setRecording(false);
    setAnalyzingPassportId(null);
    setAnalysisProgress(null);
    setAnalysisError(null);
    setPersistenceError(null);
    setMobileNavigationOpen(false);
  }, []);

  const navigateWorkspace = useCallback((nextStage: WorkspaceStage) => {
    if (nextStage === "scanning" && selectedRepository) {
      setScanProgress(scanStepCount);
    }
    if (nextStage === "passport" && selectedPassport) {
      setActiveEvidenceId(selectedPassport.evidence[0]?.id ?? null);
    }
    setStage(nextStage);
  }, [selectedPassport, selectedRepository]);

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
      if (event.key === "Escape" && mobileNavigationOpen) {
        event.preventDefault();
        setMobileNavigationOpen(false);
        return;
      }

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
      if (target?.closest("button, a, input, textarea, select, summary, [role=button], [contenteditable=true]") && !evidenceControl) return;

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
  }, [mobileNavigationOpen, moveEvidence, resetJourney, stage]);

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
    if (!selectedPassport || repairSaving) return;

    const nextValue = !repairStaged;
    setRepairOverride({ passportId: selectedPassport.id, value: nextValue });
    setRepairSaving(true);
    setPersistenceError(null);

    try {
      const persisted = await persistRepairPath(selectedPassport.id, { repairStaged: nextValue });
      updatePassport(persisted.passportId, { repairStaged: persisted.repairStaged });
      setRepairOverride(null);
    } catch (error) {
      setRepairOverride(null);
      setPersistenceError(error instanceof Error ? error.message : "Forge could not stage this follow-up.");
    } finally {
      setRepairSaving(false);
    }
  }, [repairSaving, repairStaged, selectedPassport, updatePassport]);

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
    <main className={"forge-shell stage-" + stage + (recorded ? " is-recorded" : "") + (hasAppSidebar ? " has-app-sidebar" : "")} id="forge">
      <a className="skip-link" href="#main-content">Skip to current Forge view</a>
      <p className="sr-only" aria-live="polite">{stageLabels[stage]}</p>

      {workspace && (
        <AppSidebar
          activeStage={activeNavigationStage}
          githubLogin={workspace.github.login}
          githubConnected={isConnected}
          mobileOpen={mobileNavigationOpen}
          navigation={workspaceNavigation}
          disconnecting={disconnecting}
          onClose={() => setMobileNavigationOpen(false)}
          onDisconnect={() => {
            setMobileNavigationOpen(false);
            void disconnect();
          }}
          onNavigate={navigateWorkspace}
          onRestart={resetJourney}
        />
      )}

      <header className="forge-topbar">
        {workspace && (
          <button
            className="mobile-navigation-trigger"
            type="button"
            aria-label="Open navigation"
            aria-controls="forge-navigation"
            aria-expanded={mobileNavigationOpen}
            onClick={() => setMobileNavigationOpen(true)}
          >
            <span /><span /><span />
          </button>
        )}
        <button className={"forge-brand" + (workspace ? " is-workspace-brand" : "")} type="button" onClick={resetJourney} aria-label="Open Forge overview">
          <ForgeMark />
        </button>
        <div className="topbar-center">
          <span className="topbar-current" />
          <span>{topbarContext}</span>
        </div>
        <div className="topbar-actions">
          {isConnected && <span className="connection-pill"><GitHubMark /><span>GitHub · {workspace?.github.login ?? "connected"}</span><i /></span>}
          {(!workspace || stage !== "landing") && <button type="button" className="replay-button" onClick={resetJourney}>{workspace ? "Overview" : "Replay"}</button>}
        </div>
      </header>

      <section className="forge-main" id="main-content" aria-label="Forge workspace">
        {persistenceError && <p className="stage-footnote" role="alert">{persistenceError}</p>}

        {stage === "landing" && (workspace ? (
          <WorkspaceOverview
            workspace={workspace}
            repository={selectedRepository}
            pullRequests={pullRequests}
            onConnect={beginAuthentication}
            onNavigate={navigateWorkspace}
            onOpenPassport={(passport) => { void openPassport(passport); }}
          />
        ) : (
          <section className="landing-stage stage-view" aria-labelledby="landing-title">
              <div className="landing-copy">
                <p className="eyebrow">The operating system for engineering decisions</p>
                <h1 id="landing-title">Engineering<br /><span>decisions,</span><br />traced.</h1>
                <p className="landing-deck">Forge builds a source-backed record around consequential pull requests—before confidence turns into production risk.</p>
                <button className="primary-action" type="button" onClick={beginAuthentication}>
                  <GitHubMark />
                  <span>Connect GitHub</span>
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
        ))}

        {stage === "oauth" && (
          <section className="oauth-stage stage-view" aria-labelledby="oauth-title">
            <div className="oauth-copy">
              <p className="eyebrow">GitHub OAuth / server-side authorization</p>
              <h1 id="oauth-title">Establishing<br />repository access.</h1>
              <p>Forge is redirecting to GitHub with PKCE and a one-time authorization state. Access tokens never enter the browser.</p>
              <div className="oauth-status" aria-label="Establishing GitHub repository access">
                <GitHubMark />
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
              eyebrow="GitHub / active repository"
              step="Connected / read only"
              title={selectedRepository ? "Choose, switch, or refresh your source." : "Choose the system you want to understand."}
              copy="Forge reads repository metadata directly from GitHub. Switching changes the active workspace, while existing decision records remain stored."
            />
            <RepositoryPicker
              repositories={availableRepositories}
              currentRepository={selectedRepository}
              githubLogin={workspace?.github.login ?? null}
              loading={repositoriesLoading}
              error={repositoryError}
              onRetry={() => setRepositoryLoadKey((key) => key + 1)}
              onSelect={selectRepository}
              onDisconnect={() => { void disconnect(); }}
            />
          </section>
        )}

        {stage === "scanning" && (
          <section className="scanning-stage stage-view" aria-labelledby="scan-title">
            <StageIntro
              eyebrow="Source record / GitHub sync"
              step={syncingRepository ? "Sync in progress" : "Source current"}
              title={syncingRepository ? "Reading repository history." : "Repository source captured."}
              copy={syncingRepository
                ? `Forge is reading ${selectedRemoteRepository?.fullName ?? "this repository"} from GitHub.`
                : "Forge retained pull request, changed-file, commit, and diff metadata as an inspectable source record."}
            />
            {repositoryError && (
              <div className="workspace-empty-state is-sync-error" role="alert">
                <span>Repository sync interrupted</span>
                <h2>Forge could not refresh this source.</h2>
                <p>{repositoryError}</p>
                <div>
                  {selectedRemoteRepository && <button type="button" onClick={() => { void selectRepository(selectedRemoteRepository); }}>Try sync again</button>}
                  <button type="button" onClick={() => setStage("repositories")}>Return to repositories</button>
                </div>
              </div>
            )}
            {!repositoryError && <div className="scan-surface">
              <div className="scan-repository-line"><GitHubMark /><span>{syncingRepository ? selectedRemoteRepository?.fullName ?? "GitHub repository" : selectedRepository?.fullName ?? selectedRemoteRepository?.fullName ?? "GitHub repository"}</span><b>{syncingRepository ? selectedRemoteRepository?.defaultBranch ?? "" : selectedRepository?.branch ?? selectedRemoteRepository?.defaultBranch ?? ""}</b><i>{syncingRepository ? "syncing" : "read only"}</i></div>
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
                <span>{syncingRepository ? "Reading repository history from GitHub" : `${formatCount(pullRequests.length, "pull request source record")} captured`}</span>
                <button type="button" onClick={() => setStage("guarantees")} disabled={syncingRepository || scanProgress !== scanSteps.length}>
                  <span>{syncingRepository ? "Reading repository history" : "Review workspace readiness"}</span><ArrowGlyph />
                </button>
              </div>
            </div>}
          </section>
        )}

        {stage === "guarantees" && (
          <section className="guarantees-stage stage-view" aria-labelledby="guarantees-title">
            <StageIntro
              eyebrow="Workspace / analysis boundary"
              step="Source current"
              title={pullRequests.length > 0 ? "The source is ready. Reasoning stays on demand." : "The source is current. No changes are waiting."}
              copy="Forge keeps ingestion factual. AI analysis starts only after you select a pull request, and every conclusion remains attached to source evidence."
            />
            <div className="readiness-ledger" aria-label="Workspace readiness">
              <article>
                <span>Repository</span>
                <div><p>{selectedRepository?.fullName ?? "No active repository"}</p><small>{selectedRepository ? `${selectedRepository.branch} · ${selectedRepository.visibility} · ${selectedRepository.language ?? "language not reported"}` : "Choose a repository to establish workspace context."}</small></div>
                <b>{selectedRepository ? "active" : "waiting"}</b>
              </article>
              <article>
                <span>Source record</span>
                <div><p>{formatCount(pullRequests.length, "pull request")} · {formatCount(changedFiles, "changed file")} · {formatCount(commits, "commit")}</p><small>GitHub metadata is retained without copying repository source code into the browser.</small></div>
                <b>{selectedRepository ? "captured" : "waiting"}</b>
              </article>
              <article>
                <span>Analysis boundary</span>
                <div><p>{formatCount(repositoryPassports.length, "Change Passport source record")}</p><small>Source-backed reasoning begins only when a reviewer opens a pull request.</small></div>
                <b>{repositoryPassports.length > 0 ? "ready on demand" : "no changes"}</b>
              </article>
            </div>
            <div className="stage-next"><span>{pullRequests.length > 0 ? "Choose a source record to create or reopen its reviewable Change Passport." : "Select another repository if you need to review an active change."}</span><button className="primary-action" type="button" onClick={() => setStage(pullRequests.length > 0 ? "pull-requests" : "repositories")}>{pullRequests.length > 0 ? "Review pull requests" : "Choose another repository"} <ArrowGlyph /></button></div>
          </section>
        )}

        {stage === "pull-requests" && workspace && (
          <PullRequestWorkspace
            workspace={workspace}
            repository={selectedRepository}
            pullRequests={pullRequests}
            onOpenPassport={(passport) => { void openPassport(passport); }}
            onOpenRepositories={() => setStage("repositories")}
          />
        )}

        {stage === "passport" && selectedPassport && selectedRepository && selectedPassportPullRequest && (
          <section className="passport-record-stage stage-view" aria-labelledby="passport-title">
            <header className="passport-record-header">
              <div className="passport-record-kicker">
                <p className="eyebrow">Change Passport / PR #{selectedPassportPullRequest.number}</p>
                <span>{selectedRepository.fullName} · source current</span>
              </div>
              <div className="passport-record-identity">
                <h1 id="passport-title">{selectedPassportPullRequest.title}</h1>
                <p>{selectedPassportPullRequest.author} · {selectedPassportPullRequest.branch}</p>
              </div>
              <div className="passport-record-reference">
                <span>Base {shortSha(selectedPassportPullRequest.base)} → head {shortSha(selectedPassportPullRequest.head)}</span>
                <span>{selectedPassportPullRequest.filesChanged} files · +{selectedPassportPullRequest.additions} / -{selectedPassportPullRequest.deletions} · {selectedPassportPullRequest.commitsCount} commits</span>
                {selectedPassportPullRequest.htmlUrl && <a href={selectedPassportPullRequest.htmlUrl} target="_blank" rel="noreferrer">Open pull request ↗</a>}
              </div>
            </header>

            <div className="passport-status-grid" aria-label="Change Passport status">
              <article className="tone-proof">
                <span>Source</span>
                <b>Captured</b>
                <p>{selectedSourceEvidenceCount} GitHub {selectedSourceEvidenceCount === 1 ? "fact" : "facts"} retained</p>
              </article>
              <article className={selectedPassport.analysisStatus === "failed" && !analyzingSelectedPassport ? "tone-alert" : selectedAnalysisComplete ? "tone-proof" : "tone-muted"}>
                <span>Analysis</span>
                <b>{selectedAnalysisLabel}</b>
                <p>{selectedAnalysisDetail}</p>
              </article>
              <article className={selectedHasReview ? "tone-proof" : "tone-muted"}>
                <span>AI review</span>
                <b>{selectedReviewLabel}</b>
                <p>{selectedReviewDetail}</p>
              </article>
              <article className={selectedPassport.decision ? "tone-repair" : selectedAnalysisComplete ? "tone-alert" : "tone-muted"}>
                <span>Human decision</span>
                <b>{selectedDecisionLabel}</b>
                <p>{selectedPassport.decision ? verdictLabel(selectedPassport.decision.action) : selectedAnalysisComplete ? "Recommendation awaits confirmation" : "Requires completed analysis"}</p>
              </article>
              <aside className="passport-next-action">
                <div><span>Next action</span><b>{analyzingSelectedPassport ? "Let Forge finish" : !selectedAnalysisComplete ? selectedPassport.analysisStatus === "failed" ? "Retry analysis" : "Run analysis" : !selectedPassport.decision ? "Confirm the decision" : "Export the record"}</b></div>
                <p>{analyzingSelectedPassport
                  ? analysisProgress ?? "Forge is reasoning from retained source."
                  : !selectedAnalysisComplete
                    ? analysisError ?? selectedPassport.analysisError ?? "Generate a source-grounded recommendation before review or decision recording."
                    : !selectedPassport.decision
                      ? "Review the recommendation, required condition, evidence, and unknowns before recording it."
                      : "The durable decision record is ready to share as Markdown or PDF."}</p>
                {analyzingSelectedPassport ? (
                  <span className="passport-next-working" role="status"><i aria-hidden="true" />Analysis in progress</span>
                ) : !selectedAnalysisComplete ? (
                  <button type="button" onClick={() => void openPassport(selectedPassport)}>{selectedPassport.analysisStatus === "failed" ? "Retry analysis" : "Run analysis"} <span aria-hidden="true">→</span></button>
                ) : !selectedPassport.decision ? (
                  <a href="#passport-decision">Review recommendation <span aria-hidden="true">↓</span></a>
                ) : (
                  <a href="#passport-export">Open export <span aria-hidden="true">↓</span></a>
                )}
              </aside>
            </div>

            <div className="passport-overview-grid">
              <section className="passport-source-card" aria-labelledby="passport-source-title">
                <div className="passport-source-card-head"><p className="panel-label">Source snapshot</p><span>Read only</span></div>
                <div className="passport-source-title">
                  <GitHubMark />
                  <div><span>#{selectedPassportPullRequest.number}</span><h2 id="passport-source-title">{selectedPassportPullRequest.title}</h2><p>{selectedRepository.fullName}</p></div>
                </div>
                <dl>
                  <div><dt>Author</dt><dd>{selectedPassportPullRequest.author}</dd></div>
                  <div><dt>Head branch</dt><dd>{selectedPassportPullRequest.branch}</dd></div>
                  <div><dt>Base commit</dt><dd>{shortSha(selectedPassportPullRequest.base)}</dd></div>
                  <div><dt>Head commit</dt><dd>{shortSha(selectedPassportPullRequest.head)}</dd></div>
                  <div><dt>Diff</dt><dd>{selectedPassportPullRequest.filesChanged} files · +{selectedPassportPullRequest.additions} / -{selectedPassportPullRequest.deletions}</dd></div>
                  <div><dt>Commits</dt><dd>{selectedPassportPullRequest.commitsCount} captured</dd></div>
                </dl>
                {selectedPassportPullRequest.htmlUrl && <a href={selectedPassportPullRequest.htmlUrl} target="_blank" rel="noreferrer">Inspect source on GitHub ↗</a>}
              </section>

              <ChangePassportCard
                passport={selectedPassport}
                repository={selectedRepository.fullName}
                changeNumber={selectedPassportPullRequest.number}
                recording={recording}
                repairStaged={repairStaged}
                repairSaving={repairSaving}
                analyzing={analyzingSelectedPassport}
                analysisError={analysisError ?? selectedPassport.analysisError}
                summaryEvidenceUrl={selectedPassport.evidence.find((entry) => entry.label.startsWith("Intent"))?.sourceUrl ?? null}
                onAnalyze={() => void openPassport(selectedPassport)}
                onStageRepair={() => void stageRepair()}
                onRecord={() => void recordDecision()}
              />
            </div>

            <PassportEvidence
              passport={selectedPassport}
              pullRequest={selectedPassportPullRequest}
              activeEvidence={activeEvidence}
              analyzing={analyzingSelectedPassport}
              onSelectEvidence={setActiveEvidenceId}
              registerControl={(evidenceId, element) => { evidenceControls.current[evidenceId] = element; }}
            />

            <PassportReviewTools
              passport={selectedPassport}
              pullRequest={selectedPassportPullRequest}
              analysisComplete={selectedAnalysisComplete}
              onReviewChange={(review) => updatePassport(selectedPassport.id, { review })}
            />
            <footer className="passport-record-footer"><span>Forge records source evidence before a human decision.</span><span>{recorded ? "Decision memory / recorded" : "Unknowns stay visible until resolved."}</span></footer>
          </section>
        )}
      </section>
    </main>
  );
}

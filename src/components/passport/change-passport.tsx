"use client";

import { useState } from "react";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import type { ForgePassport } from "@/domain/forge-workspace";

function verdictLabel(verdict: ForgePassport["verdict"]) {
  return verdict === "ship_with_conditions"
    ? "Ship with conditions"
    : verdict.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function confidencePresentation(confidence: string, analysisComplete: boolean) {
  if (!analysisComplete) {
    return {
      label: "Unavailable",
      rationale: "AI confidence is not available until source-grounded analysis completes.",
    };
  }

  const parsed = confidence.match(/^(\d+)%\s*confidence\s*·\s*(.+)$/i);
  if (!parsed) return { label: "Reported", rationale: confidence };

  const score = Number(parsed[1]);
  const label = score >= 80 ? "High" : score >= 60 ? "Moderate" : score >= 40 ? "Limited" : "Low";
  return { label, rationale: parsed[2] };
}

function formatRecordedAt(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Recorded";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

interface ChangePassportCardProps {
  passport: ForgePassport;
  repository: string;
  changeNumber: number;
  recording: boolean;
  repairStaged: boolean;
  repairSaving: boolean;
  analyzing: boolean;
  analysisError: string | null;
  summaryEvidenceUrl: string | null;
  onAnalyze: () => void;
  onStageRepair: () => void;
  onRecord: () => void;
}

export function ChangePassportCard({
  passport,
  repository,
  changeNumber,
  recording,
  repairStaged,
  repairSaving,
  analyzing,
  analysisError,
  summaryEvidenceUrl,
  onAnalyze,
  onStageRepair,
  onRecord,
}: ChangePassportCardProps) {
  const [confirmingDecision, setConfirmingDecision] = useState(false);
  const analysisComplete = passport.analysisStatus === "complete";
  const recorded = passport.decision !== null;
  const decisionLabel = verdictLabel(passport.verdict);
  const confidence = confidencePresentation(passport.confidence, analysisComplete);
  const analysisLabel = analyzing
    ? analysisComplete ? "Checking current analysis" : "Analysis in progress"
    : passport.analysisStatus === "failed"
      ? "Analysis needs retry"
      : "Analysis not run";
  const resultTone = recorded
    ? "repair"
    : analysisComplete && (passport.verdict === "hold" || passport.verdict === "insufficient_evidence")
      ? "alert"
      : analysisComplete
        ? "proof"
        : passport.analysisStatus === "failed"
          ? "alert"
          : "muted";

  return (
    <aside
      className={`passport-decision-panel glow-surface tone-${resultTone}${recorded ? " is-recorded" : ""}`}
      id="passport-decision"
      aria-labelledby="passport-decision-title"
    >
      <GlowingEffect disabled={false} glow spread={18} />
      <div className="passport-decision-head">
        <p className="panel-label">{analysisComplete ? "AI recommendation" : "Analysis result"}</p>
        <span>FORGE / {String(changeNumber).padStart(4, "0")}</span>
      </div>

      <div className="passport-decision-result">
        <span>{recorded ? "Recorded decision" : analysisComplete ? "Evidence posture" : "Current state"}</span>
        <h2 id="passport-decision-title">{recorded ? verdictLabel(passport.decision!.action) : analysisComplete ? decisionLabel : analysisLabel}</h2>
        {analysisComplete ? (
          <p>{passport.summary}</p>
        ) : (
          <p>{analysisError ?? "Forge has retained the source facts, but no AI recommendation is available yet."}</p>
        )}
        {analysisComplete && summaryEvidenceUrl && (
          <a className="passport-summary-evidence" href={summaryEvidenceUrl} target="_blank" rel="noreferrer">
            Trace summary evidence <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>

      {!analysisComplete && (
        <button className="passport-analysis-action" type="button" onClick={onAnalyze} disabled={analyzing}>
          <span>{analyzing ? "Analyzing retained source" : passport.analysisStatus === "failed" ? "Retry analysis" : "Run source-grounded analysis"}</span>
          <span aria-hidden="true">{analyzing ? "…" : "→"}</span>
        </button>
      )}

      {analysisComplete && (
        <>
          <div className="passport-condition">
            <span>Required before merge</span>
            <b>{repairStaged ? "Follow-up staged. Re-run this Passport against the next source revision." : passport.condition}</b>
          </div>

          <button
            className={`passport-repair-action${repairStaged ? " is-staged" : ""}`}
            type="button"
            onClick={onStageRepair}
            disabled={repairSaving}
            aria-pressed={repairStaged}
          >
            <span aria-hidden="true">{repairSaving ? "…" : repairStaged ? "✓" : "+"}</span>
            <span>
              <b>{repairSaving ? "Saving follow-up" : repairStaged ? "Follow-up staged" : "Stage required follow-up"}</b>
              <small>{repairStaged ? "This marker is retained with the Passport and does not change GitHub." : "Add a durable follow-up marker without modifying the pull request."}</small>
            </span>
          </button>
        </>
      )}

      <dl className="passport-decision-facts">
        <div><dt>Analysis</dt><dd>{analysisComplete ? "Complete" : analyzing ? "In progress" : passport.analysisStatus === "failed" ? "Failed" : "Not run"}</dd></div>
        <div><dt>Confidence</dt><dd>{confidence.label}<span>{confidence.rationale}</span></dd></div>
        <div><dt>Evidence retained</dt><dd>{passport.evidence.length} cited {passport.evidence.length === 1 ? "source" : "sources"}</dd></div>
        <div><dt>Repository</dt><dd>{repository}</dd></div>
      </dl>

      {recorded ? (
        <div className="passport-recorded-decision" role="status">
          <span aria-hidden="true">✓</span>
          <div><b>{verdictLabel(passport.decision!.action)} recorded</b><small>{formatRecordedAt(passport.decision!.recordedAt)}</small></div>
        </div>
      ) : analysisComplete && confirmingDecision ? (
        <div className="passport-decision-confirmation" role="group" aria-label="Confirm decision recording">
          <p>Forge currently records the Passport recommendation as the human decision. This creates decision memory; it does not merge or modify GitHub.</p>
          <div>
            <button type="button" onClick={() => setConfirmingDecision(false)} disabled={recording}>Cancel</button>
            <button type="button" onClick={onRecord} disabled={recording}>{recording ? "Recording…" : `Record ${decisionLabel}`}</button>
          </div>
        </div>
      ) : (
        <button
          className="passport-record-action"
          type="button"
          onClick={() => setConfirmingDecision(true)}
          disabled={!analysisComplete || recording}
        >
          <span>{analysisComplete ? `Review & record ${decisionLabel.toLowerCase()}` : "Analysis required before a decision"}</span>
          <span aria-hidden="true">→</span>
        </button>
      )}
    </aside>
  );
}

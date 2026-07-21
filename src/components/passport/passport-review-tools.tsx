"use client";

import { useState, type FormEvent } from "react";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import type { ForgePassport, ForgePullRequest } from "@/domain/forge-workspace";
import type {
  ForgePassportReview,
  ForgeReviewCitation,
  ForgeRiskFinding,
} from "@/domain/passport-review";
import {
  askPassportReview,
  generatePassportInsights,
  preparePassportExport,
  type PassportExportFormat,
} from "@/features/workspace/client";

function citationLabel(citation: ForgeReviewCitation) {
  const line = citation.lineStart
    ? `:${citation.lineStart}${citation.lineEnd && citation.lineEnd !== citation.lineStart ? `–${citation.lineEnd}` : ""}`
    : "";
  if (citation.path) return `${citation.path}${line}`;
  if (citation.commitSha) return `commit ${citation.commitSha.slice(0, 12)}`;
  return "pull request";
}

function CitationLinks({ citations }: { citations: ForgeReviewCitation[] }) {
  return (
    <ul className="review-citation-list" aria-label={`${citations.length} source ${citations.length === 1 ? "citation" : "citations"}`}>
      {citations.map((citation, index) => (
        <li key={`${citation.sourceUrl ?? citation.note}-${index}`}>
          {citation.sourceUrl ? (
            <a href={citation.sourceUrl} target="_blank" rel="noreferrer">{citationLabel(citation)} <span aria-hidden="true">↗</span></a>
          ) : (
            <span>{citationLabel(citation)}</span>
          )}
          <small>{citation.note}</small>
        </li>
      ))}
    </ul>
  );
}

function riskLabel(key: string) {
  return key === "breakingChanges"
    ? "Breaking changes"
    : key === "missingTests"
      ? "Missing tests"
      : key.charAt(0).toUpperCase() + key.slice(1);
}

function postureLabel(posture: ForgeRiskFinding["posture"]) {
  if (posture === "not_observed") return "Not observed in supplied change";
  if (posture === "insufficient_evidence") return "Unknown · insufficient evidence";
  return `${posture.charAt(0).toUpperCase()}${posture.slice(1)} posture`;
}

function postureTone(posture: ForgeRiskFinding["posture"]) {
  if (posture === "high" || posture === "insufficient_evidence") return "alert";
  if (posture === "medium") return "watch";
  if (posture === "low") return "proof";
  return "muted";
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Recorded";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

interface PassportReviewToolsProps {
  passport: ForgePassport;
  pullRequest: ForgePullRequest;
  analysisComplete: boolean;
  onReviewChange: (review: ForgePassportReview) => void;
}

type ExportState = {
  status: "idle" | "preparing" | "complete" | "error";
  format: PassportExportFormat | null;
  message: string | null;
};

export function PassportReviewTools({
  passport,
  pullRequest,
  analysisComplete,
  onReviewChange,
}: PassportReviewToolsProps) {
  const [question, setQuestion] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ status: "idle", format: null, message: null });

  const submitQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || chatBusy || !analysisComplete) return;
    setChatBusy(true);
    setChatError(null);
    setProgress("Preparing verified evidence...");
    try {
      const completed = await askPassportReview(passport.id, trimmed, (next) => setProgress(next.message));
      onReviewChange(completed.review);
      setQuestion("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Forge could not complete this AI review.");
    } finally {
      setChatBusy(false);
      setProgress(null);
    }
  };

  const generateInsights = async () => {
    if (insightsBusy || !analysisComplete) return;
    setInsightsBusy(true);
    setInsightsError(null);
    setProgress("Preparing verified evidence...");
    try {
      const completed = await generatePassportInsights(passport.id, (next) => setProgress(next.message));
      onReviewChange(completed.review);
    } catch (error) {
      setInsightsError(error instanceof Error ? error.message : "Forge could not complete this enhanced review.");
    } finally {
      setInsightsBusy(false);
      setProgress(null);
    }
  };

  const exportPassport = async (format: PassportExportFormat) => {
    if (exportState.status === "preparing") return;
    setExportState({ status: "preparing", format, message: `Preparing ${format === "markdown" ? "Markdown" : "PDF"} export...` });
    try {
      const result = await preparePassportExport(passport.id, format);
      const downloadUrl = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = result.filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      setExportState({ status: "complete", format, message: `${result.filename} is ready.` });
    } catch (error) {
      setExportState({
        status: "error",
        format,
        message: error instanceof Error ? error.message : "Forge could not prepare this export.",
      });
    }
  };

  const insights = passport.review.insights;
  const assistantAnswerCount = passport.review.messages.filter((message) => message.role === "assistant").length;
  const riskEntries = insights ? Object.entries(insights.risks) : [];
  const highRiskCount = riskEntries.filter(([, risk]) => risk.posture === "high").length;
  const mediumRiskCount = riskEntries.filter(([, risk]) => risk.posture === "medium").length;
  const unknownRiskCount = riskEntries.filter(([, risk]) => risk.posture === "insufficient_evidence").length;

  return (
    <section className="passport-review-workbench" id="passport-review" aria-labelledby="passport-review-title">
      <header className="passport-section-heading">
        <div>
          <p className="panel-label">AI review / evidence-bound</p>
          <h2 id="passport-review-title">Interrogate the change without leaving the record.</h2>
        </div>
        <span>PR #{pullRequest.number} · claims require retained citations</span>
      </header>

      {progress && (
        <div className="review-operation-status" role="status">
          <span aria-hidden="true" />
          <p>{progress}</p>
        </div>
      )}

      <div className="passport-review-layout">
        <section className="passport-ai-review glow-surface" aria-labelledby="focused-review-title">
          <GlowingEffect disabled={false} spread={16} />
          <div className="passport-subsection-head">
            <div>
              <p className="review-panel-label">Focused engineering review</p>
              <h3 id="focused-review-title">Ask a source-grounded question</h3>
            </div>
            <span>{assistantAnswerCount} cited {assistantAnswerCount === 1 ? "answer" : "answers"}</span>
          </div>

          {passport.review.messages.length === 0 ? (
            <div className="review-empty-state">
              <span>{analysisComplete ? "No review questions yet" : "Analysis required"}</span>
              <p>{analysisComplete
                ? "Ask about intent, changed behavior, risk, or verification. Forge will return a claim, rationale, and retained citations."
                : "Complete the Change Passport analysis before asking Forge to reason over the retained source."}</p>
            </div>
          ) : (
            <ol className="review-thread-list">
              {passport.review.messages.map((message) => message.role === "user" ? (
                <li className="review-thread-question" key={message.id}>
                  <div><span>You asked</span><time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time></div>
                  <p>{message.content}</p>
                </li>
              ) : (
                <li className="review-thread-answer" key={message.id}>
                  <div><span>Forge answer</span><time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time></div>
                  <h4>{message.answer.statement}</h4>
                  <p>{message.answer.rationale}</p>
                  <CitationLinks citations={message.answer.citations} />
                </li>
              ))}
            </ol>
          )}

          <form className="review-question-form" onSubmit={submitQuestion}>
            <label htmlFor={`passport-question-${passport.id}`}>Question for this source record</label>
            <textarea
              id={`passport-question-${passport.id}`}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={analysisComplete ? "What evidence supports the recommended decision?" : "Complete analysis to unlock AI review"}
              disabled={!analysisComplete || chatBusy}
              rows={4}
              maxLength={4000}
            />
            <div>
              <span>{question.length} / 4,000</span>
              <button className="passport-review-action" type="submit" disabled={!analysisComplete || chatBusy || !question.trim()}>
                {chatBusy ? "Reviewing evidence…" : "Ask Forge"}
              </button>
            </div>
          </form>
          {chatError && <p className="review-error" role="alert">{chatError}</p>}
        </section>

        <section className="passport-insights glow-surface" id="passport-insights" aria-labelledby="passport-insights-title">
          <GlowingEffect disabled={false} spread={16} />
          <div className="passport-subsection-head">
            <div>
              <p className="review-panel-label">Insights / category review</p>
              <h3 id="passport-insights-title">Risk posture & repairs</h3>
            </div>
            <button className="passport-review-action" type="button" onClick={() => void generateInsights()} disabled={!analysisComplete || insightsBusy}>
              {insightsBusy ? "Reviewing…" : insights ? "Refresh review" : "Generate review"}
            </button>
          </div>

          {!insights ? (
            <div className="review-empty-state">
              <span>{analysisComplete ? "Category review not generated" : "Analysis required"}</span>
              <p>{analysisComplete
                ? "Generate a cited review across security, performance, breaking changes, missing tests, and documentation."
                : "Risk insights remain blocked until the source-grounded analysis completes."}</p>
            </div>
          ) : (
            <>
              <div className="insight-summary" aria-label="Generated risk posture summary">
                <div><span>High</span><b>{highRiskCount}</b></div>
                <div><span>Medium</span><b>{mediumRiskCount}</b></div>
                <div><span>Unknown</span><b>{unknownRiskCount}</b></div>
              </div>
              <p className="insight-provenance">Generated {formatTimestamp(insights.generatedAt)} · source {insights.sourceHeadSha.slice(0, 12)}</p>
              <div className="risk-record-list">
                {riskEntries.map(([key, risk]) => (
                  <article className={`risk-record tone-${postureTone(risk.posture)}`} key={key}>
                    <div className="risk-record-head">
                      <span>{riskLabel(key)}</span>
                      <b>{postureLabel(risk.posture)}</b>
                    </div>
                    <h4>{risk.finding.statement}</h4>
                    <p>{risk.finding.rationale}</p>
                    <CitationLinks citations={risk.finding.citations} />
                  </article>
                ))}
              </div>

              <div className="repair-records">
                <div className="repair-records-head">
                  <p className="review-panel-label">Source-grounded repairs</p>
                  <span>{insights.repairs.length}</span>
                </div>
                {insights.repairs.length === 0 ? (
                  <p className="review-empty-copy">This review returned no source-backed repair suggestion. That does not mean no repair is required.</p>
                ) : insights.repairs.map((repair) => (
                  <article className="repair-record" key={repair.id}>
                    <div><span>{repair.priority} priority</span>{repair.targetPaths.length > 0 && <small>{repair.targetPaths.join(", ")}</small>}</div>
                    <h4>{repair.title}</h4>
                    <p><b>Action</b>{repair.action.statement}</p>
                    <span>{repair.action.rationale}</span>
                    <CitationLinks citations={repair.action.citations} />
                    <p><b>Verify</b>{repair.verification.statement}</p>
                    <span>{repair.verification.rationale}</span>
                    <CitationLinks citations={repair.verification.citations} />
                  </article>
                ))}
              </div>
            </>
          )}
          {insightsError && <p className="review-error" role="alert">{insightsError}</p>}
        </section>
      </div>

      <section className="passport-export-panel" id="passport-export" aria-labelledby="passport-export-title">
        <div>
          <p className="review-panel-label">Export / portable record</p>
          <h3 id="passport-export-title">Take the evidence with the decision.</h3>
          <p>{analysisComplete
            ? "Export the current source record, AI analysis, available reviews, insights, and recorded decision."
            : "Export is available now as a source-only record. Complete analysis to include the AI recommendation and findings."}</p>
        </div>
        <dl className="export-readiness" aria-label="Export contents">
          <div><dt>Source record</dt><dd>Included</dd></div>
          <div><dt>AI analysis</dt><dd>{analysisComplete ? "Included" : "Not complete"}</dd></div>
          <div><dt>AI review</dt><dd>{assistantAnswerCount > 0 ? `${assistantAnswerCount} ${assistantAnswerCount === 1 ? "answer" : "answers"}` : "Not generated"}</dd></div>
          <div><dt>Risk insights</dt><dd>{insights ? "Included" : "Not generated"}</dd></div>
          <div><dt>Human decision</dt><dd>{passport.decision ? "Included" : "Not recorded"}</dd></div>
        </dl>
        <div className="passport-export-actions">
          <button type="button" onClick={() => void exportPassport("markdown")} disabled={exportState.status === "preparing"}>
            <span>Markdown</span><small>.md · portable text</small>
          </button>
          <button type="button" onClick={() => void exportPassport("pdf")} disabled={exportState.status === "preparing"}>
            <span>PDF</span><small>.pdf · review artifact</small>
          </button>
        </div>
        {exportState.message && (
          <p className={`export-status is-${exportState.status}`} role={exportState.status === "error" ? "alert" : "status"}>
            {exportState.message}
          </p>
        )}
      </section>
    </section>
  );
}

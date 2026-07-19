"use client";

import { useState, type FormEvent } from "react";
import type { ForgePassport, ForgePullRequest } from "@/domain/forge-workspace";
import type { ForgePassportReview, ForgeReviewCitation } from "@/domain/passport-review";
import { askPassportReview, generatePassportInsights } from "@/features/workspace/client";

function citationLabel(citation: ForgeReviewCitation) {
  const line = citation.lineStart
    ? `:${citation.lineStart}${citation.lineEnd && citation.lineEnd !== citation.lineStart ? `-${citation.lineEnd}` : ""}`
    : "";
  if (citation.path) return `${citation.path}${line}`;
  if (citation.commitSha) return `commit ${citation.commitSha.slice(0, 12)}`;
  return "pull request";
}

function CitationLinks({ citations }: { citations: ForgeReviewCitation[] }) {
  return (
    <span className="review-citations">
      {citations.map((citation, index) => citation.sourceUrl ? (
        <a key={`${citation.sourceUrl}-${citation.note}-${index}`} href={citation.sourceUrl} target="_blank" rel="noreferrer">
          {citationLabel(citation)}
        </a>
      ) : (
        <span key={`${citation.note}-${index}`}>{citationLabel(citation)}</span>
      ))}
    </span>
  );
}

function riskLabel(key: string) {
  return key === "breakingChanges"
    ? "Breaking changes"
    : key === "missingTests"
      ? "Missing tests"
      : key.charAt(0).toUpperCase() + key.slice(1);
}

interface PassportReviewToolsProps {
  passport: ForgePassport;
  pullRequest: ForgePullRequest;
  analysisComplete: boolean;
  onReviewChange: (review: ForgePassportReview) => void;
}

/** Additive Passport tools: the established source/evidence/decision layout stays intact above. */
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

  const saveReview = (next: ForgePassportReview) => {
    onReviewChange(next);
  };

  const submitQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || chatBusy || !analysisComplete) return;
    setChatBusy(true);
    setChatError(null);
    setProgress("Preparing verified evidence...");
    try {
      const completed = await askPassportReview(passport.id, trimmed, (next) => setProgress(next.message));
      saveReview(completed.review);
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
      saveReview(completed.review);
    } catch (error) {
      setInsightsError(error instanceof Error ? error.message : "Forge could not complete this enhanced review.");
    } finally {
      setInsightsBusy(false);
      setProgress(null);
    }
  };

  const insights = passport.review.insights;

  return (
    <section className="passport-review-tools" aria-label="AI review and export tools">
      <div className="passport-review-head">
        <div>
          <p className="panel-label">AI review / evidence-bound</p>
          <h2>Ask the Passport</h2>
        </div>
        <span>PR #{pullRequest.number} · every Forge claim links to retained source</span>
      </div>
      {progress && <p className="review-progress" role="status">{progress}</p>}

      <div className="passport-review-grid">
        <section className="review-chat-panel" aria-label="AI review chat">
          <p className="review-panel-label">Conversation history</p>
          {passport.review.messages.length === 0 ? (
            <p className="review-empty">Ask about the change, a risk, or a repair. Forge will answer only from the captured pull-request evidence.</p>
          ) : (
            <div className="review-message-list">
              {passport.review.messages.map((message) => message.role === "user" ? (
                <article className="review-message review-message-user" key={message.id}>
                  <span>You</span><p>{message.content}</p>
                </article>
              ) : (
                <article className="review-message review-message-assistant" key={message.id}>
                  <span>Forge / cited answer</span>
                  <b>{message.answer.statement}</b>
                  <p>{message.answer.rationale}</p>
                  <CitationLinks citations={message.answer.citations} />
                </article>
              ))}
            </div>
          )}
          <form className="review-question-form" onSubmit={submitQuestion}>
            <label htmlFor={`passport-question-${passport.id}`}>Ask a source-grounded question</label>
            <textarea
              id={`passport-question-${passport.id}`}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What evidence supports this change?"
              disabled={!analysisComplete || chatBusy}
              rows={3}
              maxLength={4000}
            />
            <button className="passport-review-action" type="submit" disabled={!analysisComplete || chatBusy || !question.trim()}>
              {chatBusy ? "Reviewing evidence…" : "Ask Forge"}
            </button>
          </form>
          {chatError && <p className="review-error" role="alert">{chatError}</p>}
        </section>

        <section className="review-insights-panel" aria-label="Risk analysis and repair suggestions">
          <div className="review-insights-head">
            <div><p className="review-panel-label">Enhanced review</p><h3>Risks & repairs</h3></div>
            <button className="passport-review-action" type="button" onClick={() => void generateInsights()} disabled={!analysisComplete || insightsBusy}>
              {insightsBusy ? "Reviewing…" : insights ? "Refresh review" : "Generate review"}
            </button>
          </div>
          {!insights ? (
            <p className="review-empty">Generate a cited review across security, performance, breaking changes, tests, and documentation.</p>
          ) : (
            <>
              <div className="risk-list">
                {Object.entries(insights.risks).map(([key, risk]) => (
                  <article className="risk-row" key={key}>
                    <span>{riskLabel(key)} / {risk.posture.replaceAll("_", " ")}</span>
                    <b>{risk.finding.statement}</b>
                    <p>{risk.finding.rationale}</p>
                    <CitationLinks citations={risk.finding.citations} />
                  </article>
                ))}
              </div>
              {insights.repairs.length > 0 && (
                <div className="repair-suggestion-list">
                  <p className="review-panel-label">Actionable repairs</p>
                  {insights.repairs.map((repair) => (
                    <article className="repair-suggestion" key={repair.id}>
                      <span>{repair.priority} priority{repair.targetPaths.length > 0 ? ` · ${repair.targetPaths.join(", ")}` : ""}</span>
                      <b>{repair.title}</b>
                      <p>{repair.action.statement}</p>
                      <small>{repair.action.rationale}</small>
                      <CitationLinks citations={repair.action.citations} />
                      <p className="repair-verification">Verify: {repair.verification.statement}</p>
                      <CitationLinks citations={repair.verification.citations} />
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {insightsError && <p className="review-error" role="alert">{insightsError}</p>}
        </section>
      </div>

      <div className="passport-export-row" aria-label="Export Change Passport">
        <span>Export this cited Passport</span>
        <div>
          <a className="passport-export-action" href={`/api/passports/${passport.id}/export?format=markdown`}>Markdown</a>
          <a className="passport-export-action" href={`/api/passports/${passport.id}/export?format=pdf`}>PDF</a>
        </div>
      </div>
    </section>
  );
}

import type {
  ForgeEvidence,
  ForgePassport,
  ForgePullRequest,
} from "@/domain/forge-workspace";

type EvidenceGroupKey = "source" | "analysis" | "unknowns" | "repairs";

const sourceEvidenceLabels = new Set(["Pull request", "Diff metadata", "Commit metadata"]);

const evidenceGroups: Array<{
  key: EvidenceGroupKey;
  label: string;
  description: string;
}> = [
  {
    key: "source",
    label: "Source facts",
    description: "Facts retained directly from the GitHub pull-request record.",
  },
  {
    key: "analysis",
    label: "Analysis findings",
    description: "Source-grounded claims returned by the completed AI analysis.",
  },
  {
    key: "unknowns",
    label: "Risks & unknowns",
    description: "Contradictions and blast-radius findings that require attention.",
  },
  {
    key: "repairs",
    label: "Required follow-up",
    description: "Source-grounded repair actions returned by the analysis.",
  },
];

function groupEvidence(entry: ForgeEvidence): EvidenceGroupKey {
  if (sourceEvidenceLabels.has(entry.label)) return "source";
  if (entry.kind === "contradiction") return "unknowns";
  if (entry.kind === "repair") return "repairs";
  return "analysis";
}

function evidenceType(entry: ForgeEvidence) {
  if (sourceEvidenceLabels.has(entry.label)) return "Source fact";
  if (entry.kind === "contradiction") return "AI contradiction";
  if (entry.kind === "repair") return "AI repair";
  if (entry.kind === "guarantee") return "AI guarantee";
  if (entry.kind === "intent") return "AI intent";
  return "AI finding";
}

function formatLines(entry: ForgeEvidence) {
  if (!entry.lineStart) return null;
  return entry.lineEnd && entry.lineEnd !== entry.lineStart
    ? `${entry.lineStart}–${entry.lineEnd}`
    : String(entry.lineStart);
}

function reviewStatus(passport: ForgePassport) {
  const answerCount = passport.review.messages.filter((message) => message.role === "assistant").length;
  if (passport.review.insights) return "Risk review ready";
  if (answerCount > 0) return `${answerCount} cited ${answerCount === 1 ? "answer" : "answers"}`;
  return passport.analysisStatus === "complete" ? "Not started" : "Blocked";
}

function analysisStatus(passport: ForgePassport, analyzing: boolean) {
  if (analyzing) return "In progress";
  if (passport.analysisStatus === "complete") return "Complete";
  if (passport.analysisStatus === "failed") return "Needs retry";
  if (passport.analysisStatus === "running") return "In progress";
  return "Not run";
}

interface PassportEvidenceProps {
  passport: ForgePassport;
  pullRequest: ForgePullRequest;
  activeEvidence: ForgeEvidence | null;
  analyzing: boolean;
  onSelectEvidence: (evidenceId: string) => void;
  registerControl: (evidenceId: string, element: HTMLButtonElement | null) => void;
}

export function PassportEvidence({
  passport,
  pullRequest,
  activeEvidence,
  analyzing,
  onSelectEvidence,
  registerControl,
}: PassportEvidenceProps) {
  const groupedEvidence = new Map<EvidenceGroupKey, ForgeEvidence[]>();
  for (const group of evidenceGroups) groupedEvidence.set(group.key, []);
  for (const entry of passport.evidence) groupedEvidence.get(groupEvidence(entry))?.push(entry);

  const sourceCount = groupedEvidence.get("source")?.length ?? 0;
  const analysisAvailable = passport.analysisStatus === "complete";
  const hasReview = passport.review.messages.length > 0 || passport.review.insights !== null;
  const decisionRecorded = passport.decision !== null;
  const effectiveAnalysisStatus = analysisStatus(passport, analyzing);

  const currentSteps = [
    { label: "Source", value: `PR #${pullRequest.number}`, state: "complete" },
    { label: "Evidence", value: `${sourceCount} source ${sourceCount === 1 ? "fact" : "facts"}`, state: sourceCount > 0 ? "complete" : "pending" },
    {
      label: "Analysis",
      value: effectiveAnalysisStatus,
      state: analyzing ? "working" : passport.analysisStatus === "complete" ? "complete" : passport.analysisStatus === "failed" ? "alert" : "pending",
    },
    { label: "Review", value: reviewStatus(passport), state: hasReview ? "complete" : "pending" },
    { label: "Decision", value: decisionRecorded ? "Recorded" : analysisAvailable ? "Pending" : "Blocked", state: decisionRecorded ? "complete" : analysisAvailable ? "alert" : "pending" },
  ];

  return (
    <section className="passport-evidence-record" id="passport-evidence" aria-labelledby="passport-evidence-title">
      <header className="passport-section-heading">
        <div>
          <p className="panel-label">Evidence Current</p>
          <h2 id="passport-evidence-title">Trace every claim to its source.</h2>
        </div>
        <span>{passport.evidence.length} retained · J / K to move</span>
      </header>

      <ol className="evidence-current-rail" aria-label="Change Passport chain of custody">
        {currentSteps.map((step, index) => (
          <li className={`is-${step.state}`} key={step.label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><small>{step.label}</small><b>{step.value}</b></div>
          </li>
        ))}
      </ol>

      <div className="evidence-explorer">
        <div className="evidence-group-list">
          {evidenceGroups.map((group) => {
            const entries = groupedEvidence.get(group.key) ?? [];
            if (entries.length === 0 && group.key === "source") return null;

            return (
              <section className={`evidence-group evidence-group-${group.key}`} key={group.key} aria-labelledby={`evidence-group-${group.key}`}>
                <header>
                  <div>
                    <h3 id={`evidence-group-${group.key}`}>{group.label}</h3>
                    <p>{group.description}</p>
                  </div>
                  <span>{entries.length}</span>
                </header>

                {entries.length === 0 ? (
                  <p className="evidence-group-empty">
                    {analysisAvailable
                      ? group.key === "unknowns"
                        ? "The completed analysis returned no contradiction or blast-radius evidence. This does not establish that risk is absent."
                        : group.key === "repairs"
                          ? "The completed analysis returned no additional entries in this group."
                          : "The completed analysis returned no entries in this group."
                      : analyzing
                        ? "Analysis evidence will appear here after citation validation completes."
                        : "Complete the analysis to populate source-grounded findings."}
                  </p>
                ) : (
                  <div className="evidence-entry-list">
                    {entries.map((entry) => {
                      const active = activeEvidence?.id === entry.id;
                      return (
                        <article className={`evidence-entry tone-${entry.tone}${active ? " is-active" : ""}`} key={entry.id}>
                          <button
                            type="button"
                            ref={(element) => registerControl(entry.id, element)}
                            onClick={() => onSelectEvidence(entry.id)}
                            onFocus={() => onSelectEvidence(entry.id)}
                            aria-current={active ? "true" : undefined}
                            aria-controls="active-evidence-detail"
                            data-evidence-control
                          >
                            <span>{String(entry.ordinal).padStart(2, "0")}</span>
                            <div>
                              <small>{evidenceType(entry)} · {entry.label}</small>
                              <b>{entry.title}</b>
                              <p>{entry.detail}</p>
                            </div>
                            <i aria-hidden="true">→</i>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <aside className={`evidence-inspector${activeEvidence ? ` tone-${activeEvidence.tone}` : ""}`} id="active-evidence-detail" aria-live="polite">
          {activeEvidence ? (
            <>
              <div className="evidence-inspector-head">
                <p>{evidenceType(activeEvidence)}</p>
                <span>{String(activeEvidence.ordinal).padStart(2, "0")} / {String(passport.evidence.length).padStart(2, "0")}</span>
              </div>
              <h3>{activeEvidence.title}</h3>
              <p>{activeEvidence.detail}</p>
              <dl>
                <div><dt>Source</dt><dd>{activeEvidence.source}</dd></div>
                {activeEvidence.sourcePath && <div><dt>Path</dt><dd>{activeEvidence.sourcePath}</dd></div>}
                {activeEvidence.commitSha && <div><dt>Commit</dt><dd>{activeEvidence.commitSha.slice(0, 12)}</dd></div>}
                {formatLines(activeEvidence) && <div><dt>Lines</dt><dd>{formatLines(activeEvidence)}</dd></div>}
              </dl>
              {activeEvidence.excerpt && <blockquote>{activeEvidence.excerpt}</blockquote>}
              {activeEvidence.sourceUrl ? (
                <a href={activeEvidence.sourceUrl} target="_blank" rel="noreferrer">Open cited source <span aria-hidden="true">↗</span></a>
              ) : (
                <span className="evidence-source-unavailable">No source URL was retained for this entry.</span>
              )}
            </>
          ) : (
            <div className="evidence-inspector-empty">
              <p>No retained evidence</p>
              <span>Forge has no evidence entry to inspect for this Passport.</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

import type { ForgePassport } from "@/domain/forge-workspace";

function verdictLabel(verdict: ForgePassport["verdict"]) {
  return verdict === "ship_with_conditions"
    ? "Ship with conditions"
    : verdict.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

interface PassportPreview {
  verdict: ForgePassport["verdict"];
  summary: string;
  condition: string;
  confidence: string;
}

interface ChangePassportCardProps {
  passport: PassportPreview;
  repository: string;
  changeNumber: number;
  recorded: boolean;
  recording: boolean;
  repairStaged: boolean;
  analysisComplete: boolean;
  evidenceCount: number;
  summaryEvidenceUrl: string | null;
  reviewState: string;
  onStageRepair: () => void;
  onRecord: () => void;
}

export function ChangePassportCard({
  passport,
  repository,
  changeNumber,
  recorded,
  recording,
  repairStaged,
  analysisComplete,
  evidenceCount,
  summaryEvidenceUrl,
  reviewState,
  onStageRepair,
  onRecord,
}: ChangePassportCardProps) {
  const decisionLabel = verdictLabel(passport.verdict);

  return (
    <aside className={"change-passport" + (recorded ? " is-recorded" : "")} aria-label="Change Passport verdict">
      <div className="passport-document-head"><p className="panel-label">Change Passport</p><span>FORGE / {String(changeNumber).padStart(4, "0")}</span></div>
      <div className="passport-verdict"><p>Evidence posture</p><h2>{decisionLabel}</h2><span>{reviewState.replaceAll("_", " ")}</span></div>
      <p className="passport-summary">{passport.summary}</p>
      {summaryEvidenceUrl && <a className="passport-summary-evidence" href={summaryEvidenceUrl} target="_blank" rel="noreferrer">Trace summary evidence ↗</a>}
      <div className="passport-condition">
        <span>Required before merge</span>
        <b>{repairStaged ? "Repair path staged. Re-run this Passport against the next commit." : passport.condition}</b>
      </div>
      <button className={"repair-action" + (repairStaged ? " is-staged" : "")} type="button" onClick={onStageRepair} aria-pressed={repairStaged}>
        <span className="repair-route" aria-hidden="true"><i /><i /><i /></span>
        <span><b>{repairStaged ? "Follow-up staged" : "Stage follow-up"}</b><small>{repairStaged ? "Forge will retain this follow-up alongside the source record." : "Mark a required follow-up without altering the GitHub pull request."}</small></span>
      </button>
      <dl className="passport-facts">
        <div><dt>Confidence</dt><dd>{passport.confidence}</dd></div>
        <div><dt>Repository</dt><dd>{repository}</dd></div>
        <div><dt>Evidence retained</dt><dd>{evidenceCount} cited sources</dd></div>
      </dl>
      <button className={"record-action" + (recording ? " is-recording" : "")} type="button" onClick={onRecord} disabled={!analysisComplete || recorded || recording}>
        <span>{recorded ? `${decisionLabel} recorded in Forge memory` : !analysisComplete ? "Analysis required before recording" : recording ? "Locking the decision" : `Record ${decisionLabel.toLowerCase()} decision`}</span>
        <span aria-hidden="true">{recorded ? "✓" : "↗"}</span>
      </button>
    </aside>
  );
}

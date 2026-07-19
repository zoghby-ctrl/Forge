import "server-only";

import PDFDocument from "pdfkit";
import type {
  ForgePassportReview,
  ForgeReviewCitation,
} from "@/domain/passport-review";
import type { ForgeUser } from "@/server/auth/session";
import { getPassportReviewFromPayload } from "@/server/passports/passport-extensions";
import {
  getCitationSourceUrl,
  loadPassportSourceForUser,
  type PassportSourceContext,
} from "@/server/passports/passport-source-service";
import { passportAnalysisSchema, type PassportCitation, type PassportGroundedClaim } from "@/server/openai/schema";

type PdfDocumentInstance = InstanceType<typeof PDFDocument>;

export type PassportExportFormat = "markdown" | "pdf";

type ExportClaim = {
  statement: string;
  rationale: string;
  citations: ForgeReviewCitation[];
};

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}\[\]<>])/g, "\\$1");
}

function citationLabel(citation: ForgeReviewCitation) {
  const line = citation.lineStart
    ? `:${citation.lineStart}${citation.lineEnd && citation.lineEnd !== citation.lineStart ? `-${citation.lineEnd}` : ""}`
    : "";
  if (citation.path) return `${citation.path}${line}`;
  if (citation.commitSha) return `commit ${citation.commitSha.slice(0, 12)}`;
  return "pull request";
}

function citationMarkdown(citation: ForgeReviewCitation) {
  const label = escapeMarkdown(citationLabel(citation));
  const link = citation.sourceUrl ? `[${label}](${citation.sourceUrl})` : label;
  return `${link} — ${escapeMarkdown(citation.note)}`;
}

function resolveAnalysisClaim(claim: PassportGroundedClaim, source: PassportSourceContext): ExportClaim {
  return {
    statement: claim.statement,
    rationale: claim.rationale,
    citations: claim.citations.map((citation: PassportCitation) => ({
      ...citation,
      sourceUrl: getCitationSourceUrl(citation, source.input),
    })),
  };
}

function renderClaimMarkdown(claim: ExportClaim, indent = "") {
  return [
    `${indent}- ${escapeMarkdown(claim.statement)}`,
    `${indent}  - ${escapeMarkdown(claim.rationale)}`,
    ...claim.citations.map((citation) => `${indent}  - Evidence: ${citationMarkdown(citation)}`),
  ].join("\n");
}

function verdictLabel(verdict: string) {
  return verdict.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function addClaimLines(lines: string[], title: string, claims: ExportClaim[]) {
  if (claims.length === 0) return;
  lines.push(`## ${title}`, "");
  lines.push(...claims.map((claim) => renderClaimMarkdown(claim)), "");
}

function renderMarkdown(source: PassportSourceContext, review: ForgePassportReview) {
  const analysisResult = passportAnalysisSchema.safeParse(source.passport.analysis_payload);
  const lines = [
    "# Forge Change Passport",
    "",
    `## ${escapeMarkdown(source.repositoryFullName)} · PR #${source.input.pullRequest.number}`,
    "",
    `[Open pull request](${source.input.pullRequest.htmlUrl})`,
    "",
    "## Source record",
    "",
    `- Title: ${escapeMarkdown(source.input.pullRequest.title)}`,
    `- Branches: \`${escapeMarkdown(source.input.pullRequest.baseRef)}\` → \`${escapeMarkdown(source.input.pullRequest.headRef)}\``,
    `- Commit: \`${source.input.pullRequest.headSha}\``,
    `- Changed files captured: ${source.input.files.length}`,
    `- Commits captured: ${source.input.commits.length}`,
    "",
  ];

  if (analysisResult.success) {
    const analysis = analysisResult.data;
    const intent = resolveAnalysisClaim(analysis.intent, source);
    lines.push(
      "## Decision",
      "",
      `- Verdict: **${verdictLabel(analysis.verdict)}**`,
      `- Confidence: ${analysis.confidence.score}% — ${escapeMarkdown(analysis.confidence.rationale)}`,
      `- Summary: ${escapeMarkdown(analysis.summary)}`,
      ...intent.citations.map((citation) => `  - Summary evidence: ${citationMarkdown(citation)}`),
      "",
      "## Intent",
      "",
      renderClaimMarkdown(intent),
      "",
    );
    addClaimLines(lines, "Guarantees", analysis.guarantees.map((claim) => resolveAnalysisClaim(claim, source)));
    addClaimLines(lines, "Evidence", analysis.evidence.map((claim) => resolveAnalysisClaim(claim, source)));
    addClaimLines(lines, "Contradictions", analysis.contradictions.map((claim) => resolveAnalysisClaim(claim, source)));
    addClaimLines(lines, "Blast radius", analysis.blastRadius.map((claim) => resolveAnalysisClaim(claim, source)));
    addClaimLines(lines, "Established repair plan", analysis.repairPlan.map((claim) => resolveAnalysisClaim(claim, source)));
  } else {
    lines.push("## Analysis", "", "This Passport has no completed AI analysis yet.", "");
  }

  if (review.insights) {
    lines.push("## Enhanced risk analysis", "");
    const risks = review.insights.risks;
    const labels: Array<[string, keyof typeof risks]> = [
      ["Security", "security"],
      ["Performance", "performance"],
      ["Breaking changes", "breakingChanges"],
      ["Missing tests", "missingTests"],
      ["Documentation", "documentation"],
    ];
    for (const [label, key] of labels) {
      const risk = risks[key];
      lines.push(`- **${label}: ${risk.posture.replaceAll("_", " ")}**`, `  - ${escapeMarkdown(risk.finding.statement)}`, `  - ${escapeMarkdown(risk.finding.rationale)}`);
      lines.push(...risk.finding.citations.map((citation) => `  - Evidence: ${citationMarkdown(citation)}`));
    }
    lines.push("");
    if (review.insights.repairs.length > 0) {
      lines.push("## Actionable repair suggestions", "");
      for (const repair of review.insights.repairs) {
        lines.push(`- **${escapeMarkdown(repair.title)}** (${repair.priority})`);
        lines.push(`  - Action: ${escapeMarkdown(repair.action.statement)}`, `  - ${escapeMarkdown(repair.action.rationale)}`);
        lines.push(...repair.action.citations.map((citation) => `  - Evidence: ${citationMarkdown(citation)}`));
        lines.push(`  - Verify: ${escapeMarkdown(repair.verification.statement)}`, `  - ${escapeMarkdown(repair.verification.rationale)}`);
        lines.push(...repair.verification.citations.map((citation) => `  - Verification evidence: ${citationMarkdown(citation)}`));
      }
      lines.push("");
    }
  }

  if (review.messages.length > 0) {
    lines.push("## AI review conversation", "");
    for (const message of review.messages) {
      if (message.role === "user") {
        lines.push(`### Question`, "", escapeMarkdown(message.content), "");
      } else {
        lines.push("### Forge answer", "", renderClaimMarkdown(message.answer), "");
      }
    }
  }

  lines.push("---", "Generated by Forge from the retained GitHub source record. Every AI conclusion above includes a source link.", "");
  return lines.join("\n");
}

function addPdfTitle(document: PdfDocumentInstance, value: string) {
  document.font("Helvetica-Bold").fontSize(18).fillColor("#111827").text(value, { paragraphGap: 8 });
}

function addPdfHeading(document: PdfDocumentInstance, value: string) {
  document.moveDown(0.5).font("Helvetica-Bold").fontSize(12).fillColor("#0f766e").text(value, { paragraphGap: 5 });
}

function addPdfText(document: PdfDocumentInstance, value: string, options: { indent?: number; url?: string } = {}) {
  document.font("Helvetica").fontSize(9.5).fillColor("#1f2937").text(value, {
    indent: options.indent ?? 0,
    paragraphGap: 3,
    link: options.url,
    underline: Boolean(options.url),
  });
}

function addPdfClaim(document: PdfDocumentInstance, claim: ExportClaim, indent = 0) {
  addPdfText(document, `• ${claim.statement}`, { indent });
  addPdfText(document, claim.rationale, { indent: indent + 12 });
  for (const citation of claim.citations) {
    addPdfText(document, `Evidence: ${citationLabel(citation)} — ${citation.note}`, {
      indent: indent + 12,
      url: citation.sourceUrl ?? undefined,
    });
  }
}

function renderPdf(source: PassportSourceContext, review: ForgePassportReview) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Forge Change Passport PR #${source.input.pullRequest.number}` } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    addPdfTitle(document, "Forge Change Passport");
    addPdfText(document, `${source.repositoryFullName} · PR #${source.input.pullRequest.number}`, { url: source.input.pullRequest.htmlUrl });
    addPdfHeading(document, "Source record");
    addPdfText(document, source.input.pullRequest.title);
    addPdfText(document, `${source.input.pullRequest.baseRef} → ${source.input.pullRequest.headRef}`);
    addPdfText(document, `${source.input.files.length} changed files · ${source.input.commits.length} commits`);

    const analysisResult = passportAnalysisSchema.safeParse(source.passport.analysis_payload);
    if (analysisResult.success) {
      const analysis = analysisResult.data;
      const intent = resolveAnalysisClaim(analysis.intent, source);
      addPdfHeading(document, "Decision");
      addPdfText(document, `${verdictLabel(analysis.verdict)} · ${analysis.confidence.score}% confidence`);
      addPdfText(document, analysis.summary);
      for (const citation of intent.citations) {
        addPdfText(document, `Summary evidence: ${citationLabel(citation)} — ${citation.note}`, { indent: 12, url: citation.sourceUrl ?? undefined });
      }
      addPdfHeading(document, "Intent");
      addPdfClaim(document, intent);
      const groups: Array<[string, PassportGroundedClaim[]]> = [
        ["Guarantees", analysis.guarantees],
        ["Evidence", analysis.evidence],
        ["Contradictions", analysis.contradictions],
        ["Blast radius", analysis.blastRadius],
        ["Repair plan", analysis.repairPlan],
      ];
      for (const [title, claims] of groups) {
        if (claims.length === 0) continue;
        addPdfHeading(document, title);
        for (const claim of claims) addPdfClaim(document, resolveAnalysisClaim(claim, source));
      }
    }

    if (review.insights) {
      addPdfHeading(document, "Enhanced risk analysis");
      for (const risk of Object.values(review.insights.risks)) {
        addPdfText(document, `${risk.category.replaceAll("_", " ")} · ${risk.posture.replaceAll("_", " ")}`);
        addPdfClaim(document, risk.finding, 12);
      }
      if (review.insights.repairs.length > 0) {
        addPdfHeading(document, "Actionable repair suggestions");
        for (const repair of review.insights.repairs) {
          addPdfText(document, `${repair.title} · ${repair.priority}`);
          addPdfClaim(document, repair.action, 12);
          addPdfText(document, "Verification", { indent: 12 });
          addPdfClaim(document, repair.verification, 24);
        }
      }
    }

    if (review.messages.length > 0) {
      addPdfHeading(document, "AI review conversation");
      for (const message of review.messages) {
        if (message.role === "user") {
          addPdfText(document, `Question: ${message.content}`);
        } else {
          addPdfClaim(document, message.answer);
        }
      }
    }
    document.end();
  });
}

export async function exportPassportForUser(input: {
  user: ForgeUser;
  passportId: string;
  format: PassportExportFormat;
}) {
  const source = await loadPassportSourceForUser(input.user, input.passportId);
  const review = getPassportReviewFromPayload(source.passport.analysis_payload);
  const baseName = `forge-change-passport-pr-${source.input.pullRequest.number}`;
  if (input.format === "markdown") {
    return {
      body: renderMarkdown(source, review),
      contentType: "text/markdown; charset=utf-8",
      filename: `${baseName}.md`,
    };
  }
  return {
    body: await renderPdf(source, review),
    contentType: "application/pdf",
    filename: `${baseName}.pdf`,
  };
}

import { describe, expect, it } from "vitest";
import { passportSchema } from "../../src/domain/contracts";

describe("passport contract", () => {
  it("accepts an evidence-backed hold", () => {
    const result = passportSchema.safeParse({
      verdict: "hold",
      summary: "A condition must be met before this change can ship.",
      conditions: ["Add a compatibility test."],
      evidence: [
        {
          path: "src/payments/refunds.ts",
          commitSha: "placeholder-sha",
          lineStart: 1,
          lineEnd: 4,
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});

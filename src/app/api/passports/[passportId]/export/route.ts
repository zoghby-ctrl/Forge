import { z } from "zod";
import { forgeIdSchema } from "@/domain/forge-workspace";
import { failure } from "@/server/api/response";
import { requireCurrentUser } from "@/server/auth/session";
import { exportPassportForUser } from "@/server/passports/export-service";

export const runtime = "nodejs";

const paramsSchema = z.object({ passportId: forgeIdSchema });
const formatSchema = z.enum(["markdown", "pdf"]);

export async function GET(request: Request, context: { params: Promise<{ passportId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const user = await requireCurrentUser();
    const { passportId } = paramsSchema.parse(await context.params);
    const format = formatSchema.parse(new URL(request.url).searchParams.get("format") ?? "markdown");
    const result = await exportPassportForUser({ user, passportId, format });
    const body = typeof result.body === "string" ? result.body : new Uint8Array(result.body);
    return new Response(body, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return failure(error, { requestId });
  }
}

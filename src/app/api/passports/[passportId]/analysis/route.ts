import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/session";
import { requireSameOrigin } from "@/server/api/request";
import { AppError } from "@/server/api/errors";
import { failure } from "@/server/api/response";
import { analyzePassportForUser, type PassportAnalysisProgress } from "@/server/passports/analysis-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const passportIdSchema = z.string().uuid();
const encoder = new TextEncoder();

function event(name: "progress" | "complete" | "error", data: unknown) {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function clientErrorMessage(error: unknown) {
  return error instanceof AppError
    ? error.message
    : "Forge could not complete this AI analysis. Please retry.";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ passportId: string }> },
) {
  const requestId = crypto.randomUUID();
  let passportId: string;
  let user: Awaited<ReturnType<typeof requireCurrentUser>>;

  try {
    requireSameOrigin(request);
    [user, { passportId }] = await Promise.all([requireCurrentUser(), params]);
    passportId = passportIdSchema.parse(passportId);
  } catch (error) {
    return failure(error, { requestId });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendProgress = (progress: PassportAnalysisProgress) => {
        controller.enqueue(event("progress", progress));
      };

      void (async () => {
        try {
          const result = await analyzePassportForUser({
            user,
            passportId,
            onProgress: sendProgress,
            requestId,
          });
          controller.enqueue(event("complete", result));
        } catch (error) {
          controller.enqueue(event("error", { message: clientErrorMessage(error) }));
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

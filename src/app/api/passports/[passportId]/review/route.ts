import { z } from "zod";
import { forgeIdSchema } from "@/domain/forge-workspace";
import { forgeReviewQuestionSchema } from "@/domain/passport-review";
import { failure } from "@/server/api/response";
import { requireSameOrigin } from "@/server/api/request";
import { AppError } from "@/server/api/errors";
import { requireCurrentUser } from "@/server/auth/session";
import { askPassportReviewForUser } from "@/server/passports/review-service";

export const runtime = "nodejs";

const paramsSchema = z.object({ passportId: forgeIdSchema });
const encoder = new TextEncoder();

function event(name: string, payload: unknown) {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function clientMessage(error: unknown) {
  return error instanceof AppError ? error.message : "Forge could not complete this AI review. Please retry.";
}

export async function POST(request: Request, context: { params: Promise<{ passportId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    requireSameOrigin(request);
    const user = await requireCurrentUser();
    const { passportId } = paramsSchema.parse(await context.params);
    const { question } = forgeReviewQuestionSchema.parse(await request.json());

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void askPassportReviewForUser({
          user,
          passportId,
          question,
          requestId,
          onProgress: (progress) => controller.enqueue(event("progress", progress)),
        }).then(({ review }) => {
          controller.enqueue(event("complete", { review }));
          controller.close();
        }).catch((error) => {
          controller.enqueue(event("error", { message: clientMessage(error) }));
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return failure(error, { requestId });
  }
}

import { forgeIdSchema, recordDecisionSchema } from "@/domain/forge-workspace";
import { failure, success } from "@/server/api/response";
import { requireCurrentUser } from "@/server/auth/session";
import { recordPassportDecisionForUser } from "@/server/workspace/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ passportId: string }> },
) {
  try {
    const [payload, { passportId }, user] = await Promise.all([
      request.json(),
      params,
      requireCurrentUser(),
    ]);
    const input = recordDecisionSchema.parse(payload);
    const result = await recordPassportDecisionForUser(user, forgeIdSchema.parse(passportId), input);
    return success(result, 201);
  } catch (error) {
    return failure(error);
  }
}

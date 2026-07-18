import { forgeIdSchema, stageRepairPathSchema } from "@/domain/forge-workspace";
import { failure, success } from "@/server/api/response";
import { requireCurrentUser } from "@/server/auth/session";
import { stagePassportRepairForUser } from "@/server/workspace/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ passportId: string }> },
) {
  try {
    const [payload, { passportId }, user] = await Promise.all([
      request.json(),
      params,
      requireCurrentUser(),
    ]);
    const input = stageRepairPathSchema.parse(payload);
    const result = await stagePassportRepairForUser(user, forgeIdSchema.parse(passportId), input);
    return success(result);
  } catch (error) {
    return failure(error);
  }
}

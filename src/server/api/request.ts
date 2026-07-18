import { AuthorizationError } from "@/server/api/errors";

/** Restrict cookie-authenticated JSON mutations to this Forge origin. */
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new AuthorizationError();
  }
}

import { ZodError } from "zod";
import { AppError, ValidationError } from "@/server/api/errors";
import { logError } from "@/server/observability/logger";

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

type FailureContext = {
  requestId?: string;
  integration?: "github";
  githubStage?: string;
  githubRepositoryId?: string;
};

function validationIssues(error: ZodError) {
  return error.issues.slice(0, 10).map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "request";
    return `${field}: ${issue.message}`;
  });
}

export function success<T>(data: T, status = 200) {
  return Response.json(
    { ok: true, data } satisfies ApiSuccess<T>,
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function failure(error: unknown, context: FailureContext = {}) {
  if (error instanceof ZodError) {
    logError("API validation failed", {
      requestId: context.requestId ?? crypto.randomUUID(),
      ...context,
      errorName: error.name,
      validationIssues: validationIssues(error),
    });
    const validationError = new ValidationError();
    return Response.json(
      { ok: false, error: { code: validationError.code, message: validationError.message } },
      { status: validationError.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (error instanceof AppError) {
    return Response.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // Keep implementation and provider details on the server. The structured log
  // is sufficient for operational diagnosis without leaking them to clients.
  logError("Unhandled API error", {
    requestId: context.requestId ?? crypto.randomUUID(),
    ...context,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return Response.json(
    { ok: false, error: { code: "INTERNAL_ERROR", message: "Forge could not complete that request." } },
    { status: 500, headers: { "Cache-Control": "private, no-store" } },
  );
}

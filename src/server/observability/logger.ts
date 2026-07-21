export interface LogContext {
  requestId?: string;
  reviewId?: string;
  passportId?: string;
  projectId?: string;
  integration?: "github" | "openai" | "groq";
  githubStage?: string;
  redirectOrigin?: string;
  redirectPath?: string;
  stateValidation?: "passed" | "failed";
  aiStage?: string;
  githubRepositoryId?: string;
  errorName?: string;
  errorCode?: string;
  authStage?: "magic_link" | "password_sign_in" | "password_sign_up";
  authStatus?: number;
  authErrorMessage?: string;
  githubStatus?: number | null;
  githubResponseBody?: string | null;
  openaiHttpStatus?: number | null;
  openaiRequestId?: string | null;
  openaiErrorType?: string | null;
  openaiErrorCode?: string | null;
  openaiErrorMessage?: string | null;
  openaiResponseBody?: unknown | null;
  groqHttpStatus?: number | null;
  groqRequestId?: string | null;
  groqErrorType?: string | null;
  groqErrorCode?: string | null;
  groqErrorMessage?: string | null;
  groqResponseBody?: unknown | null;
  aiAttempt?: number;
  validationIssues?: string[];
  session?: "present" | "missing";
}

export function logInfo(message: string, context: LogContext = {}) {
  console.info(JSON.stringify({ level: "info", message, ...context }));
}

export function logError(message: string, context: LogContext = {}) {
  console.error(JSON.stringify({ level: "error", message, ...context }));
}

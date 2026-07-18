export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class AuthenticationError extends AppError {
  constructor() {
    super("UNAUTHENTICATED", 401, "Sign in is required to continue.");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor() {
    super("FORBIDDEN", 403, "You do not have access to this Forge record.");
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super("NOT_FOUND", 404, `${resource} was not found.`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "The submitted data is invalid.") {
    super("VALIDATION_ERROR", 422, message);
    this.name = "ValidationError";
  }
}

export class DataAccessError extends AppError {
  constructor(operation: string) {
    super("DATA_ACCESS_ERROR", 500, `Forge could not ${operation}. Please try again.`);
    this.name = "DataAccessError";
  }
}

export class NotImplementedError extends AppError {
  constructor(feature: string) {
    super("NOT_IMPLEMENTED", 501, `${feature} is not implemented yet.`);
    this.name = "NotImplementedError";
  }
}

export class IntegrationUnavailableError extends AppError {
  constructor() {
    super("INTEGRATION_UNAVAILABLE", 503, "GitHub connection is not configured for this Forge environment.");
    this.name = "IntegrationUnavailableError";
  }
}

export class ReauthenticationRequiredError extends AppError {
  constructor() {
    super("GITHUB_RECONNECT_REQUIRED", 409, "GitHub access needs to be connected again.");
    this.name = "ReauthenticationRequiredError";
  }
}

export class UpstreamServiceError extends AppError {
  constructor(message = "GitHub could not complete that request. Please try again.") {
    super("GITHUB_UPSTREAM_ERROR", 502, message);
    this.name = "UpstreamServiceError";
  }
}

export class AIConfigurationError extends AppError {
  constructor() {
    super("OPENAI_CONFIGURATION_ERROR", 503, "Forge AI analysis is not configured for this environment.");
    this.name = "AIConfigurationError";
  }
}

export class AIAnalysisError extends AppError {
  constructor(message = "Forge could not complete this AI analysis. Please retry.") {
    super("OPENAI_ANALYSIS_FAILED", 502, message);
    this.name = "AIAnalysisError";
  }
}

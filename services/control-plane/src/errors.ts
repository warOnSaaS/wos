import type { ApiErrorCode } from "@waronsaas/contracts";

/** A business error with a contract error code. The router turns it into the `ApiError` envelope. */
export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

export const HTTP_STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  NOT_ELIGIBLE: 403,
  LEASE_NOT_HELD: 403,
  LEASE_EXPIRED: 409,
  RESOURCE_LOCKED: 409,
  LIMIT_REACHED: 409,
  VALIDATION_FAILED: 400,
  SCOPE_VIOLATION: 422,
  MANIFEST_REJECTED: 422,
  IDEMPOTENCY_MISMATCH: 422,
  RATE_LIMITED: 429,
  GITHUB_REQUIRED: 403,
  GITHUB_LINKED_ELSEWHERE: 409,
  GITHUB_RESERVED: 409,
  UPSTREAM_GITHUB: 502,
  INTERNAL: 500,
  NOT_ENTITLED: 403,
  DEPENDENCY_NOT_ENABLED: 409,
  DEPENDENT_ENABLED: 409,
};

export const fail = (code: ApiErrorCode, message: string, details?: unknown): never => {
  throw new ApiFailure(code, message, details);
};

export const notFound = (what: string): never => fail("NOT_FOUND", `${what} not found`);
export const conflict = (message: string, details?: unknown): never => fail("CONFLICT", message, details);

/** Postgres error codes that mean "a concurrent transition or invariant won": clients re-read (409). */
export function isConflictPgError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "23505" || code === "40001" || code === "40P01" || code === "23P01";
}

export function pgConstraint(err: unknown): string | null {
  return (err as { constraint_name?: string } | null)?.constraint_name ?? null;
}

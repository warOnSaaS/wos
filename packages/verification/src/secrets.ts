/**
 * Secret patterns for SECRET_DETECTED (S-16) and the platform repo's CI secret scan (S-8).
 *
 * SECURITY.md refers to "the secret patterns in SECURITY.md" but lists none (blocker
 * B-0004-verification). This list is the verification workstream's proposal: high-precision
 * patterns only, because a false positive blocks an honest submission.
 */
export interface SecretPattern {
  id: string;
  pattern: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { id: "private-key-block", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "github-fine-grained-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { id: "anthropic-api-key", pattern: /\bsk-ant-[a-z]+\d{2}-[A-Za-z0-9_-]{40,}/ },
  { id: "openai-api-key", pattern: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}/ },
  { id: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { id: "stripe-live-key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/ },
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: "resend-api-key", pattern: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b/ },
  {
    id: "postgres-url-with-password",
    // user:password@host where host is not a loopback name; placeholders like ${X} or <x> are not secrets.
    pattern:
      /\bpostgres(?:ql)?:\/\/[^\s:/@]+:(?![$<{])[^\s@/]{6,}@(?!(?:localhost|127\.0\.0\.1|\[::1\]|db|postgres)(?:[:/\s]|$))[A-Za-z0-9.-]+/,
  },
];

export interface SecretHit {
  id: string;
  line: number;
}

/** Scans text for secret patterns. Returns one hit per pattern (first line where it matches). */
export function scanForSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const { id, pattern } of SECRET_PATTERNS) {
    const m = pattern.exec(text);
    if (m) hits.push({ id, line: text.slice(0, m.index).split("\n").length });
  }
  return hits;
}

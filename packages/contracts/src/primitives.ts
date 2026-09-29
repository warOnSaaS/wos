import { z } from "zod";

/**
 * Primitive value schemas shared by every contract.
 * Identifiers are UUIDv7 strings minted by the control plane (time-ordered, index friendly).
 * Human-facing keys (target slug, feature key, ABU key) are stable, lowercase and URL safe.
 */

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

/** ISO-8601 timestamp with offset, always produced by the server clock. */
export const Timestamp = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

/** Full 40-hex git object id (SHA-1 repos; GitHub does not serve SHA-256 repos). */
export const GitSha = z.string().regex(/^[0-9a-f]{40}$/, "40 lowercase hex characters");
export type GitSha = z.infer<typeof GitSha>;

/** sha256 digest, lowercase hex, prefixed so the algorithm is never ambiguous. */
export const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/, "sha256:<64 hex>");
export type Sha256 = z.infer<typeof Sha256>;

/** e.g. "salesforce". Matches apps/web/data/targets.ts slugs. */
export const TargetSlug = z.string().regex(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/, "lowercase slug, 3-40 chars");
export type TargetSlug = z.infer<typeof TargetSlug>;

/** Capability key, unique inside ONE application's roadmap, e.g. "crm" for Salesforce. */
export const CapabilityKey = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export type CapabilityKey = z.infer<typeof CapabilityKey>;

/**
 * GLOBAL Feature Catalog key (D10), app-independent, e.g. "contacts", "threaded-messaging",
 * "e-signature-envelope". Never reused once merged, even if aliased.
 */
export const FeatureKey = z.string().regex(/^[a-z][a-z0-9-]{1,48}[a-z0-9]$/);
export type FeatureKey = z.infer<typeof FeatureKey>;

/** Requirement key inside a feature contract, e.g. "R-003". */
export const RequirementKey = z.string().regex(/^R-\d{3}$/);
export type RequirementKey = z.infer<typeof RequirementKey>;

/** ABU key: "<featureKey>#<nn>", e.g. "contacts#04". Unique within a contract version. */
export const AbuKey = z.string().regex(/^[a-z][a-z0-9-]{1,48}[a-z0-9]#\d{2}$/);
export type AbuKey = z.infer<typeof AbuKey>;

/** Inventory item key, e.g. "INV-0042". */
export const InventoryItemKey = z.string().regex(/^INV-\d{4}$/);
export type InventoryItemKey = z.infer<typeof InventoryItemKey>;

/** "owner/name" on github.com. Owner is always "waronsaas" for official repos (D4). */
export const RepoFullName = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);
export type RepoFullName = z.infer<typeof RepoFullName>;

export const OFFICIAL_GITHUB_ORG = "waronsaas" as const;
/** wOS itself + the public website. Renamed from waronsaas/wos (D14). */
export const PLATFORM_REPO = "waronsaas/wos" as const;
/**
 * The ONE product repository holding every replacement app (D10: shared features => shared code).
 * DECIDED by the founder 2026-09-29 (GAPS.md G-05): "waronsaas/product" (founder override of the earlier "waronsaas/replacements"). Web and
 * mobile (React Native + Expo) apps of every replacement live here (D13).
 */
export const PRODUCT_REPO = "waronsaas/product" as const;

export const GithubLogin = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
export type GithubLogin = z.infer<typeof GithubLogin>;

/**
 * Repo-relative POSIX path. No leading slash, no "..", no backslashes, no NUL,
 * no ".git" segment. Case-sensitive. Validation of symlinks/modes happens on changesets.
 */
export const RepoPath = z
  .string()
  .min(1)
  .max(400)
  .refine((p) => !p.startsWith("/"), "must be relative")
  .refine((p) => !p.includes("\\"), "POSIX separators only")
  .refine((p) => !p.includes("\u0000"), "no NUL")
  .refine((p) => p.split("/").every((seg) => seg !== ".." && seg !== "." && seg !== ""), "no empty, '.' or '..' segments")
  .refine((p) => p.split("/").every((seg) => seg.toLowerCase() !== ".git"), "no .git segment");
export type RepoPath = z.infer<typeof RepoPath>;

/**
 * Write-scope pattern. Deliberately restricted so overlap between two scopes is decidable
 * by prefix comparison (see BUILD-PROTOCOL.md "Scope algebra"):
 *   - an exact file path:            "src/contacts/list.ts"
 *   - a directory subtree:           "src/contacts/**"
 * Wildcards anywhere else are rejected.
 */
export const WriteScope = z.string().refine((s) => {
  const base = s.endsWith("/**") ? s.slice(0, -3) : s;
  return RepoPath.safeParse(base).success && !/[*?[\]{}!]/.test(base);
}, "exact path or '<dir>/**' only");
export type WriteScope = z.infer<typeof WriteScope>;

/** Read-scope patterns may be any picomatch glob over repo paths (reads never conflict). */
export const ReadGlob = z.string().min(1).max(400);
export type ReadGlob = z.infer<typeof ReadGlob>;

/** Integer basis points 0..10000. All progress is exchanged in basis points, never floats. */
export const BasisPoints = z.number().int().min(0).max(10_000);
export type BasisPoints = z.infer<typeof BasisPoints>;

/** Whole WOS tokens. Signed so the ledger can express debits (D3). */
export const TokenAmount = z.number().int().safe();
export type TokenAmount = z.infer<typeof TokenAmount>;

export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/);

/** Cursor for paginated feeds: opaque to clients. */
export const Cursor = z.string().max(200);

export const Page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: Cursor.nullable() });

/**
 * Client surfaces a product ships (D13). "ios" covers iPhone and iPad; "desktop" covers the vendor's
 * desktop apps (platforms listed in the inventory); "cli" exists for TGT-00 (wOS ships a CLI).
 */
export const Surface = z.enum(["web", "ios", "android", "desktop", "api", "cli", "browser_extension", "email_addin", "other"]);
export type Surface = z.infer<typeof Surface>;

/**
 * Browsers the web surface's acceptance runs in (D13 browser parity, decided 2026-09-29): current Chrome
 * (chromium) and Edge, Safari on macOS (webkit) and iOS (mobile_safari, phone viewport), Firefox, and a
 * phone-sized Android viewport (mobile_chrome). Desktop and phone viewports both.
 */
export const Browser = z.enum(["chromium", "edge", "webkit", "firefox", "mobile_safari", "mobile_chrome"]);
export type Browser = z.infer<typeof Browser>;
/**
 * Tool names shared by ToolchainAttestation and wos.json toolchainRequirements (contracts 4.2.0, B-0006-github-build).
 * Extendable (MINOR). Versions compare as dotted numeric prefixes: "16.2" >= "16.1.3"; trailing non-numeric
 * text is ignored ("16.2 (build 16C5032a)" -> 16.2).
 */
export const ToolName = z.enum(["node", "xcode", "android-sdk"]);
export type ToolName = z.infer<typeof ToolName>;

/** Numeric dotted-prefix version comparison used by toolchain eligibility. Returns -1, 0 or 1. */
export function compareToolVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => (/^\s*v?(\d+(?:\.\d+)*)/.exec(v)?.[1] ?? "0").split(".").map(Number);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export const MINIMUM_BROWSERS = ["chromium", "edge", "webkit", "firefox", "mobile_safari", "mobile_chrome"] as const;

/**
 * Deterministic build-graph validation (FEATURE-CONTRACT.md section 3 "Build graph validity" and the D13
 * additions). Runs on every contract revision before a round opens; any issue sends the document back to
 * `revising` with these issues carried into the next author task.
 *
 * Output order is deterministic: checks in the order below, ABUs in graph order within each check.
 */
import {
  type AbuSpec,
  type ArchElement,
  type AgentPolicyDocument,
  ARTIFACT_PATHS,
  type BuildGraph,
  type BuildGraphErrorCode,
  type FeatureContract,
  PLATFORM_REPO,
  PRODUCT_REPO,
  type RepoManifest,
  type Surface,
} from "@waronsaas/contracts";
import { ALWAYS_PROTECTED, fold, inScope, scopesOverlap } from "@waronsaas/verification";
import { isLiteralGlob, scopeCanTouchGlob } from "./globs.js";

export interface BuildGraphIssue {
  code: BuildGraphErrorCode;
  abu: string | null;
  message: string;
}

/**
 * Official repositories and their family (the seed rows of migration 0005 `wos.repositories`). The fallback
 * registry when `validateBuildGraph` is called without a context (B-0001-planning reading 1, ratified).
 */
export const REPOSITORY_FAMILIES: ReadonlyMap<string, RepositoryFamily> = new Map([
  [PLATFORM_REPO, "platform"],
  [PRODUCT_REPO, "product"],
]);

/**
 * The sixth argument (contracts 4.2.0, FEATURE-CONTRACT.md section 9, B-0001-planning). The control plane
 * passes `wos.repositories`, the contract document's repository and, per profile app, the surfaces in scope for
 * this feature (`app_feature_surfaces`). Without it the ratified fallbacks apply: the family of the first
 * registered ABU, and each profile's acceptance surfaces as its in-scope surfaces.
 */
export interface BuildGraphContext {
  repositories: ReadonlyMap<string, RepositoryFamily>;
  contractRepo: string;
  surfacesInScope?: ReadonlyMap<string, readonly Surface[]>;
  /**
   * D60 (contracts 5.5.0): the live architectural elements (`architectureRegistry` of the merged records). When
   * given, the ARCH_* rules run; callers that do not pass it (everything before the control plane serves D60) are
   * unaffected.
   */
  architecture?: ReadonlyMap<string, ArchElement>;
  /** Set when the graph is an architecture record's migration graph (feature `adr-nnn`): the record's changed elements. */
  architectureChanges?: ReadonlySet<string>;
}
export type RepositoryFamily = "platform" | "product";

/** Surfaces served by the React Native app (D13): native capabilities there need native ABUs. */
const NATIVE_SURFACES: ReadonlySet<Surface> = new Set(["ios", "android"]);

const baseOf = (scope: string) => (scope.endsWith("/**") ? scope.slice(0, -3) : scope);

/** Is the write scope inside `<root>/` (a tree scope may be the root itself)? */
function scopeUnder(scope: string, root: string): boolean {
  const base = baseOf(scope);
  return base.startsWith(`${root}/`) || (scope.endsWith("/**") && base === root);
}

const foldedOverlap = (a: string, b: string) => scopesOverlap(fold(a), fold(b));

function holds(abu: AbuSpec, key: string, mode?: "exclusive"): boolean {
  return abu.resources.some((r) => r.key === key && (mode === undefined || r.mode === mode));
}

/** Tarjan's strongly connected components over known dependencies, in graph order. */
function stronglyConnected(keys: string[], deps: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };
  for (const k of keys) if (!idx.has(k)) visit(k);
  return out;
}

export function validateBuildGraph(
  graph: BuildGraph,
  contract: FeatureContract,
  repo: RepoManifest,
  estimateBuilderContextTokens: (abuKey: string) => number,
  policy: AgentPolicyDocument,
  context?: BuildGraphContext,
): BuildGraphIssue[] {
  const out: BuildGraphIssue[] = [];
  const add = (code: BuildGraphErrorCode, abu: string | null, message: string) => out.push({ code, abu, message });
  const feature = contract.feature;
  const abus = graph.abus;

  // --- keys ---
  if (graph.feature !== feature)
    add("KEY_NOT_IN_FEATURE", null, `BUILD-GRAPH.yaml is for ${graph.feature} but CONTRACT.yaml is for ${feature}`);
  // contracts 4.2.0 (B-0001-planning reading 7), integration glue.
  if (graph.contractVersion !== contract.version)
    add(
      "CONTRACT_VERSION_MISMATCH",
      null,
      `BUILD-GRAPH.yaml is for contract version ${graph.contractVersion} but CONTRACT.yaml is version ${contract.version}`,
    );
  const byKey = new Map<string, AbuSpec>();
  for (const a of abus) {
    if (byKey.has(a.key)) add("DUPLICATE_KEY", a.key, `ABU key ${a.key} is used more than once`);
    else byKey.set(a.key, a);
    if (!a.key.startsWith(`${feature}#`)) add("KEY_NOT_IN_FEATURE", a.key, `ABU key ${a.key} must start with ${feature}#`);
  }
  const keys = [...byKey.keys()];

  // --- dependencies ---
  const deps = new Map<string, string[]>();
  for (const a of abus) {
    const known: string[] = [];
    for (const d of a.dependsOn) {
      if (byKey.has(d)) known.push(d);
      else add("UNKNOWN_DEPENDENCY", a.key, `${a.key} depends on ${d}, which is not in this build graph`);
    }
    deps.set(a.key, [...(deps.get(a.key) ?? []), ...known]);
  }
  for (const comp of stronglyConnected(keys, deps)) {
    const self = comp.length === 1 && (deps.get(comp[0]!) ?? []).includes(comp[0]!);
    if (comp.length > 1 || self) {
      const members = keys.filter((k) => comp.includes(k));
      add("CYCLE", members[0]!, `dependency cycle: ${members.join(", ")}`);
    }
  }
  /** Transitive dependencies of each ABU (terminates on cycles). */
  const ancestors = new Map<string, Set<string>>();
  for (const k of keys) {
    const seen = new Set<string>();
    const todo = [...(deps.get(k) ?? [])];
    while (todo.length > 0) {
      const d = todo.pop()!;
      if (seen.has(d)) continue;
      seen.add(d);
      todo.push(...(deps.get(d) ?? []));
    }
    ancestors.set(k, seen);
  }
  const ordered = (a: string, b: string) => ancestors.get(a)!.has(b) || ancestors.get(b)!.has(a);

  // --- requirements ---
  const reqs = new Map(contract.requirements.map((r) => [r.key, r]));
  const coveredBy = new Map<string, string[]>();
  for (const a of abus) {
    for (const r of a.requirements) {
      if (!reqs.has(r))
        add("UNKNOWN_REQUIREMENT", a.key, `${a.key} implements ${r}, which is not a requirement of ${feature} v${contract.version}`);
      else coveredBy.set(r, [...(coveredBy.get(r) ?? []), a.key]);
    }
  }
  const uncovered = new Set<string>();
  for (const p of contract.profiles) {
    for (const r of p.requirements) {
      if (!reqs.has(r)) add("UNKNOWN_REQUIREMENT", null, `profile ${p.target} lists ${r}, which is not a requirement of ${feature}`);
      else if (!coveredBy.has(r) && !uncovered.has(r)) {
        uncovered.add(r);
        add("REQUIREMENT_UNCOVERED", null, `${r} is in profile ${p.target} but no ABU implements it`);
      }
    }
  }

  // --- D13: repositories (reading 1): with a context the graph's family is the contract repository's ---
  const registry = context?.repositories ?? REPOSITORY_FAMILIES;
  const families = abus.map((a) => registry.get(a.repo) ?? null);
  const graphFamily = context ? (registry.get(context.contractRepo) ?? null) : (families.find((f) => f !== null) ?? null);

  // --- scopes (reading 6: platform-family graphs may write any path that is not protected) ---
  const protectedScopes = [...ALWAYS_PROTECTED, ...repo.protectedPaths, ...repo.generatedPaths];
  const shells = repo.apps.length > 0 ? [...new Set(repo.apps.map((x) => x.path))] : [ARTIFACT_PATHS.webApp, ARTIFACT_PATHS.mobileApp];
  const roots = [ARTIFACT_PATHS.module(feature), `${ARTIFACT_PATHS.acceptanceDir(feature)}`, ...shells];
  for (const a of abus) {
    for (const s of a.scope.write) {
      const hit = protectedScopes.find((p) => foldedOverlap(s, p));
      if (hit !== undefined) add("WRITE_SCOPE_PROTECTED", a.key, `${a.key} write scope ${s} overlaps protected or generated path ${hit}`);
      if (graphFamily !== "platform" && !roots.some((r) => scopeUnder(s, r)))
        add("WRITE_OUTSIDE_MODULE_OR_PRODUCT", a.key, `${a.key} write scope ${s} is outside ${roots.map((r) => `${r}/`).join(", ")}`);
    }
  }

  // --- parallel safety ---
  for (let i = 0; i < abus.length; i++) {
    for (let j = i + 1; j < abus.length; j++) {
      const a = abus[i]!;
      const b = abus[j]!;
      if (a.key === b.key || ordered(a.key, b.key)) continue;
      const overlap = a.scope.write.flatMap((x) => b.scope.write.filter((y) => foldedOverlap(x, y)).map((y) => `${x} / ${y}`));
      if (overlap.length > 0)
        add(
          "PARALLEL_WRITE_OVERLAP",
          b.key,
          `${a.key} and ${b.key} can run in parallel (no dependency path) but their write scopes overlap: ${overlap.join("; ")}`,
        );
      const shared = a.resources.filter((r) =>
        b.resources.some((q) => q.key === r.key && (q.mode === "exclusive" || r.mode === "exclusive")),
      );
      for (const r of shared)
        add(
          "PARALLEL_EXCLUSIVE_RESOURCE",
          b.key,
          `${a.key} and ${b.key} can run in parallel but both claim ${r.key} and at least one claim is exclusive`,
        );
    }
  }

  // --- resources that gate special paths ---
  for (const a of abus) {
    for (const lf of repo.lockfiles) {
      if (a.scope.write.some((s) => inScope(fold(lf), fold(s))) && !holds(a, `lockfile:${lf}`, "exclusive"))
        add("LOCKFILE_WITHOUT_RESOURCE", a.key, `${a.key} can write lockfile ${lf}; it must claim lockfile:${lf} exclusive`);
    }
    const toolchain = new Set<string>();
    for (const s of a.scope.write) {
      for (const g of repo.toolchainPaths) {
        if (!s.endsWith("/**")) {
          if (scopeCanTouchGlob(s, g)) toolchain.add(s);
        } else if (isLiteralGlob(g) && inScope(fold(g), fold(s))) toolchain.add(g);
      }
    }
    for (const p of toolchain)
      if (!holds(a, `toolchain:${p}`, "exclusive"))
        add("TOOLCHAIN_WITHOUT_RESOURCE", a.key, `${a.key} writes toolchain file ${p}; it must claim toolchain:${p} exclusive`);
    if (
      repo.migrationsDir &&
      a.scope.write.some((s) => foldedOverlap(s, `${repo.migrationsDir}/**`)) &&
      !holds(a, "db:migrations", "exclusive")
    )
      add("MIGRATION_WITHOUT_RESOURCE", a.key, `${a.key} can write under ${repo.migrationsDir}; it must claim db:migrations exclusive`);
    for (const t of a.acceptance.tests)
      if (!a.scope.write.some((s) => inScope(t, s)))
        add("TEST_OUTSIDE_SCOPE", a.key, `${a.key} acceptance test ${t} is outside its write scope`);
  }

  // --- architectural elements (D60) ---
  const archRegistry = context?.architecture;
  if (archRegistry) {
    const declared = new Set(contract.architecture ?? []);
    for (const k of declared)
      if (!archRegistry.has(k))
        add("ARCH_ELEMENT_UNKNOWN", null, `CONTRACT.yaml relies on ${k}, which no merged architecture record defines`);
    for (const a of abus) {
      for (const r of a.resources.filter((x) => x.key.startsWith("arch:"))) {
        if (!archRegistry.has(r.key) && !context?.architectureChanges?.has(r.key))
          add("ARCH_ELEMENT_UNKNOWN", a.key, `${a.key} declares ${r.key}, which no merged architecture record defines`);
        else if (r.mode === "exclusive" && !context?.architectureChanges?.has(r.key))
          add(
            "ARCH_CHANGE_OUTSIDE_RECORD",
            a.key,
            `${a.key} claims ${r.key} exclusive; only an architecture record's migration ABUs change an element`,
          );
        if (!context?.architectureChanges && !declared.has(r.key))
          add("ARCH_NOT_IN_CONTRACT", a.key, `${a.key} relies on ${r.key}; list it in the contract's architecture`);
      }
      for (const el of archRegistry.values()) {
        if (holds(a, el.key)) continue;
        const touches = a.scope.write.some((s) => el.paths.some((p) => foldedOverlap(s, p)));
        if (touches) add("ARCH_PATH_WITHOUT_RESOURCE", a.key, `${a.key} can write paths governed by ${el.key}; it must declare ${el.key}`);
      }
    }
  }

  // --- context budget ---
  const builder = policy.roles.find((r) => r.role === "builder");
  const budget = builder?.contextBudgetTokens ?? 0;
  for (const a of abus) {
    const est = estimateBuilderContextTokens(a.key);
    if (!Number.isFinite(est) || est > budget)
      add("OVER_CONTEXT_BUDGET", a.key, `${a.key} needs an estimated ${est} tokens of builder context; the budget is ${budget}. Split it.`);
  }

  // --- D13: repositories ---
  if (context && graphFamily === null)
    add("ABU_REPO_UNKNOWN", null, `the contract's repository ${context.contractRepo} is not a registered warOnSaaS repository`);
  abus.forEach((a, i) => {
    const fam = families[i];
    if (fam === null || fam === undefined)
      add("ABU_REPO_UNKNOWN", a.key, `${a.key} names repository ${a.repo}, which is not a registered warOnSaaS repository`);
    else if (graphFamily !== null && fam !== graphFamily)
      add("ABU_REPO_UNKNOWN", a.key, `${a.key} is in ${a.repo} (${fam} family) but this graph's ABUs are in the ${graphFamily} family`);
  });

  // --- D13: surfaces and the shared API ---
  const reqSurfaces = new Set(contract.requirements.flatMap((r) => r.surfaces));
  if (reqSurfaces.size > 1 && (contract.sharedApi ?? "").trim().length === 0)
    add(
      "SHARED_API_MISSING",
      null,
      `requirements span ${[...reqSurfaces].sort().join(", ")}; sharedApi must describe the typed API in modules/${feature} they all consume`,
    );

  const repoSurfaces = new Set(repo.apps.map((x) => x.surface));
  /** An app's in-scope surfaces: its roadmap's (context) or, without a context, its profile's acceptance suites. */
  const inScopeFor = (p: FeatureContract["profiles"][number]): ReadonlySet<string> => {
    const fromRoadmap = context?.surfacesInScope?.get(p.target);
    return new Set(fromRoadmap ?? p.acceptance.map((x) => x.surface));
  };
  for (const r of contract.requirements) {
    const profiles = contract.profiles.filter((p) => p.requirements.includes(r.key));
    for (const s of r.surfaces) {
      if (repo.apps.length > 0 && !repoSurfaces.has(s))
        add("REQUIREMENT_SURFACE_NOT_IN_SCOPE", null, `${r.key} is tagged ${s}, but wos.json has no app shell for ${s}`);
      else if (profiles.length > 0 && !profiles.some((p) => inScopeFor(p).has(s)))
        add(
          "REQUIREMENT_SURFACE_NOT_IN_SCOPE",
          null,
          `${r.key} is tagged ${s}, but no profile that lists it (${profiles.map((p) => p.target).join(", ")}) has ${s} in scope${context?.surfacesInScope ? " in its roadmap" : " (an acceptance suite for it)"}`,
        );
    }
  }

  // --- D13: journeys ---
  const journeySurfaces = new Set(contract.journeys.map((j) => j.surface));
  for (const s of [...reqSurfaces].sort())
    if (!journeySurfaces.has(s)) add("JOURNEY_UNCOVERED", null, `requirements are tagged ${s} but the contract has no journey on ${s}`);
  for (const j of contract.journeys) {
    const known = j.requirements.filter((r) => reqs.has(r));
    for (const r of j.requirements)
      if (!reqs.has(r)) add("UNKNOWN_REQUIREMENT", null, `journey ${j.key} links ${r}, which is not a requirement of ${feature}`);
    if (!known.some((r) => reqs.get(r)!.surfaces.includes(j.surface)))
      add("JOURNEY_UNCOVERED", null, `journey ${j.key} (${j.surface}) links no requirement tagged ${j.surface}`);
    // A requirement already reported REQUIREMENT_UNCOVERED is not reported again through its journeys.
    for (const r of known)
      if (!coveredBy.has(r) && !uncovered.has(r)) add("JOURNEY_UNCOVERED", null, `journey ${j.key} links ${r}, which no ABU implements`);
    if (!contract.profiles.some((p) => p.acceptance.some((x) => x.surface === j.surface) && known.some((r) => p.requirements.includes(r))))
      add("JOURNEY_UNCOVERED", null, `journey ${j.key} (${j.surface}) is exercised by no profile's ${j.surface} acceptance suite`);

    // --- D13: native capabilities ---
    if (j.nativeCapabilities.length > 0 && NATIVE_SURFACES.has(j.surface)) {
      const native = abus.some(
        (a) =>
          a.requirements.some((r) => known.includes(r)) &&
          a.scope.write.some((s) => repo.toolchainRequirements.some((t) => t.paths.some((g) => scopeCanTouchGlob(s, g)))),
      );
      if (!native)
        add(
          "NATIVE_CAPABILITY_UNPLANNED",
          null,
          `journey ${j.key} (${j.surface}) needs ${j.nativeCapabilities.join(", ")} but no ABU implementing its requirements writes a native path (wos.json toolchainRequirements)`,
        );
    }
  }
  return out;
}

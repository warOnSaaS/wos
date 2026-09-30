/** Types for publish-build-release.mjs (the script is plain ESM so it runs with `node` after building contracts). */
import type { AppRegistryEntry, AppReleaseView, AppRoutes } from "@waronsaas/contracts";

export declare const BUILD_MANIFEST_PATH: string;
export type BuildReleaseBody = (typeof AppRoutes.publishAppRelease.body)["_output"];
export declare function buildReleaseBody(manifestJson: unknown, commit: string): BuildReleaseBody;
export declare function publishBuildRelease(input: {
  api: string;
  email: string;
  body: BuildReleaseBody;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readCode: () => Promise<string>;
  log: (line: string) => void;
  dryRun?: boolean;
}): Promise<
  | { status: "exists"; release: AppReleaseView }
  | { status: "dry-run"; body: BuildReleaseBody }
  | { status: "published"; entry: AppRegistryEntry }
>;

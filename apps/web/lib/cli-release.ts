/**
 * Whether the wOS CLI is released, read from the GitHub API at build and every hour after (ISR). Never typed by hand:
 * the site says "not released yet" until github.com/warOnSaaS/wos has a published release tagged cli@<version>
 * (made by .github/workflows/cli-release.yml). If GitHub cannot be read, the site says so instead of guessing.
 */
import { LINKS } from "./site";

export const CLI_RELEASES_API = "https://api.github.com/repos/warOnSaaS/wos/releases?per_page=100";
/** One hour: the unauthenticated GitHub API allows 60 requests an hour per address. */
export const CLI_RELEASE_REVALIDATE = 3600;

export const INSTALL_SH_URL = "https://waronsaas.com/install.sh";
export const INSTALL_PS1_URL = "https://waronsaas.com/install.ps1";
export const INSTALL = {
  unix: `curl -fsSL ${INSTALL_SH_URL} | sh`,
  windows: `irm ${INSTALL_PS1_URL} | iex`,
} as const;

export type CliRelease =
  | { state: "released"; version: string; tag: string; url: string; publishedAt: string }
  | { state: "not_released" }
  | { state: "unknown" };

type GhRelease = { tag_name: string; html_url: string; draft: boolean; prerelease: boolean; published_at: string | null };

export async function getCliRelease(): Promise<CliRelease> {
  try {
    const res = await fetch(CLI_RELEASES_API, {
      headers: { accept: "application/vnd.github+json", "user-agent": "waronsaas-web" },
      next: { revalidate: CLI_RELEASE_REVALIDATE },
    });
    if (!res.ok) return { state: "unknown" };
    const list = (await res.json()) as GhRelease[];
    const rel = list.find((r) => r.tag_name.startsWith("cli@") && !r.draft && !r.prerelease);
    if (!rel) return { state: "not_released" };
    return { state: "released", version: rel.tag_name.slice(4), tag: rel.tag_name, url: rel.html_url, publishedAt: (rel.published_at ?? "").slice(0, 10) };
  } catch {
    return { state: "unknown" };
  }
}

/** One honest line about the CLI, for pages and the agent files. */
export function cliReleaseLine(r: CliRelease): string {
  switch (r.state) {
    case "released":
      return `The wOS CLI ${r.version} is released (${r.publishedAt}, ${r.url}).`;
    case "not_released":
      return `The wOS CLI is not released yet: ${LINKS.repo} has no cli@ release, so the install command below refuses until one exists.`;
    case "unknown":
      return `The wOS CLI release could not be checked when this page was built; see ${LINKS.repo}/releases for a cli@ release.`;
  }
}

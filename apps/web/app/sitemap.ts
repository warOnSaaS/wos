import type { MetadataRoute } from "next";
import { targets } from "@/data/targets";
import { abs } from "@/lib/seo";
import { WHITEPAPER_META } from "@/lib/whitepaper";

// No lastModified, except for the white paper, whose date comes from git (never typed by hand).
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["/", "/briefing", "/how-it-works", "/download", "/tokens", "/leaderboard", "/faq", "/about", "/log", "/targets/waronsaas"];
  return [
    ...pages.map((p) => ({ url: abs(p), changeFrequency: "weekly" as const, priority: p === "/" ? 1 : 0.7 })),
    {
      url: abs("/whitepaper"),
      changeFrequency: "weekly" as const,
      priority: 0.8,
      ...(WHITEPAPER_META.lastUpdated ? { lastModified: WHITEPAPER_META.lastUpdated } : {}),
    },
    ...targets.map((t) => ({ url: abs(`/targets/${t.slug}`), changeFrequency: "weekly" as const, priority: 0.9 })),
  ];
}

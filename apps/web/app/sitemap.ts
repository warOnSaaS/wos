import type { MetadataRoute } from "next";
import { targets } from "@/data/targets";
import { abs } from "@/lib/seo";

// No lastModified: we do not publish invented dates.
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["/", "/briefing", "/how-it-works", "/download", "/tokens", "/leaderboard", "/faq", "/about", "/targets/waronsaas"];
  return [
    ...pages.map((p) => ({ url: abs(p), changeFrequency: "weekly" as const, priority: p === "/" ? 1 : 0.7 })),
    ...targets.map((t) => ({ url: abs(`/targets/${t.slug}`), changeFrequency: "weekly" as const, priority: 0.9 })),
  ];
}

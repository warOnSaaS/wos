import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, LINKS } from "./site";
import type { Target } from "@/data/targets";
import type { Faq } from "./content";
import type { Whitepaper } from "./whitepaper";
import { WHITEPAPER_MD_PATH, WHITEPAPER_META, WHITEPAPER_PATH } from "./whitepaper";

/**
 * Full metadata for one page. Next merges metadata shallowly, so each page
 * sets its own openGraph and twitter blocks in full.
 * `title` is the page part only; the layout template appends " — warOnSaaS".
 */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
  defaultImage = true,
  alternateMarkdown,
}: {
  title: string;
  description: string;
  path: string;
  absoluteTitle?: boolean;
  /** Use the site-wide share image. Target pages have their own opengraph-image file instead. */
  defaultImage?: boolean;
  /** A plain Markdown version of the page, for agents (the white paper). */
  alternateMarkdown?: string;
}): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} — ${SITE_NAME}`;
  // A page that sets openGraph replaces the parent's, so the root image must be named explicitly.
  const images = defaultImage ? [{ url: "/opengraph-image", width: 1200, height: 630, alt: OG_ALT }] : undefined;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: {
      canonical: path,
      types: {
        "text/plain": [{ url: "/llms.txt", title: "llms.txt" }],
        ...(alternateMarkdown ? { "text/markdown": [{ url: alternateMarkdown, title: "Markdown" }] } : {}),
      },
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title: fullTitle,
      description,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      ...(images ? { images } : {}),
    },
  };
}

export const OG_ALT =
  "warOnSaaS: open-source replacements for the software you rent. The war starts at zero.";

export const abs = (path: string) => new URL(path, SITE_URL).toString();

export const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: abs("/apple-icon"),
  description: SITE_DESCRIPTION,
  sameAs: [LINKS.github],
};

export const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: "en",
  publisher: { "@id": `${SITE_URL}/#organization` },
};

export const desktopAppLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#wos-desktop`,
  name: "wOS Desktop",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux",
  description:
    "The warOnSaaS desktop app. Pick a target, a feature and a build unit, press BUILD, and your local Claude Code builds it under wOS’s checks.",
  url: abs("/download"),
  downloadUrl: LINKS.releases,
  publisher: { "@id": `${SITE_URL}/#organization` },
};

export function targetListLd(targets: Target[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "The Sniper List",
    description: "The ten rented products warOnSaaS is building open-source replacements for, in order.",
    numberOfItems: targets.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: targets.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `Open-source ${t.name} alternative`,
      url: abs(`/targets/${t.slug}`),
    })),
  };
}

export function faqLd(faq: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: abs(it.path),
    })),
  };
}

/** The white paper as a TechArticle. Dates come from git (generated/whitepaper-meta.json), never typed. */
export function whitepaperLd(wp: Whitepaper) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "@id": `${abs(WHITEPAPER_PATH)}#article`,
    headline: `${SITE_NAME} white paper: ${wp.subtitle}`,
    alternativeHeadline: wp.subtitle,
    description:
      "A living document for agents to evaluate: budget-based Proof of Contribution, one open wOS product, the Sniper List, and an inventory of what exists today.",
    url: abs(WHITEPAPER_PATH),
    mainEntityOfPage: abs(WHITEPAPER_PATH),
    version: wp.version,
    inLanguage: "en",
    wordCount: wp.words,
    ...(WHITEPAPER_META.firstCommitted ? { datePublished: WHITEPAPER_META.firstCommitted } : {}),
    ...(WHITEPAPER_META.lastUpdated ? { dateModified: WHITEPAPER_META.lastUpdated } : {}),
    author: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    isPartOf: { "@id": `${SITE_URL}/#website` },
    encoding: { "@type": "MediaObject", encodingFormat: "text/markdown", contentUrl: abs(WHITEPAPER_MD_PATH) },
    image: abs(`${WHITEPAPER_PATH}/opengraph-image`),
  };
}

import Link from "next/link";
import { targets } from "@/data/targets";
import { LINKS, TOKEN_DISCLAIMER } from "@/lib/site";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div>
          <p className="wordmark wordmark--sm">
            war<span>On</span>SaaS
          </p>
          <p className="muted">Open-source replacements for the software you rent. One feature at a time.</p>
        </div>
        <nav aria-label="The Sniper List">
          <h2 className="footer-h">The Sniper List</h2>
          <ul className="footer-list">
            {targets.map((t) => (
              <li key={t.slug}>
                <Link href={`/targets/${t.slug}`}>{t.name} alternative</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Site">
          <h2 className="footer-h">Site</h2>
          <ul className="footer-list">
            <li><Link href="/how-it-works">How it works</Link></li>
            <li><Link href="/download">Download wOS</Link></li>
            <li><Link href="/tokens">WOS tokens</Link></li>
            <li><Link href="/leaderboard">Leaderboard</Link></li>
            <li><Link href="/about">About</Link></li>
            <li><a href={LINKS.repo}>GitHub</a></li>
            <li><a href="/llms.txt">llms.txt</a></li>
          </ul>
        </nav>
      </div>
      <div className="wrap fine">
        <p>{TOKEN_DISCLAIMER} They are not cryptocurrency and cannot be transferred or sold.</p>
        <p>
          Product names on this site are trademarks of their respective owners. warOnSaaS is not affiliated with,
          endorsed by or sponsored by any of them.
        </p>
      </div>
    </footer>
  );
}

import Link from "next/link";
import { targets } from "@/data/targets";
import { wosTarget } from "@/data/wos-roadmap";
import { LINKS, TOKEN_DISCLAIMER } from "@/lib/site";

export function Footer() {
  return (
    <footer>
      <div className="foot">
        <div>
          <p className="brand">
            <span className="mark" aria-hidden="true">wOS</span>
            <span className="wordmark">warOnSaaS</span>
          </p>
          <p className="fine">Open-source replacements for rented business software. One feature at a time.</p>
        </div>
        <nav aria-label="Targets">
          <h2>TARGETS</h2>
          <ul>
            {[wosTarget, ...targets].map((t) => (
              <li key={t.slug}>
                <Link href={`/targets/${t.slug}`}>
                  {t.id} {t.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Site">
          <h2>INDEX</h2>
          <ul>
            <li><Link href="/briefing">Briefing</Link></li>
            <li><Link href="/how-it-works">Procedure and rules</Link></li>
            <li><Link href="/download">Download</Link></li>
            <li><Link href="/tokens">Tokens</Link></li>
            <li><Link href="/leaderboard">Leaderboard</Link></li>
            <li><Link href="/log">Build log</Link></li>
            <li><Link href="/faq">FAQ</Link></li>
            <li><Link href="/about">About</Link></li>
            <li><a href={LINKS.repo}>GitHub</a></li>
            <li><a href="/llms.txt">llms.txt</a></li>
          </ul>
        </nav>
      </div>
      <div className="foot-fine fine">
        <p>{TOKEN_DISCLAIMER} They are not cryptocurrency and cannot be transferred or sold.</p>
        <p>Product names are trademarks of their owners. warOnSaaS is not affiliated with, endorsed by or sponsored by any of them.</p>
      </div>
      <div className="strip">
        <span>DISTRIBUTION: PUBLIC</span>
        <span>END OF DOCUMENT</span>
      </div>
    </footer>
  );
}

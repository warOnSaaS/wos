import Link from "next/link";
import { NAV } from "@/lib/site";

export function Header() {
  return (
    <header>
      <a className="skip" href="#main">Skip to content</a>
      <div className="strip">
        <span>DISTRIBUTION: PUBLIC</span>
        <span>OPEN SOURCE</span>
      </div>
      <div className="masthead">
        <Link href="/" className="brand" aria-label="warOnSaaS home">
          <span className="mark" aria-hidden="true">wOS</span>
          <span className="wordmark brand__name" aria-hidden="true">warOnSaaS</span>
        </Link>
        <nav aria-label="Main">
          <ul className="nav">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href}>{n.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

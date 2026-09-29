import Link from "next/link";
import { NAV } from "@/lib/site";

export function Header() {
  return (
    <header className="site-header">
      <a className="skip" href="#main">Skip to content</a>
      <div className="wrap site-header__inner">
        <Link href="/" className="wordmark" aria-label="warOnSaaS home">
          war<span>On</span>SaaS
        </Link>
        <nav aria-label="Main">
          <ul className="nav">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className={n.href === "/download" ? "nav__cta" : undefined}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

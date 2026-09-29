import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page does not exist.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <section className="hero" aria-labelledby="h">
      <div className="wrap">
        <p className="kicker">404</p>
        <h1 id="h">Nothing here</h1>
        <p className="lede">This page does not exist. The targets that do are on the Sniper List.</p>
        <div className="actions">
          <Link className="btn" href="/#sniper-list">See the Sniper List</Link>
          <Link className="btn btn--ghost" href="/">Home</Link>
        </div>
      </div>
    </section>
  );
}

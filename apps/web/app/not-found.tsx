import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page does not exist.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="title">
      <p className="label">Error 404 // no such page</p>
      <h1>Not found</h1>
      <p>This page does not exist.</p>
      <div className="cmds-row" style={{ marginTop: "1rem" }}>
        <Link className="cmd" href="/#targets">Targets</Link>
        <Link className="cmd" href="/">Home</Link>
      </div>
    </div>
  );
}

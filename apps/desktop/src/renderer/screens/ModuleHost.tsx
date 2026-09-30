/**
 * Where an installed desktop module appears (S-38). The module's page is NOT rendered here: main shows it in its own
 * sandboxed view under wos-module://<app>/<version>/, placed over this element's rectangle. This component only
 * reports the rectangle (and every resize) and hides the view when it goes away.
 */
import { useEffect, useRef, useState } from "react";
import { type ModuleStatusView, splitBridgeError } from "../../shared/ipc.js";
import { Notice } from "../components/ui.js";
import { wos } from "../lib/hooks.js";

export function ModuleHost({ app, route, status }: { app: string; route: string; status: ModuleStatusView | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const place = () => {
      const r = el.getBoundingClientRect();
      const bounds = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      wos()
        .showModule(app, route, bounds)
        .then(() => live && setError(null))
        .catch((e: unknown) => {
          if (!live) return;
          const { code, message } = splitBridgeError(e);
          setError(`${code}. ${message}`);
        });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      live = false;
      ro.disconnect();
      window.removeEventListener("resize", place);
      void wos()
        .hideModule()
        .catch(() => undefined);
    };
  }, [app, route]);

  return (
    <div className="module-host" ref={ref} data-testid={`module-${app}`}>
      {error ? <Notice label={`${app.toUpperCase()} IS NOT AVAILABLE`}>{error}</Notice> : null}
      {status && status.state !== "active" ? <Notice label="MODULE">{status.reason ?? "UNAVAILABLE"}</Notice> : null}
    </div>
  );
}

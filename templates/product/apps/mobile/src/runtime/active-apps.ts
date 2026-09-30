/**
 * `ActiveApps` on the phone (WOS-APP-PROTOCOL section 7, WORKSTREAMS 12.4 shared rules): the apps this organization
 * has active on this environment, re-read on start, when the app returns to the foreground, on every token refresh,
 * and every `ACTIVE_APPS_REFRESH_SECONDS` (60) while open. A disabled app therefore leaves the navigation within a
 * minute, and within the 15-minute token lifetime at the latest.
 */
import { ACTIVE_APPS_REFRESH_SECONDS, ActiveApps, type ActiveAppsT, CoreRoutes } from "../contracts.js";
import { HttpError } from "./http.js";
import { type EnvironmentSession, systemTimers, type Timers } from "./session.js";

export type ActiveAppsSnapshot = {
  apps: ActiveAppsT | null;
  /** The last refresh's failure, shown as a notice; the previous list stays until a refresh succeeds. */
  error: string | null;
  /** How many refreshes completed (tests and the "last updated" line). */
  loads: number;
};

export class ActiveAppsController {
  private snapshot: ActiveAppsSnapshot = { apps: null, error: null, loads: 0 };
  private interval: unknown = null;
  private unsubscribe: (() => void) | null = null;
  private inflight: Promise<void> | null = null;
  private readonly listeners = new Set<(s: ActiveAppsSnapshot) => void>();
  private readonly timers: Timers;

  constructor(
    private readonly session: EnvironmentSession,
    timers?: Timers,
  ) {
    this.timers = timers ?? systemTimers;
  }

  get current(): ActiveAppsSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (s: ActiveAppsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** On start: read now, then every 60 s, and after every token refresh. */
  start(): Promise<void> {
    this.stop();
    this.unsubscribe = this.session.subscribe((e) => {
      if (e.type === "token_refreshed") void this.refresh();
    });
    const tick = () => {
      this.interval = this.timers.setTimeout(() => {
        void this.refresh().finally(tick);
      }, ACTIVE_APPS_REFRESH_SECONDS * 1000);
    };
    tick();
    return this.refresh();
  }

  stop(): void {
    if (this.interval !== null) this.timers.clearTimeout(this.interval);
    this.interval = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** The app returned to the foreground: bring the token up to date, then re-read. */
  async onForeground(): Promise<void> {
    try {
      await this.session.onForeground();
    } catch {
      // refresh() below reports the problem.
    }
    await this.refresh();
  }

  /** One read of GET /v1/core/apps (coalesced when several triggers fire at once). */
  refresh(): Promise<void> {
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(): Promise<void> {
    if (this.session.state !== "ready") {
      // Signed out: nothing may be shown without a session.
      if (this.snapshot.apps !== null) this.set({ apps: null, error: null, loads: this.snapshot.loads });
      return;
    }
    try {
      const r = await this.session.authorized({ method: "GET", path: CoreRoutes.activeApps.path });
      const apps = ActiveApps.parse(r.json);
      if (apps.environmentId !== this.session.environmentId)
        throw new HttpError(200, "PROTOCOL", "the environment answered for a different environment id");
      this.set({ apps, error: null, loads: this.snapshot.loads + 1 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Signed out: forget the list (nothing may be shown without a session). Otherwise keep the last good list.
      const apps = this.session.state === "ready" ? this.snapshot.apps : null;
      this.set({ apps, error: message, loads: this.snapshot.loads + 1 });
    }
  }

  private set(s: ActiveAppsSnapshot) {
    this.snapshot = s;
    for (const l of [...this.listeners]) l(s);
  }
}

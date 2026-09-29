import { PROGRESS_METRICS } from "@/lib/content";
import type { Target } from "@/data/targets";

/** The three independent progress numbers for one target. Pure CSS, no JS. */
export function Progress({ target, size = "sm" }: { target: Target; size?: "sm" | "lg" }) {
  return (
    <dl className={`progress progress--${size}`}>
      {PROGRESS_METRICS.map((m) => {
        const value = target[m.key];
        return (
          <div className="progress__row" key={m.key}>
            <dt>{m.label}</dt>
            <dd>
              <span className="progress__value">{value}%</span>
              <span className="progress__track" aria-hidden="true">
                <span className="progress__fill" style={{ width: `${value}%` }} />
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

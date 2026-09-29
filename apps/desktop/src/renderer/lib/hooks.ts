/** The renderer's only way out is `window.wos` (WosBridge). These hooks load from it with honest states. */
import { useCallback, useEffect, useRef, useState } from "react";
import { splitBridgeError, type WosBridge } from "../../shared/ipc.js";

declare global {
  interface Window {
    wos: WosBridge;
  }
}

export function wos(): WosBridge {
  return window.wos;
}

export type Load<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "error"; code: string; message: string };

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): [Load<T>, () => void] {
  const [value, setValue] = useState<Load<T>>({ state: "loading" });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  // biome-ignore lint/correctness/useExhaustiveDependencies: callers pass their own dependency list.
  useEffect(() => {
    let live = true;
    setValue({ state: "loading" });
    fnRef
      .current()
      .then((v) => live && setValue({ state: "ready", value: v }))
      .catch((e: unknown) => live && setValue({ state: "error", ...splitBridgeError(e) }));
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return [value, reload];
}

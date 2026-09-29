/**
 * Preload (owner: desktop workstream). Runs sandboxed; exposes exactly `window.wos: WosBridge` via
 * contextBridge (S-29). Only the channels in IPC_CHANNELS are reachable; no ipcRenderer object, no
 * Node API and no raw event object ever reaches the page.
 */
import { contextBridge, ipcRenderer } from "electron";
import { type DesktopEvent, IPC_CHANNELS, type WosBridge } from "../shared/ipc.js";

const C = IPC_CHANNELS;
const call = <T>(channel: string, payload?: unknown): Promise<T> => ipcRenderer.invoke(channel, payload) as Promise<T>;

const bridge: WosBridge = {
  appInfo: () => call(C.appInfo),
  status: () => call(C.status),
  signIn: (email) => call(C.signIn, { email }),
  submitSignInCode: (code) => call(C.signInCode, { code }),
  cancelSignIn: () => call(C.signInCancel),
  linkGithub: () => call(C.linkGithub),
  logout: () => call(C.logout),
  listTargets: () => call(C.listTargets),
  getTarget: (slug) => call(C.getTarget, { slug }),
  getFeature: (slug, feature) => call(C.getFeature, { slug, feature }),
  listClaimableAbus: (slug, feature) => call(C.listClaimableAbus, { slug, feature }),
  builderModels: () => call(C.builderModels),
  build: (abu, model) => call(C.build, { abu, model }),
  review: (slot) => call(C.review, { slot }),
  release: (leaseId) => call(C.release, { leaseId }),
  runs: () => call(C.runs),
  myWork: () => call(C.myWork),
  myEvents: (after) => call(C.myEvents, after === undefined ? undefined : { after }),
  contributions: () => call(C.contributions),
  getSettings: () => call(C.getSettings),
  setSettings: (patch) => call(C.setSettings, patch),
  onEvent(listener) {
    const wrapped = (_event: unknown, payload: DesktopEvent) => listener(payload);
    ipcRenderer.on(C.events, wrapped);
    return () => {
      ipcRenderer.removeListener(C.events, wrapped);
    };
  },
  openExternal: (url) => call(C.openExternal, { url }),
};

contextBridge.exposeInMainWorld("wos", bridge);

export type ExposedApi = { wos: WosBridge };

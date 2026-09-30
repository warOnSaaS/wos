/**
 * wOS CRM's web page, compiled into wOS Web and shown only while CRM is active (A10). It reads CRM's own API and
 * renders what is there: with no feature built it says so and shows 0, never sample records.
 */
import { ScreenListData } from "../../../modules/core-contracts/src/index.js";
import type { WebEntry } from "../../../modules/core/src/app-module.js";
import { escapeHtml } from "../../../modules/core/src/html.js";

export const web: WebEntry = {
  async render({ manifest, callApi }) {
    const res = await callApi(`${manifest.routes.api}/features`);
    const head = `<h1>${escapeHtml(manifest.app.name)}</h1><p class="dim">VERSION ${escapeHtml(manifest.app.version)}</p>`;
    if (res.status !== 200) return `${head}<p>CRM's API answered HTTP ${escapeHtml(res.status)}.</p>`;
    const data = ScreenListData.parse(res.body);
    if (data.items.length === 0) {
      return `${head}
<section class="panel">
  <p class="label">FEATURES IN THIS VERSION</p>
  <p class="big">0</p>
  <p>No CRM feature is built yet. What appears here is whatever the warOnSaaS roadmap has built and released; nothing is shown before it exists.</p>
</section>`;
    }
    const rows = data.items.map((i) => `<li>${escapeHtml(i.name)}</li>`).join("");
    return `${head}<section class="panel"><p class="label">FEATURES IN THIS VERSION</p><p class="big">${data.items.length}</p><ul>${rows}</ul></section>`;
  },
};

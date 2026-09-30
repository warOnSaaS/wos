/**
 * suite-shell (WORKSTREAMS 12.1): runs the product template's wOS Core and wOS Web tests in the workspace run.
 * They live in templates/product (the product repo runs them itself with its own vitest config); importing them
 * here registers their suites, so `npm test` and `npm run typecheck` at the root cover them.
 */
import { generateKeyPairSync } from "node:crypto";
import { ENVIRONMENT_TOKEN_TTL_SECONDS, WOS_CLOUD_ENVIRONMENT_ID } from "@waronsaas/contracts";
import { encodeDevicePublicKey, signEnvironmentToken } from "@waronsaas/contracts/canonical";
import { describe, expect, it } from "vitest";
import { verifyEnvironmentToken as vendoredVerify } from "../templates/product/modules/core-contracts/src/index.js";

import "../templates/product/apps/api/test/manifests.test.js";
import "../templates/product/apps/api/test/core.test.js";
import "../templates/product/apps/api/test/registry.test.js";
import "../templates/product/apps/api/test/postgres.test.js";
import "../templates/product/apps/api/test/self-host-docker.test.js";
import "../templates/product/apps/web/test/shell.test.js";

describe("suite-shell: the vendored verifier accepts what the control plane's signer mints", () => {
  it("signEnvironmentToken (@waronsaas/contracts/canonical) -> verifyEnvironmentToken (templates/product vendor)", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const iat = 1_790_000_000;
    const claims = {
      iss: "https://api.waronsaas.com",
      aud: WOS_CLOUD_ENVIRONMENT_ID,
      sub: "0192f000-0000-7000-8000-000000000001",
      org: "0192f000-0000-7000-8000-000000000002",
      role: "admin" as const,
      apps: ["contacts", "core", "crm"],
      iat,
      exp: iat + ENVIRONMENT_TOKEN_TTL_SECONDS,
    };
    const token = signEnvironmentToken(claims, "wos-env-2026", privateKey);
    const r = vendoredVerify(
      token,
      { "wos-env-2026": encodeDevicePublicKey(publicKey) },
      { environmentId: WOS_CLOUD_ENVIRONMENT_ID, nowSeconds: iat + 10 },
    );
    expect(r).toEqual({ ok: true, claims });
  });
});

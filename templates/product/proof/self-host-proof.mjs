// Probe for V1 proof step 8, run INSIDE the isolated compose network (docker-compose.proof.yml).
//   start <email>        -> checks the descriptor, asks wOS Web for a code, prints {"cookie": ...}
//   finish <cookie> <code> -> signs in, checks CRM is in wOS Web's navigation and its page, prints PROOF OK
//   noroute              -> exits 0 only if https://api.waronsaas.com is unreachable from here
const CORE = "http://core:8080";
const WEB = "http://web:3000";
const [cmd, a, b] = process.argv.slice(2);
const fail = (m) => {
  console.error(`PROOF FAILED: ${m}`);
  process.exit(1);
};
const cookiesOf = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

if (cmd === "start") {
  const d = await (await fetch(`${CORE}/.well-known/wos-environment`)).json();
  if (d.kind !== "self_hosted" || d.auth.kind !== "local") fail(`descriptor ${JSON.stringify(d)}`);
  const res = await fetch(`${WEB}/sign-in`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: a }),
  });
  if (res.status !== 302) fail(`sign-in start HTTP ${res.status}`);
  console.log(JSON.stringify({ cookie: cookiesOf(res), environmentId: d.environmentId }));
} else if (cmd === "finish") {
  const res = await fetch(`${WEB}/sign-in/code`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: a },
    body: new URLSearchParams({ code: b }),
  });
  if (res.status !== 302 || res.headers.get("location") !== "/core/apps") fail(`sign-in HTTP ${res.status}`);
  const cookie = cookiesOf(res);
  const apps = await (await fetch(`${WEB}/core/apps`, { headers: { cookie } })).text();
  if (!/<a href="\/crm"[^>]*data-app="crm"/.test(apps)) fail("CRM is not in wOS Web's navigation");
  const crm = await fetch(`${WEB}/crm`, { headers: { cookie } });
  const page = await crm.text();
  if (crm.status !== 200 || !page.includes("No CRM feature is built yet.")) fail(`/crm HTTP ${crm.status}`);
  console.log("PROOF OK: self-hosted wOS Core with WOS_APPS=crm, CRM in wOS Web navigation, no route to warOnSaaS");
} else if (cmd === "noroute") {
  try {
    await fetch("https://api.waronsaas.com/v1/health", { signal: AbortSignal.timeout(5000) });
    fail("api.waronsaas.com answered: this network has a route out");
  } catch {
    console.log("no route to api.waronsaas.com");
  }
} else fail(`unknown command ${cmd}`);

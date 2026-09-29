#!/usr/bin/env node
// wOS Maestro runner for iOS and Android acceptance (D13). Owned by the verification workstream; lives under
// .github/ (no submission can change it). A mobile suite's `run` is `["node", ".github/wos/maestro.mjs"]`;
// wos-ci.mjs sets WOS_SURFACE (ios | android), WOS_SUITE_DIR (the Maestro flows) and WOS_REPORT, and checks
// the JUnit report afterwards. The app shell path comes from wos.json `apps`.
//
// iOS: macOS runner only (Xcode + Simulator); an unsigned Release build for the Simulator, no credentials.
// Android: Linux runner with KVM; a Release APK signed with the template's debug keystore, no credentials.
// Signing for stores happens ONLY in release-mobile.yml, in the protected `release` environment (S-35).
//
//   node .github/wos/maestro.mjs            build, boot, install, run the flows
//   node .github/wos/maestro.mjs --dry-run  print the plan as JSON (used by the platform repo's tests)
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export const MAESTRO_VERSION = "2.11.0"; // github.com/mobile-dev-inc/maestro release cli-2.11.0
const IOS_SIMULATOR = "iPhone 16";
const ANDROID_API = "35";

const fail = (msg) => {
  console.error(`maestro: ${msg}`);
  process.exit(1);
};

function plan(platform, appDir, flows, report) {
  const maestro = ["maestro", "test", "--format", "junit", "--output", report, flows];
  const installMaestro = ["bash", "-c", `curl -fsSL https://get.maestro.mobile.dev | MAESTRO_VERSION=${MAESTRO_VERSION} bash`];
  if (platform === "ios") {
    return [
      { id: "prebuild", cwd: appDir, argv: ["npx", "--no-install", "expo", "prebuild", "--platform", "ios", "--no-install"] },
      { id: "pods", cwd: `${appDir}/ios`, argv: ["pod", "install"] },
      {
        id: "build",
        cwd: `${appDir}/ios`,
        argv: [
          "xcodebuild",
          "-workspace",
          "{scheme}.xcworkspace",
          "-scheme",
          "{scheme}",
          "-configuration",
          "Release",
          "-sdk",
          "iphonesimulator",
          "-derivedDataPath",
          "build",
          "CODE_SIGNING_ALLOWED=NO",
          "build",
        ],
      },
      { id: "boot", cwd: appDir, argv: ["xcrun", "simctl", "boot", IOS_SIMULATOR] },
      {
        id: "install",
        cwd: `${appDir}/ios`,
        argv: ["xcrun", "simctl", "install", "booted", "build/Build/Products/Release-iphonesimulator/{scheme}.app"],
      },
      { id: "maestro-install", cwd: appDir, argv: installMaestro },
      { id: "flows", cwd: ".", argv: maestro },
    ];
  }
  if (platform === "android") {
    return [
      { id: "prebuild", cwd: appDir, argv: ["npx", "--no-install", "expo", "prebuild", "--platform", "android", "--no-install"] },
      { id: "build", cwd: `${appDir}/android`, argv: ["./gradlew", "assembleRelease", "--no-daemon"] },
      { id: "system-image", cwd: appDir, argv: ["sdkmanager", `system-images;android-${ANDROID_API};google_apis;x86_64`] },
      {
        id: "avd",
        cwd: appDir,
        argv: ["bash", "-c", `echo no | avdmanager create avd -n wos -k "system-images;android-${ANDROID_API};google_apis;x86_64" --force`],
      },
      {
        id: "emulator",
        cwd: appDir,
        argv: [
          "bash",
          "-c",
          "nohup emulator -avd wos -no-window -no-audio -no-boot-anim >/tmp/emulator.log 2>&1 & adb wait-for-device && until [ \"$(adb shell getprop sys.boot_completed | tr -d '\\r')\" = 1 ]; do sleep 2; done",
        ],
      },
      { id: "install", cwd: `${appDir}/android`, argv: ["adb", "install", "-r", "app/build/outputs/apk/release/app-release.apk"] },
      { id: "maestro-install", cwd: appDir, argv: installMaestro },
      { id: "flows", cwd: ".", argv: maestro },
    ];
  }
  fail(`WOS_SURFACE must be ios or android, got ${JSON.stringify(platform)}`);
}

const platform = process.env.WOS_SURFACE;
const flows = process.env.WOS_SUITE_DIR;
const report = process.env.WOS_REPORT;
if (!flows || !report) fail("run mobile acceptance through .github/wos/wos-ci.mjs (WOS_SUITE_DIR and WOS_REPORT are not set)");
const app = JSON.parse(readFileSync("wos.json", "utf8")).apps?.find((a) => a.surface === platform);
if (!app) fail(`wos.json has no app for surface ${platform}`);
const steps = plan(platform, app.path, flows, report);

if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ platform, steps }));
} else {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "";
  const extra = [
    `${process.env.HOME}/.maestro/bin`,
    ...(sdk ? [`${sdk}/cmdline-tools/latest/bin`, `${sdk}/emulator`, `${sdk}/platform-tools`] : []),
  ];
  const env = { ...process.env, PATH: [...extra, process.env.PATH].join(":") };
  // The Xcode workspace and scheme are named after the app; known only after `expo prebuild`.
  const scheme = () => {
    const ws = readdirSync(`${app.path}/ios`).find((f) => f.endsWith(".xcworkspace"));
    if (!ws) fail(`no .xcworkspace under ${app.path}/ios after prebuild`);
    return ws.slice(0, -".xcworkspace".length);
  };
  for (const s of steps) {
    const argv = s.argv.some((a) => a.includes("{scheme}")) ? s.argv.map((a) => a.replaceAll("{scheme}", scheme())) : s.argv;
    console.log(`::group::${s.id}: ${argv.join(" ")}`);
    const r = spawnSync(argv[0], argv.slice(1), { cwd: s.cwd, env, stdio: "inherit", shell: false });
    console.log("::endgroup::");
    if (r.status !== 0) fail(`${s.id} failed with exit ${r.status ?? r.signal}`);
  }
}

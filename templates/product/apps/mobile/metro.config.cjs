// Metro (the React Native bundler) with Expo's defaults, which already watch the whole npm workspace. One addition:
// the runtime and the vendored contracts are written as Node ESM TypeScript, importing "./x.js" for the file x.ts
// (what tsc and vitest expect). Metro resolves imports literally, so when "./x.js" does not exist it tries "./x.ts".
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if ((moduleName.startsWith("./") || moduleName.startsWith("../")) && moduleName.endsWith(".js")) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, `${moduleName.slice(0, -3)}.ts`, platform);
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;

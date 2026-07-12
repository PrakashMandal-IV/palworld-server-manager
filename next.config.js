/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: false,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // Keep native/wasm SQLite backends external so their files (incl. the .wasm
  // binary) are traced into the standalone node_modules rather than bundled.
  experimental: {
    serverComponentsExternalPackages: ["node-sqlite3-wasm"],
    // Never trace the local runtime data dir into the standalone build. `.data/`
    // holds the dev database (worlds + admin passwords), SteamCMD, logs and backups;
    // it must be created fresh on the end user's machine, never shipped in the app.
    outputFileTracingExcludes: { "*": [".data/**", "release/**", "dist-standalone/**"] },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "node:sqlite": "commonjs node:sqlite",
        "node-sqlite3-wasm": "commonjs node-sqlite3-wasm",
      });
    }
    return config;
  },
};

module.exports = nextConfig;

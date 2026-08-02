import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

if (r2 !== null) {
  throw new Error("This site does not use an R2 binding.");
}

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  name: "server",
  main: "./worker/index.ts",
  workers_dev: false,
  compatibility_date: "2026-07-27",
  compatibility_flags: ["nodejs_compat"],
  assets: {
    binding: "ASSETS",
    not_found_handling: "single-page-application" as const,
    run_worker_first: ["/api/*"],
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "fam-local",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. Application environment
  // belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    define: {
      "import.meta.env.VITE_FAM_SSE_ENABLED": JSON.stringify("false"),
    },
    plugins: [
      vue(),
      sites(),
      cloudflare({
        config: localBindingConfig,
      }),
    ],
  };
});

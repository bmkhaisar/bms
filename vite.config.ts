import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Centralized deployment environment detection
const isStagingBranch = process.env.VERCEL_GIT_COMMIT_REF === "staging";
const isVercelPreview = process.env.VERCEL_ENV === "preview";
const deploymentEnv =
  process.env.VITE_BMS_DEPLOYMENT_ENV ||
  process.env.BMS_DEPLOYMENT_ENV ||
  (isStagingBranch ? "staging" : isVercelPreview ? "staging" : "");

export default defineConfig({
  vite: {
    define: {
      "import.meta.env.VITE_BMS_DEPLOYMENT_ENV": JSON.stringify(deploymentEnv),
    },
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: {
    preset: "vercel",
  },
});



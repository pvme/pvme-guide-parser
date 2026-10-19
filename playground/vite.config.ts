import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [{
    name: "watch-shared-fixtures",
    configureServer(server) {
      // import.meta.glob imports existing files; also watch the directory so
      // adding/removing a fixture outside the app root invalidates the glob.
      server.watcher.add(fileURLToPath(new URL("../test/fixtures", import.meta.url)));
    },
  }],
  optimizeDeps: { exclude: ["@pvme/guide-parser"] },
});

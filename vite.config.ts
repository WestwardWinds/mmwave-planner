import { defineConfig } from "vitest/config";

// Two outputs:
//  - default: the standalone site (index.html) -> dist/
//  - `--mode lib`: one self-contained ES module that registers <mmwave-planner> -> dist-lib/
//    (three.js and Lit are bundled in, so a docs site only needs one <script type="module">).
//    Vite keeps whitespace in ES-library builds, so it is ~760 KB raw but ~175 KB gzipped as served.
// three.js is most of the bundle, hence the raised size warning.
export default defineConfig(({ mode }) =>
  mode === "lib"
    ? {
        build: {
          outDir: "dist-lib",
          emptyOutDir: true,
          minify: true,
          chunkSizeWarningLimit: 800,
          lib: { entry: "src/index.ts", formats: ["es"], fileName: () => "mmwave-planner.js" }
        }
      }
    : {
        // relative base: works at a domain root and under a GitHub Pages project path (/<repo>/)
        base: "./",
        build: {
          outDir: "dist",
          emptyOutDir: true,
          chunkSizeWarningLimit: 800,
          // the site is the planner page plus the docs-style embed demo
          rollupOptions: { input: { main: "index.html", embed: "examples/embed.html" } }
        },
        test: { include: ["test/**/*.test.ts"], environment: "node" }
      }
);

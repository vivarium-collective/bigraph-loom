import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // Build into the Python package's data dir. `bigraph_loom.asset_dir()`
    // resolves to this directory, and host apps (e.g. vivarium-dashboard)
    // depend on the `bigraph-loom` package and serve the bundle from there
    // instead of vendoring a copy. `npm run build` refreshes it in place; an
    // editable install picks up the new bundle immediately.
    outDir: 'bigraph_loom/_dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
  },
});

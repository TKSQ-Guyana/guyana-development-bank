import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Dev loop: `docker compose up -d` for the backend stack, then `npm run dev`
 * here — /api is proxied straight to the local gunicorn.
 *
 * THE TARGET IS NOT A CONSTANT. It was hardcoded to `localhost:8080` /
 * `gdb.localhost` while the repo's own `.env` runs this project on `8081` /
 * `gdb2.localhost`, so `npm run dev` talked to whatever *other* GDB stack
 * happened to be listening on 8080 — and to nothing at all when none was. Both
 * values now come from the environment, with the compose defaults as the
 * fallback.
 *
 * `loadEnv(mode, root, '')` — the empty prefix is deliberate. It reads the
 * repo's plain `BACKEND_PORT` / `SITE_NAME`, not only `VITE_`-prefixed names,
 * so one `.env` drives compose and the dev server alike. `'..'` is the repo
 * root, resolved against the vite cwd. Nothing read here is exposed to the
 * browser: this is config for the proxy, which runs in node.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  const backend = env.VITE_BACKEND_URL || `http://localhost:${env.BACKEND_PORT || '8080'}`;
  const site = env.VITE_SITE_NAME || env.SITE_NAME || 'gdb.localhost';

  return {
    plugins: [react(), tailwindcss()],
    // Same root, so a VITE_-prefixed var in the repo `.env` also reaches
    // `import.meta.env` in the app rather than only the proxy config.
    envDir: '..',
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
          // Frappe serves many sites from one bench; without this header it
          // resolves by Host, which in dev is `localhost:5173` and matches no
          // site at all.
          headers: { 'X-Frappe-Site-Name': site },
        },
      },
    },
  };
});

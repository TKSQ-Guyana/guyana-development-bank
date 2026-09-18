import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev loop: `docker compose up -d` for the backend stack, then `npm run dev`
// here — /api is proxied straight to the local gunicorn.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        headers: { 'X-Frappe-Site-Name': 'gdb.localhost' },
      },
      // Uploaded evidence is private, and Frappe serves private files from
      // /private/files/ with a permission check of its own. Without this route
      // an applicant's own PDF 404s against the vite dev server.
      '/private/files': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        headers: { 'X-Frappe-Site-Name': 'gdb.localhost' },
      },
    },
  },
});

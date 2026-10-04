import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // icons.html, palette.html and brand.html are dev-only previews; ship just the app.
      input: 'index.html',
    },
  },
  worker: {
    // maplibre-gl starts its worker as a module worker.
    format: 'es',
  },
  server: {
    proxy: {
      // Backend dev server; override with API_URL=http://localhost:PORT.
      '/api': process.env.API_URL ?? 'http://localhost:8000',
    },
  },
})

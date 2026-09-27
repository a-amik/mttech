import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Воркер MapLibre 6 после предсборки Vite не отвечает, поэтому пакет отдаётся как есть.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: { port: 5190 },
})

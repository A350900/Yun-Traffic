import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The API server (server/index.ts) runs on 8787 during development.
    port: 5173,
    // Fail instead of silently moving to another port, so localhost:5173 is always this app.
    strictPort: true,
    proxy: { '/api': 'http://localhost:8787' },
  },
})

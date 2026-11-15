import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The API server (server/index.ts) runs on 8787 during development.
    proxy: { '/api': 'http://localhost:8787' },
  },
})

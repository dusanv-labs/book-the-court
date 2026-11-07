import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app from /book-the-court/; locally it runs from /.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
})

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Content-Security-Policy for the built app. GitHub Pages cannot send custom headers,
 * so the policy is added as a <meta> tag. It only allows scripts and styles from this
 * site (plus Google Fonts) and API calls to the configured API, as a second line of
 * defence against XSS. Not applied in dev mode, where Vite needs inline scripts.
 */
function contentSecurityPolicy(apiUrl: string): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    `connect-src 'self' ${new URL(apiUrl).origin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'content-security-policy',
    apply: 'build',
    // Right after <meta charset>, before any script or stylesheet, so the policy covers all of them.
    transformIndexHtml: (html) => {
      const charset = '<meta charset="UTF-8" />'
      if (!html.includes(charset)) throw new Error('index.html must contain <meta charset="UTF-8" />')
      return html.replace(charset, `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd()), ...process.env }
  return {
    // GitHub Pages serves the app from /book-the-court/; locally it runs from /.
    base: env.VITE_BASE ?? '/',
    plugins: [react(), tailwindcss(), contentSecurityPolicy(env.VITE_API_URL ?? 'http://localhost:3000/api')],
    // pdfmake and its fonts are large but load only when a PDF is exported.
    build: { chunkSizeWarningLimit: 900 },
  }
})

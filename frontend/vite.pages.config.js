import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const pagesCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'self'"
].join('; ')

export default defineConfig({
  base: '/fam/',
  define: {
    'import.meta.env.VITE_FAM_API_MODE': JSON.stringify('local'),
    'import.meta.env.VITE_FAM_SSE_ENABLED': JSON.stringify('false')
  },
  plugins: [
    vue(),
    {
      name: 'github-pages-csp',
      transformIndexHtml() {
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: pagesCsp
            },
            injectTo: 'head-prepend'
          },
          {
            tag: 'meta',
            attrs: {
              name: 'description',
              content: 'Публичное браузерное демо семейного трекера «Наш быт»'
            },
            injectTo: 'head'
          }
        ]
      }
    }
  ],
  build: {
    outDir: 'dist-pages',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    sourcemap: false
  }
})

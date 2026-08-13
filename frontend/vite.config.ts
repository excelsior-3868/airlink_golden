import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/favicon-64.png',
        'icons/apple-touch-icon.png',
      ],
      manifest: {
        name: 'Airlink Billing v3.0',
        short_name: 'Airlink',
        description: 'Airlink ISP billing — vouchers, plans, wallet, and reports.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#f8fafc',
        theme_color: '#003164',
        lang: 'en',
        categories: ['business', 'productivity', 'finance'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the built app shell so it loads instantly and works installed.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // SPA fallback: any uncached navigation resolves to the app shell...
        navigateFallback: '/index.html',
        // ...except API calls, which must always hit the network (live billing data).
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            // Google Fonts webfont files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Enable the dev service worker so `virtual:pwa-register` resolves during
        // `vite dev` too. vite-plugin-pwa's dev SW is HMR-safe and does not precache,
        // so it won't cause the stale-asset issues a production SW would.
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    watch: { usePolling: true }, // reliable HMR on Docker/Windows bind mounts
    allowedHosts: ['airlink.netcarenepal.com', '161.97.101.7'],
    // Mirror the prod nginx layout: the SPA and the API share an origin, so a
    // relative '/api' works no matter which host the dev server is reached on.
    // Without this, opening dev by IP/domain (not localhost) made lib/api.ts
    // fall back to relative '/api' and every call 404'd on Vite itself.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
})

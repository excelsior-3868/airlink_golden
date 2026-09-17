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
        // Desktop (Windows/Mac) installs get a real app window; 'minimal-ui'
        // is the fallback for browsers that don't do standalone, and 'browser'
        // is the last resort so launching never dead-ends.
        display_override: ['standalone', 'minimal-ui', 'browser'],
        // No `orientation` lock: it pins the app to portrait, which is wrong on
        // an installed desktop window and on a landscape tablet. Letting the
        // device decide is what makes the same install work on phone and PC.
        background_color: '#f8fafc',
        theme_color: '#003164',
        lang: 'en',
        categories: ['business', 'productivity', 'finance'],
        // Absolute paths so the icons resolve from any route the manifest is
        // first seen on, not relative to it.
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Focus the window that's already open instead of spawning a second
        // one — the desktop install otherwise duplicates itself on every click.
        launch_handler: { client_mode: ['navigate-existing', 'auto'] },
        // This is a web app, not a shim for a store listing.
        prefer_related_applications: false,
        // Taskbar jump list (Windows), dock menu (Mac), long-press (Android).
        shortcuts: [
          { name: 'Dashboard', short_name: 'Dashboard', url: '/' },
          { name: 'Voucher Sales', short_name: 'Vouchers', url: '/vouchers' },
          { name: 'Online Users', short_name: 'Online', url: '/online-users' },
          { name: 'Wallet / GB Allocation', short_name: 'Wallet', url: '/funds' },
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

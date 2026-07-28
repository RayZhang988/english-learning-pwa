/// <reference types="vitest/config" />

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { appTheme } from './src/ui/theme.ts'

export const courseAssetBuildPolicy = {
  base: './',
  assetsInlineLimit: 0,
  indexAssetDirectory: 'content/curriculum',
  indexAssetNames: [
    'package-index.v1.json',
    'listening-exercise-extension-index.v1.json',
    'training-supply-index.v1.json',
  ],
  workboxGlobPatterns: [
    '**/*.{js,css,html,ico,png,svg,woff2,json}',
  ],
} as const

export const pwaUpdatePolicy = {
  registerType: 'autoUpdate',
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
} as const

export default defineConfig({
  // A relative base keeps the generated bundle portable across static hosts.
  base: courseAssetBuildPolicy.base,
  // Course loaders use fetch() and therefore need real same-origin resources.
  // Inlining small JSON files as data: URLs breaks that production contract.
  build: {
    assetsInlineLimit: courseAssetBuildPolicy.assetsInlineLimit,
    rolldownOptions: {
      output: {
        assetFileNames: (asset) => {
          const assetName = asset.names[0] ?? ''
          if (
            courseAssetBuildPolicy.indexAssetNames.some(
              (indexName) => indexName === assetName,
            )
          ) {
            return `${courseAssetBuildPolicy.indexAssetDirectory}/[name]-[hash][extname]`
          }
          return 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: pwaUpdatePolicy.registerType,
      injectRegister: null,
      manifest: {
        id: './',
        name: '英语学习',
        short_name: '英语学习',
        description: '本地优先的个人英语学习工具',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: appTheme.backgroundColor,
        theme_color: appTheme.themeColor,
        icons: [
          {
            src: 'pwa-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: pwaUpdatePolicy.cleanupOutdatedCaches,
        clientsClaim: pwaUpdatePolicy.clientsClaim,
        skipWaiting: pwaUpdatePolicy.skipWaiting,
        navigateFallback: 'index.html',
        globPatterns: [...courseAssetBuildPolicy.workboxGlobPatterns],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
})

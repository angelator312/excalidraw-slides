import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  define: {
    'process.env.IS_PREACT': JSON.stringify('true'),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  server: {
    port: 5173,
    proxy: {
      '/presentations': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/teams': 'http://localhost:3000',
      '/thumbnail': 'http://localhost:3000',
    },
  },
  optimizeDeps: {
    include: ['@excalidraw/excalidraw'],
  },
  resolve: {
    alias: {
      'react': 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Code-splitting (M3 perf deliverable): the heavy three.js stack,
        // postprocessing chain, drei, and fiber are split out of the app
        // shell so the shell stays small and each chunk caches
        // independently. Function form so deep subpath imports
        // (three/examples/jsm/...) land in the right chunk too.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/@react-three/postprocessing')) {
            return 'postprocessing'
          }
          if (id.includes('node_modules/postprocessing')) return 'postprocessing'
          if (id.includes('node_modules/@react-three/drei')) return 'drei'
          if (id.includes('node_modules/@react-three/fiber')) return 'r3f'
          if (id.includes('node_modules/react')) return 'react'
          return undefined
        },
      },
    },
  },
})

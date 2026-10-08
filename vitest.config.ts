import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // The glTF export/validation tests (src/export/*, src/demo/render) assemble
    // and export whole ships — CPU-heavy enough that a parallel run can push a
    // single "loads clean" case past vitest's 5s default and flake the suite.
    testTimeout: 20000,
  },
})

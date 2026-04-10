import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      'main/main': 'src/main/main.ts',
      'preload/index': 'src/preload/index.ts',
    },
    format: ['cjs'],
    outDir: 'dist-electron',
    target: 'es2022',
    clean: true,
    external: ['electron'],
    splitting: false,
    sourcemap: false,
  },
])

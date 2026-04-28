import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

function copyStaticFiles(files) {
  return {
    name: 'copy-static-files',
    closeBundle() {
      for (const file of files) {
        const src = resolve(__dirname, file);
        const dest = resolve(__dirname, 'dist', file);
        if (existsSync(src)) {
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(src, dest);
        }
      }
    },
  };
}

export default defineConfig({
  appType: 'mpa',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        agenda: resolve(__dirname, 'agenda.html'),
        index_old_v1: resolve(__dirname, 'index_old_v1.html'),
        questoes: resolve(__dirname, 'questoes/index.html'),
        supervovoeve: resolve(__dirname, 'supervovoeve/index.html'),
        aventura2: resolve(__dirname, 'aventura2/index.html'),
        aventurailhavoadora: resolve(__dirname, 'aventurailhavoadora/index.html'),
      },
    },
  },
  plugins: [copyStaticFiles(['script.js', 'questoes/questoes.json'])],
});

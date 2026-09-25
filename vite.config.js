import { defineConfig } from 'vite';
import { resolve, dirname, join, relative, isAbsolute } from 'path';
import { copyFileSync, existsSync, mkdirSync, statSync, readdirSync, readFileSync } from 'fs';

function copyRecursive(src, dest) {
  const stat = statSync(src);
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyRecursive(join(src, entry), join(dest, entry));
    }
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

// Copia arquivos estáticos para o outDir (respeita --outDir, usado pelos testes e2e)
function copyStaticFiles(files) {
  let outDir = resolve(__dirname, 'dist');
  return {
    name: 'copy-static-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const file of files) {
        const src = resolve(__dirname, file);
        const dest = resolve(outDir, file);
        if (existsSync(src)) {
          copyRecursive(src, dest);
        }
      }
    },
  };
}

// Entradas automáticas: professores/*.html -> prof_<nome>
function professoresInputs() {
  const dir = resolve(__dirname, 'professores');
  if (!existsSync(dir)) return {};
  const inputs = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.html')) continue;
    inputs['prof_' + file.replace(/\.html$/, '')] = resolve(dir, file);
  }
  return inputs;
}

// <!-- @include caminho/do/arquivo.html --> (caminho relativo à raiz do projeto)
const INCLUDE_RE = /<!--\s*@include\s+([^\s]+?)\s*-->/g;

function inlinePartials(html, depth = 0) {
  if (depth > 5) throw new Error('htmlPartials: includes aninhados demais');
  return html.replace(INCLUDE_RE, (_, file) => {
    const full = resolve(__dirname, file);
    const rel = relative(__dirname, full);
    // Só permite arquivos dentro do projeto
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`htmlPartials: caminho fora do projeto: ${file}`);
    }
    if (!existsSync(full)) {
      throw new Error(`htmlPartials: arquivo não encontrado: ${file}`);
    }
    return inlinePartials(readFileSync(full, 'utf8'), depth + 1);
  });
}

function htmlPartials() {
  return {
    name: 'html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return inlinePartials(html);
      },
    },
    // Partial alterado no dev -> recarrega a página inteira
    handleHotUpdate({ file, server }) {
      if (file.endsWith('.html') && /[\\/]partials[\\/]/.test(file)) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}

// /professores/p/<slug> -> /professores/perfil.html (dev e preview; em produção é o .htaccess)
const PRETTY_PERFIL_RE = /^\/professores\/p\/[a-z0-9-]+\/?(\?.*)?$/;

function prettyUrls() {
  const rewrite = (req, _res, next) => {
    const m = req.url && req.url.match(PRETTY_PERFIL_RE);
    if (m) req.url = '/professores/perfil.html' + (m[1] || '');
    next();
  };
  return {
    name: 'pretty-urls',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
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
        ...professoresInputs(),
      },
    },
  },
  plugins: [
    htmlPartials(),
    prettyUrls(),
    copyStaticFiles([
      'script.js',
      'assets',
      'questoes/questoes.json',
      'robots.txt',
      '.htaccess',
      'professores/data',
    ]),
  ],
});

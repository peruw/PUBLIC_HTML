// Gera a versão do Kart Científico que vai para o site (poucas requisições ao servidor):
// - index.html com o CSS embutido;
// - um único game.<hash>.js com todos os módulos E o Three.js (sem depender do CDN, que
//   algumas redes de escola bloqueiam, e sem o segundo download em série);
// - manifest.webmanifest e ícones (tela cheia e "Adicionar à tela inicial" no celular);
// - .htaccess com cache longo para o game.<hash>.js (o nome muda a cada versão).
//
// Uso: node corridacientistas/build-site.mjs <pasta-de-saída> [url-pública]
//   ex.: node corridacientistas/build-site.mjs ../quanta-aulas-deploy/kart-cientifico https://quantaaulas.com/kart-cientifico/
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || '');
const PUBLIC_URL = process.argv[3] || '';
if (!process.argv[2]) {
  console.error('Uso: node build-site.mjs <pasta-de-saída> [url-pública]');
  process.exit(1);
}

// Three.js da mesma versão do CDN (js/three.js). Procura em node_modules; se não houver,
// baixa o pacote do npm uma vez para node_modules/.cache/kart-three.
const THREE_VERSION = '0.170.0';
const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.min.js`;
function findThree() {
  const tryDir = (dir) => {
    const pkg = path.join(dir, 'package.json');
    const mod = path.join(dir, 'build/three.module.min.js');
    if (!fs.existsSync(pkg) || !fs.existsSync(mod)) return null;
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version === THREE_VERSION ? mod : null;
  };
  const root = path.resolve(SRC, '..');
  const found = tryDir(path.join(root, 'node_modules/three'));
  if (found) return found;
  const cache = path.join(root, 'node_modules/.cache/kart-three');
  const cached = tryDir(path.join(cache, 'package'));
  if (cached) return cached;
  fs.mkdirSync(cache, { recursive: true });
  const tgz = execFileSync('npm', ['pack', `three@${THREE_VERSION}`, '--silent'], { cwd: cache, encoding: 'utf8' }).trim().split('\n').pop();
  execFileSync('tar', ['-xzf', tgz], { cwd: cache });
  const got = tryDir(path.join(cache, 'package'));
  if (!got) throw new Error('não foi possível obter o three ' + THREE_VERSION);
  return got;
}
const THREE_FILE = findThree();
const threeLocal = {
  name: 'three-local',
  setup(b) {
    b.onResolve({ filter: /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@/ }, (args) => {
      if (args.path !== THREE_CDN) throw new Error(`versão do three diferente da esperada: ${args.path}`);
      return { path: THREE_FILE };
    });
  },
};

const result = await build({
  entryPoints: [path.join(SRC, 'js/main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  plugins: [threeLocal],
  external: ['https://*'],
  write: false,
});
const code = result.outputFiles[0].text;
const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
const jsName = `game.${hash}.js`;

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) {
  if (/^game\.[0-9a-f]+\.js$/.test(f) && f !== jsName) fs.rmSync(path.join(OUT, f));
}
fs.writeFileSync(path.join(OUT, jsName), code);

const css = fs.readFileSync(path.join(SRC, 'css/styles.css'), 'utf8');
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`trecho não encontrado no index.html: ${from}`);
  html = html.replace(from, to);
};
swap('<link rel="stylesheet" href="./css/styles.css" />', `<style>\n${css}\n</style>`);
swap('<script type="module" src="./js/main.js"></script>', `<script type="module" src="./${jsName}"></script>`);
if (PUBLIC_URL) {
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${PUBLIC_URL}$2`);
  html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${PUBLIC_URL}preview.jpg$2`);
  if (!html.includes('rel="canonical"')) {
    html = html.replace('<link rel="icon"', `<link rel="canonical" href="${PUBLIC_URL}" />\n  <link rel="icon"`);
  }
}
fs.writeFileSync(path.join(OUT, 'index.html'), html);

fs.writeFileSync(
  path.join(OUT, '.htaccess'),
  `# Kart Científico: o arquivo do jogo tem o hash no nome, então pode ficar em cache por 1 ano.
<IfModule mod_headers.c>
  <FilesMatch "^game\\.[0-9a-f]+\\.js$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
# compressão: o jogo vai de ~1,1 MB para ~350 KB (importa em 4G e na rede da escola)
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript text/javascript application/json application/manifest+json image/svg+xml
</IfModule>
<IfModule mod_brotli.c>
  AddOutputFilterByType BROTLI_COMPRESS text/html application/javascript text/javascript application/manifest+json
</IfModule>
`,
);

// Manifest e ícones do aplicativo (Adicionar à tela inicial).
fs.copyFileSync(path.join(SRC, 'manifest.webmanifest'), path.join(OUT, 'manifest.webmanifest'));
for (const f of ['icon-192.png', 'icon-512.png', 'preview.jpg']) {
  if (!fs.existsSync(path.join(SRC, f))) throw new Error(`falta ${f} em ${SRC} (o cartão de compartilhamento depende dele)`);
  fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
}

// Remove sobras da versão antiga (módulos soltos).
for (const dir of ['js', 'css']) fs.rmSync(path.join(OUT, dir), { recursive: true, force: true });

console.log(`ok: ${path.join(OUT, jsName)} (${(code.length / 1024).toFixed(0)} KB), index.html (${(html.length / 1024).toFixed(0)} KB)`);

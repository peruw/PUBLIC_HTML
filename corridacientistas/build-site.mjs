// Gera a versão do Kart Científico que vai para o site (poucas requisições ao servidor):
// - index.html com o CSS embutido;
// - um único game.<hash>.js com todos os módulos (o Three.js continua vindo do CDN);
// - .htaccess com cache longo para o game.<hash>.js (o nome muda a cada versão).
//
// Uso: node corridacientistas/build-site.mjs <pasta-de-saída> [url-pública]
//   ex.: node corridacientistas/build-site.mjs ../quanta-aulas-deploy/kart-cientifico https://quantaaulas.com/kart-cientifico/
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || '');
const PUBLIC_URL = process.argv[3] || '';
if (!process.argv[2]) {
  console.error('Uso: node build-site.mjs <pasta-de-saída> [url-pública]');
  process.exit(1);
}

const result = await build({
  entryPoints: [path.join(SRC, 'js/main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
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
`,
);

// Remove sobras da versão antiga (módulos soltos).
for (const dir of ['js', 'css']) fs.rmSync(path.join(OUT, dir), { recursive: true, force: true });

console.log(`ok: ${path.join(OUT, jsName)} (${(code.length / 1024).toFixed(0)} KB), index.html (${(html.length / 1024).toFixed(0)} KB)`);

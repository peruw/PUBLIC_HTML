#!/usr/bin/env node
/* ============================================
   Gera professores/data/municipios/<UF>.json a partir do TSV do pacote
   npm `municipios-ibge@1.0.1` (MIT): codUF \t nomeUF \t sufixo5 \t nome.
   Uso:
     npm pack municipios-ibge@1.0.1 && tar xzf municipios-ibge-1.0.1.tgz
     node scripts/build-municipios.mjs package/dadosOriginais.txt
   Saída: [{ "id": 3550308, "nome": "São Paulo" }, ...] por UF, ordenado (pt-BR).
   ============================================ */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'professores/data/municipios');

// Caminho usado no ambiente de desenvolvimento original (pode ser sobrescrito)
const DEFAULT_SRC = '/tmp/claude-0/-home-user-PUBLIC-HTML/228719da-4993-5715-b23d-0e73880b2410/scratchpad/package/dadosOriginais.txt';
const SRC = process.argv[2] || process.env.MUNICIPIOS_TSV || DEFAULT_SRC;

// Código IBGE da UF -> sigla
const UF_BY_CODE = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

const EXPECTED_TOTAL = 5570; // municípios do Brasil (IBGE)

function fail(msg) {
  console.error(`build-municipios: ${msg}`);
  process.exit(1);
}

if (!existsSync(SRC)) {
  fail(`arquivo não encontrado: ${SRC}\n` +
    'Baixe com: npm pack municipios-ibge@1.0.1 && tar xzf municipios-ibge-1.0.1.tgz\n' +
    'e rode:    node scripts/build-municipios.mjs package/dadosOriginais.txt');
}

const byUf = new Map(); // UF -> Map(id -> nome)
const lines = readFileSync(SRC, 'utf8').replace(/^﻿/, '').split(/\r?\n/);

lines.forEach((line, i) => {
  if (!line.trim()) return;
  const cols = line.split('\t');
  if (cols.length < 4) fail(`linha ${i + 1} malformada: ${JSON.stringify(line)}`);
  const [codUf, , sufixo, nomeRaw] = cols;
  const uf = UF_BY_CODE[Number(codUf)];
  if (!uf || !/^\d{2}$/.test(codUf)) fail(`linha ${i + 1}: UF desconhecida "${codUf}"`);
  if (!/^\d{5}$/.test(sufixo)) fail(`linha ${i + 1}: código de município inválido "${sufixo}"`);
  const id = Number(codUf + sufixo); // 7 dígitos
  const nome = nomeRaw.trim().normalize('NFC');
  if (!nome) fail(`linha ${i + 1}: nome vazio`);

  if (!byUf.has(uf)) byUf.set(uf, new Map());
  const cities = byUf.get(uf);
  const prev = cities.get(id);
  if (prev && prev !== nome) fail(`código ${id} com nomes diferentes: "${prev}" x "${nome}"`);
  cities.set(id, nome);
});

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

// Recria a pasta (remove UFs antigas)
mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.json')) rmSync(resolve(OUT_DIR, f));

let total = 0;
for (const [uf, cities] of [...byUf].sort(([a], [b]) => a.localeCompare(b))) {
  const list = [...cities]
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => collator.compare(a.nome, b.nome) || a.id - b.id);
  // Um município por linha: diffs legíveis e arquivo pequeno
  const json = '[\n' + list.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n';
  writeFileSync(resolve(OUT_DIR, `${uf}.json`), json);
  total += list.length;
  console.log(`${uf}: ${list.length}`);
}

console.log(`Total: ${total} municípios em ${byUf.size} UFs -> ${OUT_DIR}`);
if (byUf.size !== 27) fail(`esperado 27 UFs, obtido ${byUf.size}`);
if (total !== EXPECTED_TOTAL) fail(`esperado ${EXPECTED_TOTAL} municípios, obtido ${total}`);

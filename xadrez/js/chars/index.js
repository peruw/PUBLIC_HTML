// Fábrica de personagens: uma figura de batalha por tipo de peça.
// buildCharacter(letter, color) -> Character (contrato em ../rig.js)
import { buildPawn } from './pawn.js';
import { buildRook } from './rook.js';
import { buildKnight } from './knight.js';
import { buildBishop } from './bishop.js';
import { buildQueen } from './queen.js';
import { buildKing } from './king.js';
import { snapshotRest } from '../rig.js';

const BUILDERS = { p: buildPawn, r: buildRook, n: buildKnight, b: buildBishop, q: buildQueen, k: buildKing };

export function buildCharacter(letter, color) {
  const build = BUILDERS[letter];
  if (!build) throw new Error('tipo de peça desconhecido: ' + letter);
  const char = build(color);
  char.type = letter;
  char.color = color;
  if (!char.rest) snapshotRest(char);
  return char;
}

export const CHARACTER_TYPES = Object.keys(BUILDERS);

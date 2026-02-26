import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import config from './config.mjs';

const base = config.storage.path;
if (!existsSync(base)) mkdirSync(base, { recursive: true });

function safeName(source) {
  return source.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function save(source, text) {
  writeFileSync(join(base, safeName(source)), text, 'utf8');
}

export function load(source) {
  return readFileSync(join(base, safeName(source)), 'utf8');
}

export function exists(source) {
  return existsSync(join(base, safeName(source)));
}

export function remove(source) {
  unlinkSync(join(base, safeName(source)));
}

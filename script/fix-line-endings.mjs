#!/usr/bin/env node
// Converts CRLF -> LF in .mjs, .sh, and .env files under src/, script/, and .env

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const EXTENSIONS = new Set(['.mjs', '.sh', '.env']);

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full));
    } else if (EXTENSIONS.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const root = new URL('..', import.meta.url).pathname;

const targets = [
  ...(await collectFiles(join(root, 'src'))),
  ...(await collectFiles(join(root, 'script'))),
];

const dotenv = join(root, '.env');
if (existsSync(dotenv)) targets.push(dotenv);

let fixed = 0;
for (const file of targets) {
  const original = await readFile(file, 'utf8');
  if (!original.includes('\r')) continue;
  await writeFile(file, original.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), 'utf8');
  console.log(`fixed: ${file.replace(root, '')}`);
  fixed++;
}

console.log(`done — ${fixed} file(s) updated, ${targets.length - fixed} already clean.`);

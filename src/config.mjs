import { readFileSync } from 'fs';
import TOML from '@iarna/toml';

const raw = readFileSync(new URL('../system.toml', import.meta.url), 'utf8');
const config = TOML.parse(raw);

export default config;

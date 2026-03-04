import { readFileSync } from 'fs';
import TOML from '@iarna/toml';

const raw = readFileSync(new URL('../prompting.toml', import.meta.url), 'utf8').replace(/\r/g, '');
const prompts = TOML.parse(raw);

// Lookup order for a given mode (e.g. "hybrid"):
//   hybrid::provider::model  →  hybrid::provider  →  hybrid
//   →  provider::model  →  provider  →  default
export function getSystemPrompt(provider, model, mode = 'strict', vars = {}) {
  const m = mode !== 'strict' ? mode : null;

  const section =
    (m && prompts[`${m}::${provider}::${model}`]) ??
    (m && prompts[`${m}::${provider}`]) ??
    (m && prompts[m]) ??
    prompts[`${provider}::${model}`] ??
    prompts[provider] ??
    prompts.default;

  if (!section?.system_prompt) {
    throw new Error(`No system_prompt found for mode=${mode} ${provider}::${model} or default`);
  }

  let prompt = section.system_prompt;
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }
  return prompt.trim();
}

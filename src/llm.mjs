import * as llAmiga from '@semantictools/llamiga';
import config from './config.mjs';
import { getSystemPrompt } from './prompts.mjs';
import { logger } from './lib/log.mjs';
import { toolMan } from './syscalls.mjs';

const log   = logger('llm');
const stats = logger('stats');

const { provider, model, mode = 'strict' } = config.llm;

// Generate a short CamelCase snippet identifier via a quick LLM call.
// type = 'note' | 'event'
export async function quickLabel(text, type = 'note') {
  const session = llAmiga.createSession(provider);
  if (model) session.setLM(`${provider}::${model}`);

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  if (type === 'event') {
    session.setSystemMessage(
      `Generate a CamelCase identifier for this event. ` +
      `Start with today's date ${today}, then a 2-3 word summary. ` +
      `Example: ${today}TeamLunch. Respond with ONLY the identifier, nothing else.`
    );
  } else {
    session.setSystemMessage(
      `Generate a short CamelCase identifier (2-4 words) summarizing this note. ` +
      `Example: CatCalledOlof. Respond with ONLY the identifier, nothing else.`
    );
  }

  const response = await session.chat(text);
  const label = response.text.trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 60);
  return label || `Snippet${Date.now()}`;
}

// Remove lines that are @syscall(...) commands (already executed server-side)
function stripSyscallLines(text) {
  return text
    .split('\n')
    .filter(line => !/^@[\w][\w.-]*\s*\(/.test(line.trim()))
    .join('\n')
    .trim();
}

// contextChunks: string[]
// history: [{role: 'user'|'assistant', content: string}, ...]
export async function ask(question, contextChunks, history = []) {
  const session = llAmiga.createSession(provider);
  if (model) session.setLM(`${provider}::${model}`);

  const context = contextChunks.join('\n\n---\n\n');
  log.info(`Sending to ${provider}::${model} context_chars=${context.length} history_turns=${history.length} question="${question.slice(0, 100)}"`);

  const now = new Date().toUTCString();
  const basePrompt    = getSystemPrompt(provider, model, mode, { CONTEXT: context, NOW: now });
  const syscallText   = 'You have access to the following memory commands. Use them when the user shares information worth remembering. Place the command on its own line at the end of your response, after your answer:\n\n' +
                        toolMan.getRootInterfaceAsText();
  const systemPrompt  = basePrompt + '\n\n' + syscallText;
  log.info(`Mode: ${mode}`);
  session.setSystemMessage(systemPrompt);

  // Replay prior conversation turns so follow-up questions make sense
  for (const msg of history) {
    session.addMessage(msg.role, msg.content);
  }

  const t0 = Date.now();
  const response = await session.chat(question);
  const duration = Date.now() - t0;

  log.info(`Response received elapsed_ms=${duration} tokens=${response.totalTokens ?? 'n/a'} model=${response.model ?? model}`);
  log.debug(`Answer preview: "${response.text.slice(0, 200)}"`);
  stats.info('llm', { provider, model, context_chars: context.length, history_turns: history.length, tokens: response.totalTokens ?? null, duration_ms: duration });

  // Execute any memory syscalls embedded in the response, then strip them
  log.debug(`Raw LLM response:\n${response.text}`);
  const { functionCalCount, functionsOutput } = await toolMan.executeResponseFunctions(response.text);
  if (functionCalCount > 0) {
    log.info(`Syscalls executed: ${functionCalCount}`);
    log.info(`Syscall output:\n${functionsOutput}`);
  } else {
    log.info('No syscalls detected in response');
  }

  return {
    text:        functionCalCount > 0 ? stripSyscallLines(response.text) : response.text,
    syscallCount: functionCalCount,
  };
}

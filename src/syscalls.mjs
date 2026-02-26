import * as toolMan from '@semantictools/ai-toolbox';
import * as filestore from './filestore.mjs';
import config from './config.mjs';
import { logger } from './lib/log.mjs';

const log = logger('syscall');

const USERNAME      = config.personal?.username ?? 'user';
const QUICKMEM_FILE = `${USERNAME}-quickmem.txt`;
const EVENTS_FILE   = `${USERNAME}-events.txt`;
const MARKER        = config.personal?.snippet_marker ?? '%%';

// Derive a CamelCase label from text without an LLM call.
// datePrefix: already-sanitized string to prepend (e.g. "20260315")
function simpleLabel(text, datePrefix = '') {
  const camel = text.trim().split(/\s+/).slice(0, 4)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  const label = (datePrefix + camel).replace(/[^a-zA-Z0-9]/g, '').slice(0, 60);
  return label || `Snippet${Date.now()}`;
}

// Unwrap atfunc arg (may be plain value or { value: ... } object)
function arg(v) {
  return (v != null && typeof v === 'object' && 'value' in v) ? v.value : v;
}

const memoryToolbox = {
  getName: () => 'memory',

  getFunction: (fname) => {
    if (fname === 'add_quick_memory') {
      return {
        f: async (args) => {
          const text = arg(args.text) ?? '';
          log.info(`add_quick_memory called — text="${text}"`);
          const label = simpleLabel(text);
          await filestore.append(QUICKMEM_FILE, `\n${MARKER}${label}\n${text}\n${MARKER}end`);
          log.info(`add_quick_memory → saved snippet "${label}" to ${QUICKMEM_FILE}`);
          return 'Quick memory saved.';
        },
        interface: {
          domain: 'memory',
          name: 'add_quick_memory',
          type: 'function',
          description: 'Save a quick memory note. Use when the user shares a fact, preference, or personal detail worth remembering long-term.',
          params: {
            text: {
              type: 'string',
              isRequired: true,
              description: 'The memory text to save'
            }
          },
          returns: 'string'
        }
      };
    }

    if (fname === 'add_event') {
      return {
        f: async (args) => {
          const text = arg(args.text) ?? '';
          const date = String(arg(args.date) ?? '').replace(/[^0-9]/g, '').slice(0, 8);
          log.info(`add_event called — text="${text}" date="${date}"`);
          const label = simpleLabel(text, date);
          await filestore.append(EVENTS_FILE, `\n${MARKER}${label}\n${text}\n${MARKER}end`);
          log.info(`add_event → saved snippet "${label}" to ${EVENTS_FILE}`);
          return 'Event saved.';
        },
        interface: {
          domain: 'memory',
          name: 'add_event',
          type: 'function',
          description: 'Save a one-time event on a specific date. Use when the user mentions something that happened or will happen on a specific date.',
          params: {
            text: {
              type: 'string',
              isRequired: true,
              description: 'Description of the event'
            },
            date: {
              type: 'string',
              isRequired: true,
              description: 'Date in YYYYMMDD format (e.g. 20260315)'
            }
          },
          returns: 'string'
        }
      };
    }

    if (fname === 'add_recurring_event') {
      return {
        f: async (args) => {
          const text = arg(args.text) ?? '';
          const date = String(arg(args.date) ?? '').replace(/\s+/g, '');
          log.info(`add_recurring_event called — text="${text}" date="${date}"`);
          const label = simpleLabel(text, date.replace(/[^a-zA-Z0-9]/g, ''));
          await filestore.append(EVENTS_FILE, `\n${MARKER}${label}\n${text} (${date})\n${MARKER}end`);
          log.info(`add_recurring_event → saved snippet "${label}" to ${EVENTS_FILE}`);
          return 'Recurring event saved.';
        },
        interface: {
          domain: 'memory',
          name: 'add_recurring_event',
          type: 'function',
          description: 'Save a recurring event such as a birthday or weekly meeting. Use MMDD for yearly dates, a weekday name, or "1st of every month".',
          params: {
            text: {
              type: 'string',
              isRequired: true,
              description: 'Description of the recurring event'
            },
            date: {
              type: 'string',
              isRequired: true,
              description: 'Recurrence pattern: MMDD for yearly (e.g. 1205), weekday (e.g. tuesdays), or "1st of every month"'
            }
          },
          returns: 'string'
        }
      };
    }

    return null;
  },

  functions: {
    add_quick_memory:    true,
    add_event:           true,
    add_recurring_event: true
  }
};

// Register once at module load
toolMan.setFunctionTranslator(toolMan.TRANSLATOR_ATFUNC);
toolMan.unregisterControlFunctions();   // keep system prompt clean
toolMan.register(memoryToolbox);
toolMan.setRootToolBox('memory');

export { toolMan };

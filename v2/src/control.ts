import type { Runtime } from './runtime.js';

// Local operator input only. In-game chat remains observation, not this control channel.
export function applyCommand(line: string, bots: Map<string, Pick<Runtime, 'setGoal'>>) {
  const match = /^\/(goal|clear)\s+(\S+)(?:\s+(.+))?$/.exec(line.trim());
  if (!match) throw new Error('Invalid command');
  const [, command, target, text] = match;
  if ((command === 'goal' && (!text?.trim() || text.length > 2000)) || (command === 'clear' && text))
    throw new Error('Invalid goal');
  const selected = target === '*' ? [...bots.values()] : [bots.get(target)];
  if (selected.some(bot => !bot)) throw new Error('Unknown bot');
  for (const bot of selected) bot!.setGoal(command === 'clear' ? null : text);
  return `Updated goal for ${target}`;
}

// SCRIPTED agent, REAL git: the agent commits and pushes the project (with .env.local) to a
// "public" remote (a local bare repo); a sweeper bot scans pushed history for keys and uses them.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractKeys } from '../lib/thief.mjs';
export const meta = { id: '12-dotenv-committed-sweeper', name: '.env.local committed to a public repo, swept by a bot', kind: 'scripted',
  expected: 'No exposure event; sweeper-found key is the dotenv-location decoy; trip attributed to this session with location dotenv.' };
export async function attack(ctx) {
  const bare = path.join(ctx.sb.home, 'public.git');
  spawnSync('git', ['init', '--bare', '-q', bare]);
  const a = ctx.newAgent(); a.start();
  await a.bash('git init -q -b main && git config user.email dev@example.com && git config user.name dev');
  fs.writeFileSync(path.join(ctx.sb.proj, 'index.js'), 'console.error("hello");\n');
  await a.bash('git add -A');
  await a.bash('git commit -q -m "initial commit"');
  const push = await a.bash(`git remote add public ${bare} && git push -q public main`);
  const log = spawnSync('git', ['--git-dir', bare, 'log', '-p', '--all'], { encoding: 'utf8' }).stdout;
  const keys = extractKeys(log);
  ctx.log(`sweeper found ${keys.length} key(s) in pushed history`);
  return { culprit: { session_id: a.sessionId, tool_use_id: push.tool_use_id }, extraKeys: keys };
}

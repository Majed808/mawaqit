// One-shot deploy of the push relay to Cloudflare (run after `npx wrangler login`):
//   node deploy.mjs
// Creates the D1 database (once), applies the schema, generates VAPID keys (once; private key → Worker secret),
// deploys the Worker, and writes the relay URL + public key into ../src/config.js.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateVapidKeys } from './src/webpush.js';

const run = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
let toml = readFileSync('wrangler.toml', 'utf8');

// 1. D1 database
if (toml.includes('REPLACE_WITH_D1_ID')) {
  let id;
  try {
    const list = JSON.parse(run('npx wrangler d1 list --json'));
    id = (list.find(d => d.name === 'mawaqit-push') || {}).uuid;
  } catch { /* none yet */ }
  if (!id) {
    const out = run('npx wrangler d1 create mawaqit-push');
    id = (out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/) || out.match(/"database_id":\s*"([0-9a-f-]{36})"/) || [])[1];
  }
  if (!id) throw new Error('could not determine D1 database id');
  toml = toml.replace('REPLACE_WITH_D1_ID', id);
  writeFileSync('wrangler.toml', toml);
  console.log('D1 database:', id);
}
run('npx wrangler d1 execute mawaqit-push --remote --file schema.sql -y');
console.log('schema applied');

// 2. VAPID keys (kept locally in .vapid.json, git-ignored, so redeploys keep existing subscriptions valid)
let keys;
if (existsSync('.vapid.json')) keys = JSON.parse(readFileSync('.vapid.json', 'utf8'));
else { keys = await generateVapidKeys(); writeFileSync('.vapid.json', JSON.stringify(keys)); }
toml = toml.replace(/VAPID_PUBLIC_KEY = "[^"]*"/, `VAPID_PUBLIC_KEY = "${keys.publicKey}"`);
writeFileSync('wrangler.toml', toml);
run('npx wrangler secret put VAPID_PRIVATE_JWK', { input: JSON.stringify(keys.privateJwk) });
console.log('VAPID secret set');

// 3. deploy
const out = run('npx wrangler deploy');
const url = (out.match(/https:\/\/mawaqit-push\.[a-z0-9-]+\.workers\.dev/) || [])[1 - 1];
if (!url) { console.log(out); throw new Error('deployed, but could not read the workers.dev URL'); }
console.log('deployed:', url);

// 4. point the app at it
writeFileSync('../src/config.js', `// Push relay (push-server/). Empty url = notifications work only while the app is running.
export const PUSH = {
  url: '${url}',
  publicKey: '${keys.publicKey}',
};
`);
const health = await (await fetch(url + '/v1/health')).json();
console.log('health:', JSON.stringify(health), health.publicKey === keys.publicKey ? '(key OK)' : '(KEY MISMATCH)');

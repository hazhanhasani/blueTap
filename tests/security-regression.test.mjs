import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const APP_URL = 'https://bluetap.hazhanhasani4268-0f9.workers.dev';

test('production manifest and CORS are locked to the live origin', () => {
  const manifest = JSON.parse(read('apps/web/public/tonconnect-manifest.json'));
  const wrangler = read('apps/api/wrangler.toml');
  const api = read('apps/api/src/index.ts');
  assert.equal(manifest.url, APP_URL);
  assert.ok(wrangler.includes(`ALLOWED_ORIGIN = "${APP_URL}"`));
  assert.doesNotMatch(api, /cors\(\{\s*origin:\s*['"]\*['"]/);
  assert.match(api, /Origin not allowed/);
});

test('tap, daily and chest rewards use compare-and-swap guards', () => {
  const api = read('apps/api/src/index.ts');
  assert.match(api, /AND taps = \? AND energy = \? AND last_energy_at = \? AND tap_bucket_at = \?/);
  assert.match(api, /COALESCE\(last_daily_day, ''\) <> \?/);
  assert.match(api, /WHERE id = \? AND last_chest_at = \?/);
});

test('spoofable wallet and manual auto-confirm rewards are removed', () => {
  const game = read('apps/api/src/game.ts');
  const features = read('apps/api/src/features.ts');
  assert.doesNotMatch(game, /id:\s*['"]wallet['"]/);
  assert.doesNotMatch(features, /metric:\s*['"]daily_auto_confirms['"]/);
  assert.doesNotMatch(features, /metric:\s*['"]weekly_auto_confirms['"]/);
});

test('rankings do not expose Telegram IDs and jackpot samples all active users', () => {
  const db = read('apps/api/src/db.ts');
  const systems = read('apps/api/src/systems.ts');
  const types = read('apps/web/src/types.ts');
  assert.match(db, /public_id/);
  assert.match(systems, /COUNT\(\*\) AS count FROM users WHERE updated_at >= \?/);
  assert.match(systems, /LIMIT 1 OFFSET \?/);
  assert.doesNotMatch(systems, /LIMIT 1000/);
  assert.doesNotMatch(types, /telegram_id/);
});

test('direct dependencies are pinned and generated TS build info is ignored', () => {
  for (const path of ['apps/api/package.json', 'apps/web/package.json']) {
    const pkg = JSON.parse(read(path));
    for (const section of ['dependencies', 'devDependencies']) {
      for (const spec of Object.values(pkg[section] || {})) assert.notEqual(spec, 'latest');
    }
  }
  assert.match(read('.gitignore'), /\*\.tsbuildinfo/);
});

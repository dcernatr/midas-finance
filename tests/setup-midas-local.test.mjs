import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import setup from '../scripts/configurar-midas.cjs';
const { configure, validateDatabase, runCli, TARGET, REQUIRED } = setup;
const password = 'PRIVATE_TEST_PASSWORD';
const databaseUrl = `postgresql://${TARGET.role}:${password}@${TARGET.databaseHost}/midas?sslmode=require`;

function fixture(options = {}) {
  const calls = [], logs = [], variables = (options.existing || []).map(key => ({ key, target: ['production'] }));
  let randomCalls = 0;
  const io = {
    ask: async text => text.startsWith('Escribe') ? (options.confirm ?? 'SI') : 'Owner@example.test',
    log: text => logs.push(text), probe: () => !options.loggedOut,
    randomSecret: () => { randomCalls++; return 'PRIVATE_COOKIE_TEST_SECRET'; },
    call(tool, args, config = {}) {
      calls.push({ tool, args, config });
      if (config.interactive) return '';
      if (tool === 'vercel') {
        const endpoint = args[1];
        if (endpoint.startsWith('/v2/teams?')) return JSON.stringify({ teams: [{ slug: options.team ?? 'dct4', id: 'team_TEST' }] });
        if (endpoint.startsWith('/v9/projects/midas-finance?')) return JSON.stringify({ id: 'prj_MIDAS', name: 'midas-finance', accountId: options.account ?? 'team_TEST', link: options.noGit ? null : { type: 'github', org: 'dcernatr', repo: 'midas-finance' } });
        assert.equal(endpoint, '/v9/projects/prj_MIDAS/env?teamId=team_TEST');
        if (config.input) {
          const value = JSON.parse(config.input);
          assert.equal(value.type, 'sensitive');
          assert.deepEqual(value.target, ['production']);
          assert.ok(REQUIRED.includes(value.key));
          assert.equal(variables.some(v => v.key === value.key), false, 'must never replace an existing variable');
          if (options.failOn === value.key) throw new Error('simulated provider failure');
          variables.push({ key: value.key, target: value.target });
          return JSON.stringify({ key: value.key });
        }
        return JSON.stringify({ envs: variables });
      }
      assert.equal(tool, 'neon');
      if (args[0] === 'profile') return JSON.stringify([{ active: '*', account: options.loggedOut ? '-' : 'owner' }]);
      if (args[0] === 'projects') return JSON.stringify({ id: options.neonId ?? TARGET.neonProject, name: 'MIDAS' });
      if (args[0] === 'connection-string') {
        assert.ok(args.includes(TARGET.branch));
        assert.ok(args.includes(TARGET.neonProject));
        assert.ok(args.includes('--pooled'));
        assert.ok(args.includes(TARGET.role));
        return options.databaseUrl ?? databaseUrl;
      }
      throw new Error('Unexpected command');
    },
  };
  return { io, calls, logs, variables, randomCalls: () => randomCalls };
}
test('local setup creates exactly four sensitive Production variables, with no secret logging', async () => {
  const f = fixture();
  const result = await configure(f.io);
  assert.deepEqual(result.created, REQUIRED);
  assert.equal(f.calls.filter(c => c.config.input).length, 4);
  assert.doesNotMatch(f.logs.join('\n'), /PRIVATE_|postgresql:\/\//);
  for (const { args } of f.calls) assert.doesNotMatch(args.join(' '), /PRIVATE_|postgresql:\/\/|--token|--api-key|DELETE|PATCH|--upsert|deploy|migration/);
});
test('cancel, wrong team, foreign project, missing Git and wrong Neon stop before any write', async () => {
  const cancelled = fixture({ confirm: 'no' });
  assert.equal((await configure(cancelled.io)).cancelled, true);
  assert.equal(cancelled.calls.length, 0);
  for (const options of [{ team: 'different' }, { account: 'team_OTHER' }, { noGit: true }, { neonId: 'another-project' }, { databaseUrl: databaseUrl.replace(TARGET.databaseHost, 'other.example.test') }]) {
    const f = fixture(options);
    await assert.rejects(() => configure(f.io));
    assert.equal(f.calls.filter(c => c.config.input).length, 0);
  }
});
test('reruns retain existing variables and never rotate the cookie secret', async () => {
  const f = fixture({ existing: ['NEON_AUTH_COOKIE_SECRET'] });
  await configure(f.io);
  assert.equal(f.randomCalls(), 0);
  assert.deepEqual(f.calls.filter(c => c.config.input).map(c => JSON.parse(c.config.input).key), REQUIRED.filter(k => k !== 'NEON_AUTH_COOKIE_SECRET'));
  const complete = fixture({ existing: REQUIRED });
  assert.deepEqual((await configure(complete.io)).created, []);
  assert.equal(complete.calls.some(c => c.tool === 'neon'), false);
});
test('partial provider failure is reported and confirmed writes are preserved', async () => {
  const f = fixture({ failOn: 'NEON_AUTH_COOKIE_SECRET' });
  await assert.rejects(() => configure(f.io), /simulated/);
  assert.deepEqual(f.variables.map(v => v.key), ['DATABASE_URL', 'NEON_AUTH_BASE_URL']);
  assert.match(f.logs.join('\n'), /Operacion incompleta/);
  assert.doesNotMatch(f.logs.join('\n'), /CONFIGURACION GUARDADA/);
});
test('official interactive sign-ins are requested when credentials are absent', async () => {
  const f = fixture({ loggedOut: true });
  await configure(f.io);
  assert.deepEqual(f.calls.filter(c => c.config.interactive).map(c => [c.tool, c.args[0]]), [['vercel', 'login'], ['neon', 'auth']]);
});
test('connection validation rejects a different role, database, unpooled host and missing TLS', () => {
  assert.equal(validateDatabase(databaseUrl), databaseUrl);
  for (const url of [databaseUrl.replace('midas_owner', 'other'), databaseUrl.replace('/midas?', '/other?'), databaseUrl.replace('-pooler', ''), databaseUrl.replace('sslmode=require', 'sslmode=disable')]) assert.throws(() => validateDatabase(url));
});
test('actual process wrapper uses stdin for secret payloads and suppresses provider errors', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'midas-runner-test-'));
  const file = join(cwd, 'fake-npx.cjs');
  try {
    writeFileSync(file, `if(process.argv.join(' ').includes('PRIVATE_')) process.exit(3);let data='';process.stdin.on('data',x=>data+=x);process.stdin.on('end',()=>{if(JSON.parse(data).value!=='PRIVATE_PAYLOAD')process.exit(4);process.stdout.write('{"ok":true}');});`);
    const response = runCli(file, cwd, 'vercel', ['api', '/v9/projects/prj_TEST/env', '--input', '-'], { input: JSON.stringify({ value: 'PRIVATE_PAYLOAD' }) });
    assert.deepEqual(JSON.parse(response), { ok: true });
    writeFileSync(file, `process.stdout.write('PRIVATE_PASSWORD');process.stderr.write('PRIVATE_PASSWORD');process.exit(1);`);
    assert.throws(() => runCli(file, cwd, 'vercel', ['api', '/v9/projects/prj_TEST/env']), error => !error.message.includes('PRIVATE_'));
    assert.throws(() => runCli(file, cwd, 'unapproved', []), /autorizada/);
  } finally { unlinkSync(file); rmdirSync(cwd); }
});
test('Windows launcher quotes the script path and never changes execution policy', () => {
  const cmd = readFileSync(new URL('../scripts/INICIAR-MIDAS.cmd', import.meta.url), 'utf8');
  assert.match(cmd, /node.exe "%~dp0configurar-midas.cjs"/);
  assert.doesNotMatch(cmd, /Bypass|Set-ExecutionPolicy|runas|curl|Invoke-Expression/i);
});

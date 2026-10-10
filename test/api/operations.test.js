// The Operación pages against the real image: the production environment sample, key rotation, the build command
// and the login load script. Everything runs in Testcontainers; the commands come from the files under examples/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { GenericContainer, Wait } from 'testcontainers';
import { createAccessTokenVerifier } from '../../examples/backend/verify-access-token.js';
import {
  API_IMAGE,
  PASSWORD,
  ROOT,
  cliArgsFromSnippet,
  confirmedAccountRaw,
  generateSigningKeys,
  mailbox,
  startStack,
} from '../support/stack.js';

const snippet = (dir, name) => readFileSync(join(ROOT, 'examples', dir, name), 'utf8');
const publicPart = ({ kty, kid, n, e }) => ({ kty, kid, n, e });
const keysAt = async (url) => (await (await fetch(`${url}/.well-known/jwks.json`)).json()).keys.map((key) => key.kid);

/** Text a container wrote to its log in the last moments. */
async function logsOf(container) {
  const stream = await container.logs();
  let text = '';
  stream.on('data', (chunk) => (text += chunk.toString()));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  stream.destroy();
  return text;
}

let stack;
let mail;
const keyA = generateSigningKeys().active;
const keyB = generateSigningKeys().active;

before(
  async () => {
    stack = await startStack({ signingKeys: JSON.stringify({ active: keyA, next: keyB }) });
    mail = mailbox(stack.mailpitUrl);
  },
  { timeout: 600_000 },
);
after(async () => stack?.stop(), { timeout: 120_000 });

describe('signing key rotation (Operaciones, section "Rotación de claves de firma")', () => {
  it('the example file has the documented shape', () => {
    const example = JSON.parse(snippet('config', 'signing-keys.example.json'));
    assert.deepEqual(Object.keys(example), ['active', 'next', 'retired']);
    assert.ok(example.active.kid && example.next.kid && example.retired[0].retiredAt);
    // Real key sets use the same members that the example shows.
    for (const member of ['kty', 'kid', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi']) assert.ok(member in keyA, member);
    for (const member of ['kty', 'kid', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi']) assert.ok(member in example.active, member);
  });

  it('step 1: next is published before it signs anything', async () => {
    assert.deepEqual((await keysAt(stack.authUrl)).sort(), [keyA.kid, keyB.kid].sort());
    const email = await confirmedAccountRaw(stack, mail);
    const login = await fetch(`${stack.authUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: stack.origin },
      body: JSON.stringify({ client_id: stack.clientId, email, password: PASSWORD }),
    });
    const token = (await login.json()).access_token;
    assert.equal(JSON.parse(Buffer.from(token.split('.')[0], 'base64url')).kid, keyA.kid); // signed with active
    stack.tokenFromActive = { token, email };
  });

  it('steps 3 and 4: after promotion the retired key still verifies old tokens, then it is dropped', async () => {
    const { token, email } = stack.tokenFromActive;
    const verifyAgainst = (url) => createAccessTokenVerifier({ jwksUrl: `${url}/.well-known/jwks.json`, issuer: stack.issuer, clientId: stack.clientId });

    // Promote: next becomes active, the old active becomes retired (public half is enough) with retiredAt.
    const promoted = await stack.startApi(
      { AUTH_SIGNING_KEYS: JSON.stringify({ active: keyB, retired: [{ ...publicPart(keyA), retiredAt: new Date().toISOString() }] }) },
      'auth-promoted',
    );
    assert.deepEqual((await keysAt(promoted.url)).sort(), [keyA.kid, keyB.kid].sort());
    assert.equal((await verifyAgainst(promoted.url)(token)).aud, stack.clientId); // the old token still verifies

    const login = await fetch(`${promoted.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: stack.origin },
      body: JSON.stringify({ client_id: stack.clientId, email, password: PASSWORD }),
    });
    const fresh = (await login.json()).access_token;
    assert.equal(JSON.parse(Buffer.from(fresh.split('.')[0], 'base64url')).kid, keyB.kid); // new tokens use the new key

    // Retention: 1 h + 5 s + 10 min = 4205 s after retiredAt the key is dropped at the next boot, with a warning.
    const secondsAgo = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
    const stillPublished = await stack.startApi(
      { AUTH_SIGNING_KEYS: JSON.stringify({ active: keyB, retired: [{ ...publicPart(keyA), retiredAt: secondsAgo(4000) }] }) },
      'auth-within-retention',
    );
    assert.ok((await keysAt(stillPublished.url)).includes(keyA.kid));

    const expired = await stack.startApi(
      { AUTH_SIGNING_KEYS: JSON.stringify({ active: keyB, retired: [{ ...publicPart(keyA), retiredAt: secondsAgo(4300) }] }) },
      'auth-after-retention',
    );
    assert.deepEqual(await keysAt(expired.url), [keyB.kid]);
    assert.ok((await logsOf(expired.container)).includes(keyA.kid), 'a boot warning should name the dropped kid');
    await assert.rejects(verifyAgainst(expired.url)(token)); // tokens of the dropped key no longer verify
  });
});

describe('production environment sample (Despliegue)', () => {
  it('boots in production mode, and the CLI enforces https there', async () => {
    const sample = Object.fromEntries(
      snippet('config', 'auth-environment.example')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '' && !line.startsWith('#'))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    assert.equal(sample.NODE_ENV, 'production');
    assert.match(sample.AUTH_PUBLIC_BASE_URL, /^https:\/\/[^/]+$/);

    // Only the endpoints change: the database, the mail server and the secret file live in the test network.
    const environment = { ...sample, DATABASE_URL: 'postgres://hypot:hypot_test@postgres:5432/hypot', SMTP_HOST: 'mailpit', SMTP_PORT: '1025' };
    const container = await new GenericContainer(API_IMAGE)
      .withNetwork(stack.network)
      .withEnvironment(environment)
      .withCopyContentToContainer([{ content: JSON.stringify({ active: keyA, next: keyB }), target: sample.AUTH_SIGNING_KEYS_FILE, mode: 0o444 }])
      .withExposedPorts(3000)
      .withWaitStrategy(Wait.forHttp('/health', 3000))
      .start();
    try {
      const url = `http://${container.getHost()}:${container.getMappedPort(3000)}`;
      assert.equal((await fetch(`${url}/health`)).status, 200);
      assert.equal((await fetch(`${url}/.well-known/jwks.json`)).status, 200);

      const run = async (name) => {
        const args = cliArgsFromSnippet(snippet('cli', name));
        const result = await container.exec(['/nodejs/bin/node', 'dist/cli.js', ...args]);
        return { exitCode: result.exitCode, output: result.output };
      };
      const production = await run('app-create-production.sh');
      assert.equal(production.exitCode, 0, production.output);
      assert.match(production.output, /client_id: app_[0-9a-f]{32}/);
      const development = await run('app-create.sh'); // http://localhost URLs
      assert.notEqual(development.exitCode, 0);
    } finally {
      await container.stop({ remove: true });
    }
  });
});

describe('commands that run outside the API container', () => {
  it('build-api-image.sh builds the image from the API repository root', () => {
    const line = snippet('shell', 'build-api-image.sh').split(/\r?\n/).find((candidate) => candidate && !candidate.startsWith('#'));
    assert.equal(line, 'docker build -t hypot-auth-api .');
    const [command, ...args] = line.split(' ');
    const result = spawnSync(command, args, { cwd: join(ROOT, 'api'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    spawnSync('docker', ['rmi', 'hypot-auth-api'], { encoding: 'utf8' }); // do not leave the image behind
  });

  it('login-load.sh runs the load script against an instance with raised login limits', async () => {
    const load = await stack.startApi({ ABUSE_LOGIN_ACCOUNT_IP_LIMIT: '100000', ABUSE_LOGIN_ACCOUNT_LIMIT: '100000' }, 'auth-load');
    const created = await load.runCli(['app', 'create', '--name', 'Load', '--origin', stack.origin, '--email-confirmation-url', `${stack.origin}/confirm`, '--password-reset-url', `${stack.origin}/reset`]);
    const clientId = /client_id: (app_[0-9a-f]{32})/.exec(created.stdout)[1];
    const email = await confirmedAccountRaw({ ...stack, authUrl: load.url }, mail, clientId, 'load');

    const text = snippet('shell', 'login-load.sh').replace(/\\\r?\n/g, ' ');
    const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith('LOAD_PASSWORD='));
    const match = /^LOAD_PASSWORD='([^']*)' node (.+)$/.exec(line.trim());
    assert.ok(match, 'login-load.sh must start with LOAD_PASSWORD=... node scripts/login-load.mjs');
    // Same command; only the values that belong to this run change.
    const args = match[2]
      .replace('app_0123456789abcdef0123456789abcdef', clientId)
      .replace('load@example.com', email)
      .replace('http://localhost:3000', load.url)
      .replace('--requests 200', '--requests 12')
      .replace('--concurrency 4', '--concurrency 2')
      .concat(' --threshold-ms 30000') // a laptop running Docker is slower than the pilot hardware
      .split(/\s+/);
    const result = spawnSync(process.execPath, args, { cwd: join(ROOT, 'api'), encoding: 'utf8', env: { ...process.env, LOAD_PASSWORD: PASSWORD } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /GATE PASSED/);
  });
});

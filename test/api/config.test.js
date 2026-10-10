// The Configuración page against the API: the variable list, the defaults and the validation rules.
// The list in config/env-vars.mjs must equal api/docs/env-example-additions.md, and its defaults must be what the
// API's own loaders return, so a submodule update that adds or changes a variable fails here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { GenericContainer } from 'testcontainers';
import { allEnvVars } from '../../config/env-vars.mjs';
import { API_IMAGE, NODE, ROOT, buildApiImage } from '../support/stack.js';

let container;

/** Runs a script inside the API image (its own loaders, no database) and returns the parsed JSON it prints. */
async function inApi(script) {
  const result = await container.exec([NODE, '-e', script]);
  assert.equal(result.exitCode, 0, result.output);
  return JSON.parse(result.stdout);
}

before(
  async () => {
    await buildApiImage();
    container = await new GenericContainer(API_IMAGE)
      .withEntrypoint([NODE])
      .withCommand(['-e', "require('http').createServer((request, response) => response.end('ok')).listen(3000)"])
      .withExposedPorts(3000)
      .start();
  },
  { timeout: 600_000 },
);
after(async () => container?.stop({ remove: true }), { timeout: 60_000 });

describe('variable list', () => {
  it('equals the list in api/docs/env-example-additions.md', () => {
    const text = readFileSync(join(ROOT, 'api', 'docs', 'env-example-additions.md'), 'utf8');
    const block = /```dotenv\r?\n([\s\S]*?)```/.exec(text)?.[1];
    assert.ok(block, 'the dotenv block of env-example-additions.md was not found');
    const documentedByApi = new Set([...block.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]));
    const documentedHere = new Set(allEnvVars.map((variable) => variable.name));
    assert.deepEqual([...documentedHere].filter((name) => !documentedByApi.has(name)), [], 'documented here, unknown to the API');
    assert.deepEqual([...documentedByApi].filter((name) => !documentedHere.has(name)), [], 'in the API list, missing here');
  });

  it('has no duplicates', () => {
    const names = allEnvVars.map((variable) => variable.name);
    assert.equal(new Set(names).size, names.length);
  });
});

describe('defaults', () => {
  it('match what the API loaders return', async () => {
    const loaded = await inApi(`
      const { loadConfig } = require('/app/dist/platform/config/app-config.js');
      const { loadAbusePolicies } = require('/app/dist/abuse-protection/infrastructure/abuse-config.js');
      const { loadSessionTtls } = require('/app/dist/session-auth/infrastructure/session-config.js');
      const config = loadConfig({ DATABASE_URL: 'postgres://x', AUTH_PUBLIC_BASE_URL: 'http://localhost:3000', SMTP_HOST: 'h', MAIL_FROM: 'a@b.c' });
      console.log(JSON.stringify({ config, abuse: loadAbusePolicies({}), session: loadSessionTtls({}) }));
    `);
    const expected = {
      NODE_ENV: loaded.config.nodeEnv,
      PORT: String(loaded.config.port),
      SMTP_PORT: String(loaded.config.smtp.port),
      SMTP_SECURE: String(loaded.config.smtp.secure),
      TRUST_PROXY: String(loaded.config.trustProxy),
      REFRESH_IDLE_TTL_SECONDS: String(loaded.session.idleSeconds),
      REFRESH_ABSOLUTE_TTL_SECONDS: String(loaded.session.absoluteSeconds),
      REFRESH_REUSE_GRACE_SECONDS: String(loaded.session.reuseGraceSeconds),
    };
    for (const [scope, policy] of Object.entries(loaded.abuse)) {
      const prefix = `ABUSE_${scope.toUpperCase()}`;
      expected[`${prefix}_LIMIT`] = String(policy.limit);
      expected[`${prefix}_WINDOW_SECONDS`] = String(policy.windowSeconds);
      if (policy.blockSeconds != null) expected[`${prefix}_BLOCK_SECONDS`] = String(policy.blockSeconds);
    }

    for (const variable of allEnvVars.filter((candidate) => candidate.default !== null)) {
      if (variable.name === 'UV_THREADPOOL_SIZE') continue; // a Node setting, not read by Auth
      assert.equal(variable.default, expected[variable.name], `default of ${variable.name}`);
    }
    // And the other way round: every variable the loaders know has a documented default.
    for (const name of Object.keys(expected)) {
      assert.ok(allEnvVars.some((variable) => variable.name === name), `${name} is not documented`);
    }
  });
});

describe('validation', () => {
  const base = { DATABASE_URL: 'postgres://x', AUTH_PUBLIC_BASE_URL: 'https://auth.example', SMTP_HOST: 'h', MAIL_FROM: 'a@b.c' };

  // [label, loader, env, expected variable named in the error, or null when the value must be accepted]
  const cases = [
    ['AUTH_PUBLIC_BASE_URL with a trailing slash', 'config', { AUTH_PUBLIC_BASE_URL: 'https://auth.example/' }, 'AUTH_PUBLIC_BASE_URL'],
    ['AUTH_PUBLIC_BASE_URL with a query', 'config', { AUTH_PUBLIC_BASE_URL: 'https://auth.example?x=1' }, 'AUTH_PUBLIC_BASE_URL'],
    ['AUTH_PUBLIC_BASE_URL over http in production', 'config', { NODE_ENV: 'production', AUTH_PUBLIC_BASE_URL: 'http://auth.example' }, 'AUTH_PUBLIC_BASE_URL'],
    ['AUTH_PUBLIC_BASE_URL over http in development', 'config', { NODE_ENV: 'development', AUTH_PUBLIC_BASE_URL: 'http://localhost:3000' }, null],
    ['TRUST_PROXY=true', 'config', { TRUST_PROXY: 'true' }, 'TRUST_PROXY'],
    ['TRUST_PROXY with 11 hops', 'config', { TRUST_PROXY: '11' }, 'TRUST_PROXY'],
    ['TRUST_PROXY with 10 hops', 'config', { TRUST_PROXY: '10' }, null],
    ['TRUST_PROXY names and a /8 CIDR', 'config', { TRUST_PROXY: 'loopback, linklocal, 10.0.0.0/8' }, null],
    ['TRUST_PROXY with a /7 CIDR', 'config', { TRUST_PROXY: '10.0.0.0/7' }, 'TRUST_PROXY'],
    ['SMTP_USER without SMTP_PASS', 'config', { SMTP_USER: 'u' }, 'SMTP_USER'],
    ['SMTP_USER with SMTP_PASS', 'config', { SMTP_USER: 'u', SMTP_PASS: 'p' }, null],
    ['PORT out of range', 'config', { PORT: '70000' }, 'PORT'],
    ['ABUSE_LOGIN_IP_LIMIT=0', 'abuse', { ABUSE_LOGIN_IP_LIMIT: '0' }, 'ABUSE_LOGIN_IP_LIMIT'],
    ['ABUSE_LOGIN_IP_LIMIT above int4', 'abuse', { ABUSE_LOGIN_IP_LIMIT: '2147483648' }, 'ABUSE_LOGIN_IP_LIMIT'],
    ['ABUSE_LOGIN_ACCOUNT_BLOCK_SECONDS', 'abuse', { ABUSE_LOGIN_ACCOUNT_BLOCK_SECONDS: '60' }, null],
    ['REFRESH_IDLE_TTL_SECONDS=0', 'session', { REFRESH_IDLE_TTL_SECONDS: '0' }, 'REFRESH_IDLE_TTL_SECONDS'],
    ['REFRESH_REUSE_GRACE_SECONDS=0 disables the grace window', 'session', { REFRESH_REUSE_GRACE_SECONDS: '0' }, null],
    ['REFRESH_REUSE_GRACE_SECONDS=-1', 'session', { REFRESH_REUSE_GRACE_SECONDS: '-1' }, 'REFRESH_REUSE_GRACE_SECONDS'],
  ];

  it('accepts and rejects values as documented, and names the variable but never the value', async () => {
    const results = await inApi(`
      const { loadConfig } = require('/app/dist/platform/config/app-config.js');
      const { loadAbusePolicies } = require('/app/dist/abuse-protection/infrastructure/abuse-config.js');
      const { loadSessionTtls } = require('/app/dist/session-auth/infrastructure/session-config.js');
      const base = ${JSON.stringify(base)};
      const loaders = { config: (env) => loadConfig({ ...base, ...env }), abuse: loadAbusePolicies, session: loadSessionTtls };
      const cases = ${JSON.stringify(cases.map(([label, loader, env]) => ({ label, loader, env })))};
      console.log(JSON.stringify(cases.map(({ label, loader, env }) => {
        try { loaders[loader](env); return { label, ok: true }; }
        catch (error) { return { label, ok: false, message: error.message }; }
      })));
    `);
    cases.forEach(([label, , env, variable], index) => {
      const outcome = results[index];
      assert.equal(outcome.label, label);
      if (variable === null) return assert.equal(outcome.ok, true, `${label} should be accepted: ${outcome.message}`);
      assert.equal(outcome.ok, false, `${label} should be rejected`);
      assert.ok(outcome.message.includes(variable), `${label}: the error should name ${variable}: ${outcome.message}`);
      const value = env[variable];
      if (value && value.length > 6) assert.ok(!outcome.message.includes(value), `${label}: the error must not echo the value`);
    });
  });

  it('requires exactly one of AUTH_SIGNING_KEYS and AUTH_SIGNING_KEYS_FILE', async () => {
    const outcomes = await inApi(`
      const { signingKeysFromEnv } = require('/app/dist/token-lifecycle/infrastructure/signing-keys-source.js');
      const attempt = (env) => { try { signingKeysFromEnv(env); return 'ok'; } catch (error) { return error.message; } };
      console.log(JSON.stringify({
        neither: attempt({}),
        both: attempt({ AUTH_SIGNING_KEYS: '{}', AUTH_SIGNING_KEYS_FILE: '/x' }),
        inline: attempt({ AUTH_SIGNING_KEYS: '{}' }),
        missingFile: attempt({ AUTH_SIGNING_KEYS_FILE: '/does/not/exist' }),
      }));
    `);
    assert.match(outcomes.neither, /exactly one of AUTH_SIGNING_KEYS and AUTH_SIGNING_KEYS_FILE/);
    assert.match(outcomes.both, /exactly one of AUTH_SIGNING_KEYS and AUTH_SIGNING_KEYS_FILE/);
    assert.equal(outcomes.inline, 'ok');
    assert.match(outcomes.missingFile, /AUTH_SIGNING_KEYS_FILE/);
    assert.ok(!outcomes.missingFile.includes('/does/not/exist'), 'the error must not echo the path');
  });
});

// The curl and operator CLI snippets, executed for real.
// curl scripts run inside a small Alpine container (curl + jq) on the same Docker network as the API, so the test
// does not depend on the tools installed on the host. CLI snippets are `docker compose run --rm api dist/cli.js ...`;
// the test runs the same arguments with `node dist/cli.js` inside the API container (see cliArgsFromSnippet).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { GenericContainer } from 'testcontainers';
import {
  NEW_PASSWORD,
  PASSWORD,
  ROOT,
  cliArgsFromSnippet,
  mailbox,
  startStack,
  uniqueEmail,
} from '../support/stack.js';

let stack;
let mail;
let tools;

const snippet = (dir, name) => readFileSync(join(ROOT, 'examples', dir, name), 'utf8');

/** Runs examples/curl/<name> in the tools container with the given variables. */
async function curl(name, vars = {}) {
  const env = { AUTH_URL: stack.internal.authUrl, MAILPIT_URL: stack.internal.mailpitUrl, CLIENT_ID: stack.clientId, ...vars };
  const result = await tools.exec(['sh', `/snippets/${name}`], { env });
  assert.equal(result.exitCode, 0, `${name}: ${result.output}`);
  return result.stdout.trim();
}
const json = async (name, vars) => JSON.parse(await curl(name, vars));

before(
  async () => {
    stack = await startStack({ strict: true });
    mail = mailbox(stack.mailpitUrl);
    const context = mkdtempSync(join(tmpdir(), 'hypot-tools-'));
    writeFileSync(join(context, 'Dockerfile'), 'FROM alpine:3.22\nRUN apk add --no-cache curl jq\nCMD ["tail", "-f", "/dev/null"]\n');
    const image = await GenericContainer.fromDockerfile(context).build('hypot-docs-test-tools:local', { deleteOnExit: false });
    tools = await image
      .withNetwork(stack.network)
      .withCopyDirectoriesToContainer([{ source: join(ROOT, 'examples', 'curl'), target: '/snippets' }])
      .start();
  },
  { timeout: 600_000 },
);
after(
  async () => {
    await tools?.stop({ remove: true });
    await stack?.stop();
  },
  { timeout: 120_000 },
);

describe('quick start with curl', () => {
  const email = uniqueEmail('curl');
  let tokens;

  it('signup answers 202 with the fixed message', async () => {
    const body = await json('signup.sh', { EMAIL: email, PASSWORD });
    assert.equal(body.message, 'If this address can be registered, a confirmation email is on its way.');
  });

  it('login is refused before confirming', async () => {
    const body = await json('login.sh', { EMAIL: email, PASSWORD });
    assert.equal(body.error, 'invalid_credentials');
  });

  it('reads the token from Mailpit and confirms', async () => {
    const token = await curl('mailpit-token.sh', { EMAIL: email });
    assert.match(token, /^[\w-]{20,}$/);
    const body = await json('confirm.sh', { TOKEN: token });
    assert.equal(body.message, 'Your email address has been confirmed.');
    assert.equal((await json('confirm.sh', { TOKEN: token })).error, 'invalid_or_expired_link'); // single use
  });

  it('logs in, reads /me and rotates the refresh token', async () => {
    tokens = await json('login.sh', { EMAIL: email, PASSWORD });
    assert.equal(tokens.token_type, 'Bearer');
    assert.equal(tokens.expires_in, 3600);

    const me = await json('me.sh', { ACCESS_TOKEN: tokens.access_token });
    assert.equal(me.email, email);
    assert.equal(me.email_verified, true);

    const rotated = await json('refresh.sh', { REFRESH_TOKEN: tokens.refresh_token });
    assert.notEqual(rotated.refresh_token, tokens.refresh_token);
    tokens = rotated;
  });

  it('changes the password, which ends every session', async () => {
    assert.equal(await curl('change.sh', { ACCESS_TOKEN: tokens.access_token, PASSWORD, NEW_PASSWORD }), '204');
    assert.equal((await json('refresh.sh', { REFRESH_TOKEN: tokens.refresh_token })).error, 'invalid_grant');
    tokens = await json('login.sh', { EMAIL: email, PASSWORD: NEW_PASSWORD });
    assert.ok(tokens.access_token);
  });

  it('logs out', async () => {
    assert.equal(await curl('logout.sh', { REFRESH_TOKEN: tokens.refresh_token }), '204');
    assert.equal((await json('refresh.sh', { REFRESH_TOKEN: tokens.refresh_token })).error, 'invalid_grant');
  });

  it('forgot and reset', async () => {
    const forgot = await json('forgot.sh', { EMAIL: email });
    assert.equal(forgot.message, 'If an account exists for this address, an email is on its way.');
    await mail.waitForMessage(email, 4); // confirmation, welcome, password changed, reset: the newest is the reset email
    const reset = await curl('mailpit-token.sh', { EMAIL: email });
    assert.equal(await curl('reset.sh', { TOKEN: reset, NEW_PASSWORD: PASSWORD }), '204');
    assert.ok((await json('login.sh', { EMAIL: email, PASSWORD })).access_token);
  });

  it('resend-confirmation answers 202 for an unknown address too', async () => {
    const body = await json('resend-confirmation.sh', { EMAIL: uniqueEmail('nobody') });
    assert.equal(body.message, 'If an unconfirmed account exists for this address, a new confirmation email is on its way.');
  });

  it('serves the JWKS', async () => {
    const jwks = await json('jwks.sh');
    assert.equal(jwks.keys.length, 2);
  });

  it('shows 429 and Retry-After on a limited endpoint (instance with a refresh limit of 2)', async () => {
    const strict = { AUTH_URL: stack.internal.strictAuthUrl, CLIENT_ID: stack.strict.clientId };
    const strictEmail = uniqueEmail('curl-strict');
    await json('signup.sh', { ...strict, EMAIL: strictEmail, PASSWORD });
    await json('confirm.sh', { ...strict, TOKEN: await curl('mailpit-token.sh', { EMAIL: strictEmail }) });
    let pair = await json('login.sh', { ...strict, EMAIL: strictEmail, PASSWORD });
    pair = await json('refresh.sh', { ...strict, REFRESH_TOKEN: pair.refresh_token });
    pair = await json('refresh.sh', { ...strict, REFRESH_TOKEN: pair.refresh_token });
    const headers = await curl('rate-limited.sh', { ...strict, REFRESH_TOKEN: pair.refresh_token });
    assert.match(headers, /^HTTP\/1\.1 429/m);
    assert.match(headers, /^retry-after: \d+/im);
  });
});

describe('operator CLI snippets', () => {
  const run = async (name, env = {}) => {
    const args = cliArgsFromSnippet(snippet('cli', name), env);
    const result = await stack.runCli(args);
    assert.equal(result.exitCode, 0, `${name}: ${result.output}`);
    return result.stdout;
  };

  it('registers an app for local development and prints its client_id', async () => {
    assert.match(await run('app-create.sh'), /^client_id: app_[0-9a-f]{32}$/m);
  });

  it('registers an app with production URLs (https, two origins)', async () => {
    assert.match(await run('app-create-production.sh'), /^client_id: app_[0-9a-f]{32}$/m);
  });

  it('rejects an email URL whose origin is not allowed', async () => {
    const result = await stack.runCli(['app', 'create', '--name', 'Bad', '--origin', 'https://a.example', '--email-confirmation-url', 'https://b.example/confirm', '--password-reset-url', 'https://a.example/reset']);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.output, /--origin/);
  });

  it('requires both email URLs on create (the README example without them fails)', async () => {
    const result = await stack.runCli(['app', 'create', '--name', 'No URLs', '--origin', 'https://a.example']);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.output, /--email-confirmation-url is required/);
  });

  it('updates and deactivates an app', async () => {
    const created = await run('app-create.sh');
    const clientId = /client_id: (app_[0-9a-f]{32})/.exec(created)[1];
    await run('app-update.sh', { CLIENT_ID: clientId });
    await run('app-deactivate.sh', { CLIENT_ID: clientId });
  });

  it('the migrate snippet matches the migrate service of the API compose file, and a second run finds nothing pending', async () => {
    assert.equal(snippet('cli', 'migrate.sh').trim(), 'docker compose run --rm migrate');
    const compose = readFileSync(join(ROOT, 'api', 'compose.yaml'), 'utf8');
    assert.match(
      compose,
      /command: \["node_modules\/typeorm\/cli\.js", "migration:run", "-d", "dist\/platform\/persistence\/data-source\.js"\]/,
    );
    const again = await stack.api.exec(['/nodejs/bin/node', 'node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/platform/persistence/data-source.js']);
    assert.equal(again.exitCode, 0, again.output);
    assert.match(again.output, /No migrations are pending/);
  });

  it('ops:revoke-all ends every open session (run last: it affects the whole instance)', async () => {
    const email = uniqueEmail('revoke');
    await json('signup.sh', { EMAIL: email, PASSWORD });
    await json('confirm.sh', { TOKEN: await curl('mailpit-token.sh', { EMAIL: email }) });
    const pair = await json('login.sh', { EMAIL: email, PASSWORD });

    const refused = await stack.runCli(['ops:revoke-all']);
    assert.notEqual(refused.exitCode, 0); // it refuses to run without --yes

    assert.match(await run('ops-revoke-all.sh'), /^revoked sessions: \d+$/m);
    assert.equal((await json('refresh.sh', { REFRESH_TOKEN: pair.refresh_token })).error, 'invalid_grant');
    // The access token stays valid until exp: that is why key rotation accompanies an emergency revoke.
    assert.equal((await json('me.sh', { ACCESS_TOKEN: pair.access_token })).email, email);
  });
});

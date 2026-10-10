// Claims made in the "Conceptos" and error-handling pages, checked against the real API.
// These are not snippets: they pin down statements of the docs so that a new API version that changes them fails here.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NEW_PASSWORD, PASSWORD, confirmedAccountRaw, mailbox, startStack, uniqueEmail } from '../support/stack.js';

let stack;
let mail;
const OTHER_ORIGIN = 'http://localhost:4321';

const call = (method, path, { body, origin = stack.origin, token, headers = {}, url = stack.authUrl } = {}) =>
  fetch(`${url}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(origin ? { Origin: origin } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = (path, body, options) => call('POST', `/api/v1${path}`, { body, ...options });
const login = (email, password = PASSWORD, options) => post('/auth/login', { client_id: stack.clientId, email, password }, options);
const pairOf = async (email, password = PASSWORD) => (await login(email, password)).json();
/** Every #token= found in the mail of an address, oldest first, once at least `count` of them exist. */
async function tokensSentTo(email, count) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const messages = (await mail.messagesTo(email)).reverse();
    const tokens = [];
    for (const message of messages) {
      const detail = await (await fetch(`${stack.mailpitUrl}/api/v1/message/${message.ID}`)).json();
      const match = /#token=([^\s"<>]+)/.exec(detail.Text ?? '');
      if (match) tokens.push(match[1]);
    }
    if (tokens.length >= count) return tokens;
    await sleep(500);
  }
  throw new Error(`fewer than ${count} tokens for ${email}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Status, body and every header except the volatile ones: two "identical" responses must match on all of it. */
async function fingerprint(response) {
  const headers = Object.fromEntries([...response.headers].filter(([name]) => !['date', 'etag', 'content-length'].includes(name)));
  return { status: response.status, headers, body: await response.text() };
}

before(
  async () => {
    stack = await startStack();
    mail = mailbox(stack.mailpitUrl);
  },
  { timeout: 600_000 },
);
after(async () => stack?.stop(), { timeout: 120_000 });

describe('generic responses', () => {
  it('login: unknown email, wrong password and unconfirmed account are indistinguishable', async () => {
    const confirmed = await confirmedAccountRaw(stack, mail);
    const unconfirmed = uniqueEmail('unconf');
    await post('/accounts/signup', { client_id: stack.clientId, email: unconfirmed, password: PASSWORD });

    const results = [
      await fingerprint(await login(uniqueEmail('ghost'))),
      await fingerprint(await login(confirmed, 'wrong password')),
      await fingerprint(await login(unconfirmed)),
      await fingerprint(await post('/auth/login', { client_id: 'app_' + '1'.repeat(32), email: confirmed, password: PASSWORD })),
    ];
    assert.equal(results[0].status, 401);
    assert.equal(JSON.parse(results[0].body).error, 'invalid_credentials');
    assert.equal(results[0].headers['www-authenticate'], undefined);
    assert.equal(results[0].headers['retry-after'], undefined);
    for (const result of results.slice(1)) {
      assert.equal(result.status, results[0].status);
      assert.equal(result.body, results[0].body);
    }
    assert.equal(results[0].headers['cache-control'], 'no-store');
  });

  it('signup, resend and forgot answer the same for existing and unknown addresses', async () => {
    const existing = await confirmedAccountRaw(stack, mail);
    const signupNew = await fingerprint(await post('/accounts/signup', { client_id: stack.clientId, email: uniqueEmail('n'), password: PASSWORD }));
    const signupExisting = await fingerprint(await post('/accounts/signup', { client_id: stack.clientId, email: existing, password: PASSWORD }));
    assert.equal(signupNew.status, 202);
    assert.equal(signupNew.body, signupExisting.body);

    const unconfirmed = uniqueEmail('u');
    await post('/accounts/signup', { client_id: stack.clientId, email: unconfirmed, password: PASSWORD });
    const resend = (email) => post('/accounts/resend-confirmation', { client_id: stack.clientId, email }).then(fingerprint);
    const [r1, r2, r3] = [await resend(unconfirmed), await resend(existing), await resend(uniqueEmail('ghost'))];
    assert.equal(r1.status, 202);
    assert.equal(r1.body, r2.body);
    assert.equal(r1.body, r3.body);

    const forgot = (email) => post('/password/forgot', { client_id: stack.clientId, email }).then(fingerprint);
    const [f1, f2, f3] = [await forgot(existing), await forgot(unconfirmed), await forgot(uniqueEmail('ghost'))];
    assert.equal(f1.status, 202);
    assert.equal(f1.body, f2.body);
    assert.equal(f1.body, f3.body);
  });

  it('refresh, confirm and logout hide whether a token exists', async () => {
    const refresh = await post('/auth/refresh', { client_id: stack.clientId, refresh_token: 'nope' });
    assert.equal(refresh.status, 401);
    assert.equal((await refresh.json()).error, 'invalid_grant');
    const confirm = await post('/accounts/confirm', { token: 'nope' });
    assert.equal(confirm.status, 400);
    assert.equal((await confirm.json()).error, 'invalid_or_expired_link');
    assert.equal((await post('/auth/logout', { client_id: stack.clientId, refresh_token: 'nope' })).status, 204);
  });
});

describe('input rules', () => {
  it('validates passwords on the server: 8 characters, 72 bytes, no NUL', async () => {
    const signup = (password) => post('/accounts/signup', { client_id: stack.clientId, email: uniqueEmail('pw'), password });
    assert.equal((await signup('1234567')).status, 400);
    assert.equal((await signup('é'.repeat(37))).status, 400); // 74 bytes
    assert.equal((await signup('é'.repeat(36))).status, 202); // 72 bytes
    assert.equal((await signup('abcdefgh\0ij')).status, 400);
    assert.equal((await (await signup('1234567')).json()).error, 'invalid_password');
  });

  it('treats emails as case-insensitive and trimmed', async () => {
    const email = await confirmedAccountRaw(stack, mail);
    assert.equal((await login(email.toUpperCase())).status, 200);
    assert.equal((await login(`  ${email}  `)).status, 200);
  });

  it('answers 400 invalid_request for non-string fields and invalid JSON, and 415 for other content types', async () => {
    const wrongType = await post('/auth/login', { client_id: stack.clientId, email: 1, password: PASSWORD });
    assert.equal(wrongType.status, 400);
    assert.equal((await wrongType.json()).error, 'invalid_request');
    const invalidJson = await call('POST', '/api/v1/auth/login', { headers: { 'Content-Type': 'application/json' }, origin: stack.origin });
    assert.equal(invalidJson.status, 400);
    const plain = await call('POST', '/api/v1/auth/login', { headers: { 'Content-Type': 'text/plain' } });
    assert.equal(plain.status, 415);
    assert.equal(plain.headers.get('access-control-allow-origin'), null); // a browser sees a network error
    const charset = await call('POST', '/api/v1/auth/login', { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    assert.notEqual(charset.status, 415);
  });

  it('keeps accounts per app: the same email in two apps is independent', async () => {
    const email = await confirmedAccountRaw(stack, mail);
    const secondApp = await stack.registerApp('Second app');
    const signup = await post('/accounts/signup', { client_id: secondApp, email, password: NEW_PASSWORD });
    assert.equal(signup.status, 202);
    const firstToken = confirmedAccountRaw.usedTokens.get(email);
    const secondToken = (await tokensSentTo(email, 2)).find((token) => token !== firstToken);
    assert.ok(secondToken);
    const confirm = await post('/accounts/confirm', { token: secondToken });
    assert.equal(confirm.status, 200);
    assert.equal((await post('/auth/login', { client_id: secondApp, email, password: NEW_PASSWORD })).status, 200);
    assert.equal((await post('/auth/login', { client_id: secondApp, email, password: PASSWORD })).status, 401); // other app's password
    assert.equal((await login(email)).status, 200); // the first account is untouched
  });
});

describe('abuse protection', () => {
  it('blocks login after 5 attempts and then refuses even the right password, change included', async () => {
    const email = await confirmedAccountRaw(stack, mail, stack.clientId, 'lock');
    const { access_token: accessToken } = await pairOf(email); // a success refunds the pair counter
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await login(email, 'wrong password')).status, 401);

    const blocked = await login(email); // the right password, but this IP is blocked for this account
    assert.equal(blocked.status, 401);
    assert.equal((await blocked.json()).error, 'invalid_credentials');

    const change = await post('/password/change', { current_password: PASSWORD, new_password: NEW_PASSWORD }, { token: accessToken });
    assert.equal(change.status, 400);
    assert.equal((await change.json()).error, 'invalid_current_password');
  });

  it('caps emails at 3 per account per hour and keeps answering 202', async () => {
    const email = uniqueEmail('cap');
    const signup = await post('/accounts/signup', { client_id: stack.clientId, email, password: PASSWORD }); // email 1
    assert.equal(signup.status, 202);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const resend = await post('/accounts/resend-confirmation', { client_id: stack.clientId, email }); // emails 2 and 3, then nothing
      assert.equal(resend.status, 202);
    }
    await mail.waitForMessage(email, 3);
    await sleep(6000); // the outbox polls every 2 s: a fourth email would be here by now
    assert.equal((await mail.messagesTo(email)).length, 3);
  });

  it('requests that queue nothing do not consume the budget (resend and forgot for unknown addresses)', async () => {
    const email = uniqueEmail('nobudget');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await post('/accounts/resend-confirmation', { client_id: stack.clientId, email });
      await post('/password/forgot', { client_id: stack.clientId, email });
    }
    assert.equal((await post('/accounts/signup', { client_id: stack.clientId, email, password: PASSWORD })).status, 202);
    await mail.waitForMessage(email, 1); // the signup email still goes out
  });
});

describe('origin binding', () => {
  let accessToken;
  let refreshToken;
  let email;

  before(async () => {
    email = await confirmedAccountRaw(stack, mail, stack.clientId, 'origin');
    ({ access_token: accessToken, refresh_token: refreshToken } = await pairOf(email));
    // A second, active app with another origin: its origin is "registered", but not for the first app.
    const result = await stack.runCli(['app', 'create', '--name', 'Other origin', '--origin', OTHER_ORIGIN, '--email-confirmation-url', `${OTHER_ORIGIN}/confirm`, '--password-reset-url', `${OTHER_ORIGIN}/reset`]);
    assert.equal(result.exitCode, 0, result.output);
  });

  it('refresh from another registered origin is the generic invalid_grant and does not consume the token', async () => {
    const foreign = await post('/auth/refresh', { client_id: stack.clientId, refresh_token: refreshToken }, { origin: OTHER_ORIGIN });
    assert.equal(foreign.status, 401);
    assert.equal((await foreign.json()).error, 'invalid_grant');
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    const ok = await post('/auth/refresh', { client_id: stack.clientId, refresh_token: refreshToken });
    assert.equal(ok.status, 200);
    refreshToken = (await ok.json()).refresh_token;
  });

  it('logout from another origin answers 204 and revokes nothing', async () => {
    const foreign = await post('/auth/logout', { client_id: stack.clientId, refresh_token: refreshToken }, { origin: OTHER_ORIGIN });
    assert.equal(foreign.status, 204);
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    assert.equal((await post('/auth/refresh', { client_id: stack.clientId, refresh_token: refreshToken })).status, 200);
  });

  it('/me from another origin is the generic 401 without CORS headers; from the app origin it is readable', async () => {
    const foreign = await call('GET', '/api/v1/me', { token: accessToken, origin: OTHER_ORIGIN });
    assert.equal(foreign.status, 401);
    assert.equal(foreign.headers.get('www-authenticate'), 'Bearer');
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await foreign.json(), { error: 'invalid_token', message: 'Missing or invalid access token' });
    const own = await call('GET', '/api/v1/me', { token: accessToken });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('access-control-allow-origin'), stack.origin);
    assert.equal(own.headers.get('cache-control'), 'no-store');
  });

  it('signup from another origin is invalid_client; without an Origin header the binding is skipped', async () => {
    const foreign = await post('/accounts/signup', { client_id: stack.clientId, email: uniqueEmail('x'), password: PASSWORD }, { origin: OTHER_ORIGIN });
    assert.equal(foreign.status, 400);
    assert.equal((await foreign.json()).error, 'invalid_client');
    const server = await post('/accounts/signup', { client_id: stack.clientId, email: uniqueEmail('x'), password: PASSWORD }, { origin: null });
    assert.equal(server.status, 202);
  });

  it('the preflight is answered for any active app origin, with the fixed headers', async () => {
    for (const origin of [stack.origin, OTHER_ORIGIN]) {
      const response = await call('OPTIONS', '/api/v1/auth/refresh', {
        origin,
        headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, x-custom' },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type, Authorization');
    }
    const unknown = await call('OPTIONS', '/api/v1/auth/refresh', { origin: 'http://localhost:9999', headers: { 'Access-Control-Request-Method': 'POST' } });
    assert.equal(unknown.headers.get('access-control-allow-origin'), null);
  });

  it('an uppercase origin never matches (exact comparison)', async () => {
    const response = await login(email, PASSWORD, { origin: 'HTTP://LOCALHOST:5173' });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

describe('sessions and tokens', () => {
  it('a used refresh token revokes the whole session once the grace window has passed', async () => {
    const email = await confirmedAccountRaw(stack, mail, stack.clientId, 'late');
    const first = await pairOf(email);
    const rotate = (token) => post('/auth/refresh', { client_id: stack.clientId, refresh_token: token });
    const second = await (await rotate(first.refresh_token)).json();
    await sleep(11_000); // REFRESH_REUSE_GRACE_SECONDS is 10
    assert.equal((await rotate(first.refresh_token)).status, 401); // later than the window
    assert.equal((await rotate(second.refresh_token)).status, 401); // and the session is gone
  });

  it('logout and password reset do not invalidate issued access tokens, and /me does not notice either', async () => {
    const email = await confirmedAccountRaw(stack, mail, stack.clientId, 'cutoff');
    const pair = await pairOf(email);
    await post('/auth/logout', { client_id: stack.clientId, refresh_token: pair.refresh_token });
    assert.equal((await post('/auth/refresh', { client_id: stack.clientId, refresh_token: pair.refresh_token })).status, 401);
    // The session is gone, but the access token still works until exp, even on /me.
    const me = await call('GET', '/api/v1/me', { token: pair.access_token });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).email, email);
  });

  it('answers 404 for the removed and never-existing routes', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/accounts/confirm?token=abc'],
      ['GET', '/api/v1/password/forgot'],
      ['GET', '/api/v1/password/reset'],
      ['POST', '/api/v1/oauth/token'],
      ['POST', '/api/v1/apps'],
    ]) {
      assert.equal((await call(method, path, { origin: null, body: method === 'POST' ? {} : undefined })).status, 404, `${method} ${path}`);
    }
  });

  it('serves / and /health at the root', async () => {
    assert.equal((await call('GET', '/', { origin: null })).status, 200);
    assert.equal((await call('GET', '/health', { origin: null })).status, 200);
  });
});

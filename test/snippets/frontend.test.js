// The frontend snippets from examples/frontend, run against the real API (Testcontainers).
// The browser pieces (location, history, navigator.locks, Storage) are injected stubs: see test/support/browser-stubs.js.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { actionFor } from '../../examples/frontend/error-handling.js';
import { createAuthClient } from '../../examples/frontend/auth-client.js';
import { confirmEmail, takeTokenFromUrl } from '../../examples/frontend/confirm-page.js';
import { logIn } from '../../examples/frontend/login.js';
import { logOut } from '../../examples/frontend/logout.js';
import { changePassword, requestPasswordReset, resetPassword } from '../../examples/frontend/password.js';
import { checkPassword } from '../../examples/frontend/password-rules.js';
import { createRefresher } from '../../examples/frontend/refresh.js';
import { resendConfirmation } from '../../examples/frontend/resend.js';
import { signUp } from '../../examples/frontend/signup.js';
import { createTokenStore } from '../../examples/frontend/token-store.js';
import { createLocks, createPage, createStorage, spyFetch } from '../support/browser-stubs.js';
import {
  NEW_PASSWORD,
  PASSWORD,
  fetchWithOrigin,
  mailbox,
  startStack,
  tokenFromEmail,
  uniqueEmail,
} from '../support/stack.js';

let stack;
let mail;
const confirmationTokens = new Map(); // email -> the token that confirmed it

const clientFor = (clientId = stack.clientId, authUrl = stack.authUrl, fetch = fetchWithOrigin(stack.origin)) =>
  createAuthClient({ authUrl, clientId, fetch });

/** Signup + confirm through the snippets. Returns the email of a confirmed account. */
async function confirmedAccount(client, label = 'user') {
  const email = uniqueEmail(label);
  assert.deepEqual(await signUp(client, { email, password: PASSWORD }), { status: 'check_inbox' });
  const token = tokenFromEmail(await mail.waitForMessage(email));
  const page = createPage(`${stack.origin}/confirm#token=${token}`);
  assert.deepEqual(await confirmEmail(client, page), { status: 'confirmed' });
  confirmationTokens.set(email, token);
  return email;
}

/** A logged-in "tab": its own client, store and refresher. Tabs may share a Storage and a locks stub. */
async function openTab({ email, storage = null, locks = createLocks(), fetch = fetchWithOrigin(stack.origin) }) {
  const client = clientFor(stack.clientId, stack.authUrl, fetch);
  const store = createTokenStore({ clientId: stack.clientId, storage });
  const refresher = createRefresher({ client, store, clientId: stack.clientId, locks, retryDelayMs: 0 });
  if (email) assert.deepEqual(await logIn({ client, store }, { email, password: PASSWORD }), { status: 'ok' });
  return { client, store, refresher };
}

before(
  async () => {
    stack = await startStack({ strict: true });
    mail = mailbox(stack.mailpitUrl);
  },
  { timeout: 600_000 },
);
after(async () => stack?.stop(), { timeout: 120_000 });

describe('signup and confirmation', () => {
  it('answers the same for a new and for an already registered address', async () => {
    const client = clientFor();
    const email = uniqueEmail('signup');
    assert.deepEqual(await signUp(client, { email, password: PASSWORD }), { status: 'check_inbox' });
    assert.deepEqual(await signUp(client, { email, password: PASSWORD }), { status: 'check_inbox' });
    // First the confirmation, then the "account exists" notice (which has no token).
    const second = await mail.waitForMessage(email, 2);
    assert.doesNotMatch(second, /#token=/);
  });

  it('validates the password in the form before calling Auth', async () => {
    assert.equal(checkPassword('short'), 'too_short');
    assert.equal(checkPassword('é'.repeat(37)), 'too_long_bytes'); // 37 characters, 74 bytes
    assert.equal(checkPassword('é'.repeat(36)), null); // 72 bytes is allowed
    assert.equal(checkPassword('valid\0password'), 'contains_nul');

    const fetch = spyFetch(globalThis.fetch);
    const result = await signUp(clientFor(stack.clientId, stack.authUrl, fetch), {
      email: uniqueEmail(),
      password: 'short',
    });
    assert.equal(result.status, 'field_error');
    assert.equal(fetch.calls.length, 0);
  });

  it('shows field errors that come from Auth', async () => {
    const result = await signUp(clientFor(), { email: 'not-an-email', password: PASSWORD });
    assert.deepEqual(result, { status: 'field_error', field: 'email', reason: 'invalid_email' });
  });

  it('reports an unknown client_id as an integration error', async () => {
    const wrong = clientFor('app_' + '0'.repeat(32));
    const result = await signUp(wrong, { email: uniqueEmail(), password: PASSWORD });
    assert.deepEqual(result, { status: 'unexpected', error: 'invalid_client' });
  });

  it('reads the token from the fragment, clears the URL BEFORE any request, then confirms', async () => {
    const email = uniqueEmail('confirm');
    const client = clientFor();
    await signUp(client, { email, password: PASSWORD });
    const token = tokenFromEmail(await mail.waitForMessage(email));

    const page = createPage(`${stack.origin}/confirm?lang=es#token=${token}`);
    const urlsWhenRequested = [];
    const fetch = spyFetch(fetchWithOrigin(stack.origin), () => urlsWhenRequested.push(page.location.href));
    const result = await confirmEmail(clientFor(stack.clientId, stack.authUrl, fetch), page);

    assert.deepEqual(result, { status: 'confirmed' });
    assert.deepEqual(page.calls, ['/confirm?lang=es']); // path and query stay, the fragment goes
    assert.equal(urlsWhenRequested.length, 1);
    assert.doesNotMatch(urlsWhenRequested[0], /token/); // already clean when the request left
    assert.doesNotMatch(page.location.href, /token/);
    assert.equal((await mail.waitForMessage(email, 2)).includes('#token='), false); // welcome email
  });

  it('treats a used token and a network error as an invalid link', async () => {
    const email = await confirmedAccount(clientFor(), 'used');
    const token = confirmationTokens.get(email); // already used by confirmedAccount
    const used = await confirmEmail(clientFor(), createPage(`${stack.origin}/confirm#token=${token}`));
    assert.deepEqual(used, { status: 'invalid_link' });

    // In a browser an unknown token gets no CORS header and fetch rejects. Node has no CORS, so simulate it.
    const offline = createAuthClient({
      authUrl: stack.authUrl,
      clientId: stack.clientId,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const opaque = await confirmEmail(offline, createPage(`${stack.origin}/confirm#token=unknown`));
    assert.deepEqual(opaque, { status: 'invalid_link' });
    assert.deepEqual(await confirmEmail(clientFor(), createPage(`${stack.origin}/confirm`)), {
      status: 'invalid_link',
    }); // no fragment at all
  });

  it('takeTokenFromUrl keeps path and query and returns null without a token', () => {
    const page = createPage('https://app.example/reset?x=1#token=abc');
    assert.equal(takeTokenFromUrl(page), 'abc');
    assert.equal(page.location.href, 'https://app.example/reset?x=1');
    assert.equal(takeTokenFromUrl(page), null);
  });

  it('resends the confirmation and invalidates the previous link', async () => {
    const client = clientFor();
    const email = uniqueEmail('resend');
    await signUp(client, { email, password: PASSWORD });
    const first = tokenFromEmail(await mail.waitForMessage(email, 1));
    assert.deepEqual(await resendConfirmation(client, email), { status: 'check_inbox' });
    const second = tokenFromEmail(await mail.waitForMessage(email, 2));
    assert.notEqual(first, second);

    assert.deepEqual(await confirmEmail(client, createPage(`${stack.origin}/confirm#token=${first}`)), {
      status: 'invalid_link',
    });
    assert.deepEqual(await confirmEmail(client, createPage(`${stack.origin}/confirm#token=${second}`)), {
      status: 'confirmed',
    });
    assert.deepEqual(await resendConfirmation(client, uniqueEmail('nobody')), { status: 'check_inbox' }); // same answer
  });
});

describe('login, token storage and logout', () => {
  it('gives one generic error for an unconfirmed account and for a wrong password', async () => {
    const client = clientFor();
    const store = createTokenStore({ clientId: stack.clientId });
    const unconfirmed = uniqueEmail('unconfirmed');
    await signUp(client, { email: unconfirmed, password: PASSWORD });
    assert.deepEqual(await logIn({ client, store }, { email: unconfirmed, password: PASSWORD }), {
      status: 'invalid_credentials',
    });
    const email = await confirmedAccount(client, 'wrongpass');
    assert.deepEqual(await logIn({ client, store }, { email, password: 'not the password' }), {
      status: 'invalid_credentials',
    });
    assert.equal(store.getAccessToken(), null);
  });

  it('keeps the access token in memory and the refresh token only where you put it', async () => {
    const email = await confirmedAccount(clientFor(), 'storage');
    const storage = createStorage();
    const { store, client } = await openTab({ email, storage });

    const access = store.getAccessToken();
    assert.match(access, /^[\w-]+\.[\w-]+\.[\w-]+$/); // a JWT
    assert.equal(access.split('.').length, 3);
    const saved = storage.snapshot();
    assert.deepEqual(Object.keys(saved), [`hypot:refresh:${stack.clientId}`]);
    assert.ok(!Object.values(saved).includes(access)); // the access token never reaches Storage
    assert.equal(store.getRefreshToken(), saved[`hypot:refresh:${stack.clientId}`]);

    const me = await client.me(access);
    assert.equal(me.data.email, email);
    assert.deepEqual(Object.keys(me.data).sort(), ['created_at', 'email', 'email_verified', 'id']);

    store.clear();
    assert.equal(store.getAccessToken(), null);
    assert.equal(store.getRefreshToken(), null);
    assert.deepEqual(storage.snapshot(), {});
  });

  it('keeps tokens in memory by default (no Storage at all)', async () => {
    const email = await confirmedAccount(clientFor(), 'memory');
    const { store } = await openTab({ email });
    assert.ok(store.getRefreshToken());
  });

  it('asks for a renewal when the access token is about to expire', () => {
    const store = createTokenStore({ clientId: 'app_x' });
    store.save({ access_token: 'a', refresh_token: 'r', expires_in: 30 }); // under the 60 s margin
    assert.equal(store.getAccessToken(), null);
    store.save({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
    assert.equal(store.getAccessToken(), 'a');
  });

  it('logout revokes the session and clears local tokens', async () => {
    const email = await confirmedAccount(clientFor(), 'logout');
    const { client, store } = await openTab({ email });
    const refreshToken = store.getRefreshToken();

    assert.deepEqual(await logOut({ client, store }), { status: 'logged_out', serverRevoked: true });
    assert.equal(store.getRefreshToken(), null);
    assert.equal((await client.refresh(refreshToken)).error, 'invalid_grant'); // the session is gone
    assert.equal((await client.logout('an-unknown-token')).status, 204); // idempotent
  });

  it('logout clears local tokens even when the call fails', async () => {
    const email = await confirmedAccount(clientFor(), 'logoutfail');
    const { store } = await openTab({ email });
    const broken = createAuthClient({
      authUrl: stack.authUrl,
      clientId: stack.clientId,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    assert.deepEqual(await logOut({ client: broken, store }), { status: 'logged_out', serverRevoked: false });
    assert.equal(store.getRefreshToken(), null);
  });
});

describe('refresh with rotation', () => {
  it('rotates the refresh token and stores the new one before anything else', async () => {
    const email = await confirmedAccount(clientFor(), 'rotate');
    const storage = createStorage();
    const { store, refresher } = await openTab({ email, storage });
    const before = store.getRefreshToken();

    const outcome = await refresher.refresh();
    assert.equal(outcome.status, 'ok');
    assert.notEqual(store.getRefreshToken(), before);
    assert.equal(await refresher.getAccessToken(), store.getAccessToken());
  });

  it('shares one promise per page: concurrent callers cause one request', async () => {
    const email = await confirmedAccount(clientFor(), 'onepage');
    const fetch = spyFetch(fetchWithOrigin(stack.origin));
    const { store, refresher } = await openTab({ email, fetch });
    store.save({ access_token: 'stale', refresh_token: store.getRefreshToken(), expires_in: 1 }); // about to expire
    const loginCalls = fetch.calls.length;

    const results = await Promise.all([refresher.refresh(), refresher.refresh(), refresher.getAccessToken()]);
    assert.equal(results[0], results[1]); // the same promise
    assert.equal(fetch.calls.length - loginCalls, 1);
  });

  it('serializes refreshes across tabs: every tab succeeds and the session survives', async () => {
    const email = await confirmedAccount(clientFor(), 'tabs');
    const storage = createStorage(); // shared, like localStorage
    const locks = createLocks(); // shared, like navigator.locks
    const tabA = await openTab({ email, storage, locks });
    const tabB = await openTab({ email: undefined, storage, locks });

    const outcomes = await Promise.all([tabA.refresher.refresh(), tabB.refresher.refresh()]);
    assert.deepEqual(outcomes.map((o) => o.status), ['ok', 'ok']);
    // The second tab re-read the token that the first had stored, so the chain is intact:
    assert.equal((await tabA.refresher.refresh()).status, 'ok');
    assert.equal((await tabB.refresher.refresh()).status, 'ok');
  });

  it('WITHOUT serialization a parallel refresh ends the session (why the rule exists)', async () => {
    const email = await confirmedAccount(clientFor(), 'norace');
    const client = clientFor();
    const login = (await client.login(email, PASSWORD)).data;

    const winner = (await client.refresh(login.refresh_token)).data; // tab A rotates R1 -> R2
    const racer = await client.refresh(login.refresh_token); // tab B presents R1 again inside the grace window
    assert.equal(racer.ok, true); // forgiven once, but R2 (the winner's token) is revoked now
    const next = await client.refresh(winner.refresh_token); // the winner's next refresh
    assert.equal(next.error, 'invalid_grant');
    assert.equal((await client.refresh(racer.data.refresh_token)).error, 'invalid_grant'); // the whole session is revoked
  });

  it('retries ONCE after a lost response and recovers inside the grace window', async () => {
    const email = await confirmedAccount(clientFor(), 'lost');
    const real = fetchWithOrigin(stack.origin);
    let refreshes = 0;
    const lossy = async (url, init) => {
      const response = await real(url, init);
      if (String(url).endsWith('/auth/refresh') && refreshes++ === 0) {
        throw new TypeError('network dropped after Auth processed it'); // the response never arrives
      }
      return response;
    };
    const { store, refresher } = await openTab({ email, fetch: lossy });
    const original = store.getRefreshToken();

    const outcome = await refresher.refresh();
    assert.equal(outcome.status, 'ok');
    assert.equal(refreshes, 2); // exactly one retry
    assert.notEqual(store.getRefreshToken(), original);
    assert.equal((await refresher.refresh()).status, 'ok'); // the session survived
  });

  it('gives up after a second network failure and asks for a new login', async () => {
    const email = await confirmedAccount(clientFor(), 'offline');
    const { store } = await openTab({ email });
    let attempts = 0;
    const down = createAuthClient({
      authUrl: stack.authUrl,
      clientId: stack.clientId,
      fetch: async () => {
        attempts += 1;
        throw new TypeError('fetch failed');
      },
    });
    const refresher = createRefresher({ client: down, store, clientId: stack.clientId, locks: createLocks(), retryDelayMs: 0 });
    assert.deepEqual(await refresher.refresh(), { status: 'logged_out', reason: 'network_error' });
    assert.equal(attempts, 2); // the first try plus a single retry, never a loop
    assert.equal(store.getRefreshToken(), null);
  });

  it('on invalid_grant clears the tokens and asks for a new login', async () => {
    const email = await confirmedAccount(clientFor(), 'dead');
    const { client, store, refresher } = await openTab({ email });
    await client.logout(store.getRefreshToken()); // the session ends elsewhere
    assert.deepEqual(await refresher.refresh(), { status: 'logged_out', reason: 'invalid_grant' });
    assert.equal(store.getRefreshToken(), null);
  });

  it('a 429 is not a dead session: it keeps the tokens and reports Retry-After', async () => {
    const strictClient = createAuthClient({
      authUrl: stack.strict.authUrl,
      clientId: stack.strict.clientId,
      fetch: fetchWithOrigin(stack.origin),
    });
    const email = await confirmedAccount(strictClient, 'limit');
    const store = createTokenStore({ clientId: stack.strict.clientId });
    const refresher = createRefresher({ client: strictClient, store, clientId: 'strict', locks: createLocks() });
    assert.deepEqual(await logIn({ client: strictClient, store }, { email, password: PASSWORD }), { status: 'ok' });

    assert.equal((await refresher.refresh()).status, 'ok'); // the limit of this instance is 2 per window
    assert.equal((await refresher.refresh()).status, 'ok');
    const kept = store.getRefreshToken();
    const limited = await refresher.refresh();
    assert.equal(limited.status, 'rate_limited');
    assert.ok(Number.isInteger(limited.retryAfter) && limited.retryAfter >= 1);
    assert.equal(store.getRefreshToken(), kept); // still logged in
    assert.deepEqual(actionFor({ error: 'rate_limited', retryAfter: limited.retryAfter }), {
      action: 'wait',
      seconds: limited.retryAfter,
    });
  });
});

describe('password recovery and change', () => {
  it('runs forgot, reset, and the old password stops working', async () => {
    const client = clientFor();
    const email = await confirmedAccount(client, 'reset');
    const { store } = await openTab({ email });
    const oldRefresh = store.getRefreshToken();

    assert.deepEqual(await requestPasswordReset(client, email), { status: 'check_inbox' });
    // Mail 1 confirmation, 2 welcome, 3 reset.
    const resetPage = createPage(`${stack.origin}/reset#token=${tokenFromEmail(await mail.waitForMessage(email, 3))}`);
    const token = takeTokenFromUrl(resetPage);
    assert.equal(resetPage.location.hash, '');

    // A weak password is rejected by Auth and the token stays usable.
    assert.equal((await client.resetPassword(token, 'short')).error, 'invalid_password');
    assert.deepEqual(await resetPassword(client, { token, newPassword: NEW_PASSWORD }), { status: 'reset' });

    assert.equal((await client.refresh(oldRefresh)).error, 'invalid_grant'); // all sessions were revoked
    assert.equal((await client.login(email, PASSWORD)).error, 'invalid_credentials');
    assert.equal((await client.login(email, NEW_PASSWORD)).ok, true);
    assert.deepEqual(await resetPassword(client, { token, newPassword: NEW_PASSWORD }), { status: 'invalid_link' }); // single use
  });

  it('sends a confirmation link, not a reset link, to an unconfirmed account', async () => {
    const client = clientFor();
    const email = uniqueEmail('forgotunconfirmed');
    await signUp(client, { email, password: PASSWORD });
    await mail.waitForMessage(email, 1);
    assert.deepEqual(await requestPasswordReset(client, email), { status: 'check_inbox' });
    const text = await mail.waitForMessage(email, 2);
    assert.match(text, /\/confirm#token=/);
    assert.deepEqual(await requestPasswordReset(client, uniqueEmail('ghost')), { status: 'check_inbox' }); // same answer
  });

  it('changes the password: a wrong current password keeps the session, a right one ends all of them', async () => {
    const email = await confirmedAccount(clientFor(), 'change');
    const tab = await openTab({ email });
    const other = await openTab({ email });

    const wrong = await changePassword(tab, { currentPassword: 'not my password', newPassword: NEW_PASSWORD });
    assert.deepEqual(wrong, { status: 'field_error', field: 'current_password' });
    assert.ok(tab.store.getRefreshToken()); // not logged out
    assert.equal((await tab.refresher.refresh()).status, 'ok'); // the session still works

    const weak = await changePassword(tab, { currentPassword: PASSWORD, newPassword: 'short' });
    assert.equal(weak.status, 'field_error');

    const changed = await changePassword(tab, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    assert.deepEqual(changed, { status: 'changed_log_in_again' });
    assert.equal(tab.store.getRefreshToken(), null);
    assert.equal((await other.refresher.refresh()).status, 'logged_out'); // the other session ended too
    assert.equal((await tab.client.login(email, NEW_PASSWORD)).ok, true);
  });
});

describe('error handling', () => {
  it('maps every documented error to a UI action', () => {
    const cases = {
      invalid_email: 'show_field_error',
      invalid_password: 'show_field_error',
      invalid_current_password: 'show_field_error',
      invalid_credentials: 'show_generic_login_error',
      invalid_or_expired_link: 'show_invalid_link',
      network_error: 'show_invalid_link',
      invalid_grant: 'log_in_again',
      invalid_token: 'log_in_again',
      rate_limited: 'wait',
      temporarily_unavailable: 'try_later',
      invalid_request: 'integration_bug',
      invalid_client: 'integration_bug',
      unconfigured_client: 'integration_bug',
      unsupported_media_type: 'integration_bug',
      something_new: 'show_generic_error',
    };
    for (const [error, action] of Object.entries(cases)) assert.equal(actionFor({ error }).action, action, error);
    assert.equal(actionFor({ error: 'rate_limited', retryAfter: null }).seconds, 60);
  });

  it('matches what the real API returns', async () => {
    const client = clientFor();
    assert.equal(actionFor(await client.login('nobody@example.com', PASSWORD)).action, 'show_generic_login_error');
    assert.equal(actionFor(await client.signup('bad', PASSWORD)).action, 'show_field_error');
    assert.equal(actionFor(await client.me('not-a-token')).action, 'log_in_again');
    assert.equal(actionFor(await client.refresh('unknown')).action, 'log_in_again');
    assert.equal(actionFor(await client.confirm('unknown')).action, 'show_invalid_link');
    assert.equal(actionFor(await client.confirm(undefined)).action, 'integration_bug'); // invalid_request

    const plain = await fetch(`${stack.authUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    assert.equal(plain.status, 415);
    assert.equal((await plain.json()).error, 'unsupported_media_type');
  });
});

describe('origin binding', () => {
  const login = (origin) =>
    fetch(`${stack.authUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify({ client_id: stack.clientId, email: 'nobody@example.com', password: PASSWORD }),
    });

  it('allows the registered origin and never sends credentials or cookies', async () => {
    const ok = await login(stack.origin);
    assert.equal(ok.headers.get('access-control-allow-origin'), stack.origin);
    assert.equal(ok.headers.get('access-control-allow-credentials'), null);
    assert.equal(ok.headers.get('set-cookie'), null);
  });

  it('gives no CORS header to another origin, and the same generic error', async () => {
    const other = await login('http://127.0.0.1:5173');
    assert.equal(other.status, 401);
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    assert.equal((await other.json()).error, 'invalid_credentials');
  });

  it('answers the preflight with the fixed header set', async () => {
    const response = await fetch(`${stack.authUrl}/api/v1/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: stack.origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
    assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type, Authorization');
    assert.equal(response.headers.get('access-control-max-age'), '600');
    assert.equal(response.headers.get('vary'), 'Origin');
  });
});

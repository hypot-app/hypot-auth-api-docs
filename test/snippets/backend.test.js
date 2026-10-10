// The backend snippets from examples/backend (Node + jose), against the real API and a local JWKS server.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { fetchAccount } from '../../examples/backend/read-user.js';
import { bearerToken, createAccessTokenVerifier, createAuthenticator } from '../../examples/backend/verify-access-token.js';
import { PASSWORD, confirmedAccountRaw, mailbox, startStack } from '../support/stack.js';

let stack;
let mail;
let verify;
let otherClientId;

before(
  async () => {
    stack = await startStack();
    mail = mailbox(stack.mailpitUrl);
    verify = createAccessTokenVerifier({ jwksUrl: stack.jwksUrl, issuer: stack.issuer, clientId: stack.clientId });
    otherClientId = await stack.registerApp('Another app');
  },
  { timeout: 600_000 },
);
after(async () => stack?.stop(), { timeout: 120_000 });

const login = async (clientId, email) =>
  (
    await (
      await fetch(`${stack.authUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, email, password: PASSWORD }),
      })
    ).json()
  ).access_token;

const decode = (jwt, part = 0) => JSON.parse(Buffer.from(jwt.split('.')[part], 'base64url').toString());

describe('verifying real access tokens', () => {
  it('accepts a token issued to this app and exposes sub as the account id', async () => {
    const email = await confirmedAccountRaw(stack, mail, stack.clientId);
    const token = await login(stack.clientId, email);

    const header = decode(token, 0);
    assert.equal(header.alg, 'RS256');
    assert.equal(header.typ, 'at+jwt');
    assert.ok(header.kid);

    const payload = await verify(token);
    assert.equal(payload.iss, stack.issuer);
    assert.equal(payload.aud, stack.clientId);
    assert.equal(payload.exp - payload.iat, 3600);
    assert.deepEqual(Object.keys(payload).sort(), ['aud', 'exp', 'iat', 'iss', 'jti', 'sub']); // no roles, no profile

    const account = await fetchAccount({ authUrl: stack.authUrl, accessToken: token });
    assert.equal(account.id, payload.sub);
    assert.equal(account.email, email);
    assert.equal(account.email_verified, true);
    assert.deepEqual(Object.keys(account).sort(), ['created_at', 'email', 'email_verified', 'id']);
  });

  it('rejects a token issued to another app, even though it is a valid JWT', async () => {
    const email = await confirmedAccountRaw(stack, mail, otherClientId);
    const foreign = await login(otherClientId, email);
    await assert.rejects(verify(foreign), { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' });
    // The other app accepts it: the signature is fine, only the audience differs.
    const otherVerify = createAccessTokenVerifier({ jwksUrl: stack.jwksUrl, issuer: stack.issuer, clientId: otherClientId });
    assert.equal((await otherVerify(foreign)).aud, otherClientId);
  });

  it('rejects a tampered token and garbage', async () => {
    const email = await confirmedAccountRaw(stack, mail, stack.clientId);
    const token = await login(stack.clientId, email);
    const [header, payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...decode(token, 1), sub: 'someone-else' })).toString('base64url');
    await assert.rejects(verify(`${header}.${forgedPayload}.${signature}`));
    await assert.rejects(verify('not.a.jwt'));
    await assert.rejects(verify(`${header}.${payload}.`));
  });

  it('fetchAccount returns null for a bad token', async () => {
    assert.equal(await fetchAccount({ authUrl: stack.authUrl, accessToken: 'bad' }), null);
  });

  it('the authenticator answers null without leaking the reason', async () => {
    const email = await confirmedAccountRaw(stack, mail, stack.clientId);
    const token = await login(stack.clientId, email);
    const authenticate = createAuthenticator(verify);
    assert.deepEqual(await authenticate({ authorization: `Bearer ${token}` }), {
      accountId: decode(token, 1).sub,
    });
    assert.equal(await authenticate({}), null);
    assert.equal(await authenticate({ authorization: 'Basic abc' }), null);
    assert.equal(await authenticate({ authorization: 'Bearer garbage' }), null);
    assert.equal(bearerToken('Bearer a b'), null);
  });
});

describe('the JWKS endpoint', () => {
  it('publishes only public keys, active and next, and allows caching for 5 minutes', async () => {
    const response = await fetch(stack.jwksUrl);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
    const { keys } = await response.json();
    assert.equal(keys.length, 2); // the test stack has an active and a next key
    for (const key of keys) {
      assert.equal(key.kty, 'RSA');
      assert.ok(key.kid);
      for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) assert.equal(key[secret], undefined, secret);
    }
  });
});

describe('verification rules against a local JWKS (what the real API cannot produce)', () => {
  const issuer = 'https://auth.example';
  const clientId = 'app_0123456789abcdef0123456789abcdef';
  let server;
  let url;
  let published = [];
  let hits = 0;

  async function newKey(kid) {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    return { kid, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
  }
  const sign = (key, { typ = 'at+jwt', alg = 'RS256', aud = clientId, iss = issuer, exp = '1h', sub = 'acc_1' } = {}) =>
    new SignJWT({}).setProtectedHeader({ alg, typ, kid: key.kid }).setIssuer(iss).setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(key.privateKey);

  before(async () => {
    server = createServer((_request, response) => {
      hits += 1;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ keys: published.map((key) => key.jwk) }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/.well-known/jwks.json`;
  });
  after(() => server?.close());

  it('checks typ, issuer and expiry', async () => {
    const key = await newKey('k1');
    published = [key];
    const verifier = createAccessTokenVerifier({ jwksUrl: url, issuer, clientId });
    assert.equal((await verifier(await sign(key))).sub, 'acc_1');
    await assert.rejects(verifier(await sign(key, { typ: 'JWT' })), { claim: 'typ' });
    await assert.rejects(verifier(await sign(key, { iss: 'https://evil.example' })), { claim: 'iss' });
    await assert.rejects(verifier(await sign(key, { exp: Math.floor(Date.now() / 1000) - 60 })), { code: 'ERR_JWT_EXPIRED' });
  });

  it('accepts only RS256', async () => {
    const key = await newKey('k2');
    published = [key];
    const verifier = createAccessTokenVerifier({ jwksUrl: url, issuer, clientId });
    const hs = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'k2' }).setIssuer(issuer).setAudience(clientId).setSubject('x').setExpirationTime('1h').sign(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));
    await assert.rejects(verifier(hs));
    const none = ['{"alg":"none","typ":"at+jwt","kid":"k2"}', JSON.stringify({ iss: issuer, aud: clientId, sub: 'x', exp: 9999999999 })]
      .map((part) => Buffer.from(part).toString('base64url'))
      .join('.') + '.';
    await assert.rejects(verifier(none));
  });

  it('ignores any jku in the token header: only the configured URL is used', async () => {
    const key = await newKey('k3');
    published = [key];
    const verifier = createAccessTokenVerifier({ jwksUrl: url, issuer, clientId });
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'k3', jku: 'https://evil.example/jwks.json' }).setIssuer(issuer).setAudience(clientId).setSubject('x').setExpirationTime('1h').sign(key.privateKey);
    assert.equal((await verifier(token)).sub, 'x');
  });

  it('caches the JWKS and, on an unknown kid, refuses to refetch inside the cooldown', async () => {
    const a = await newKey('rot-a');
    published = [a];
    const verifier = createAccessTokenVerifier({ jwksUrl: url, issuer, clientId });
    await verifier(await sign(a));
    const afterFirst = hits;
    await verifier(await sign(a));
    assert.equal(hits, afterFirst); // served from the cache

    // A new key appears (rotation). Its first token arrives inside the 30 s cooldown: no refetch, rejected.
    const b = await newKey('rot-b');
    published = [a, b];
    await assert.rejects(verifier(await sign(b)), { code: 'ERR_JWKS_NO_MATCHING_KEY' });
    assert.equal(hits, afterFirst);

    // A verifier with a cold cache (a restart, or an expired cache) does see the new key.
    const fresh = createAccessTokenVerifier({ jwksUrl: url, issuer, clientId });
    assert.equal((await fresh(await sign(b))).sub, 'acc_1');
  });
});

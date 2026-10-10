// Real stack for the snippet tests: Postgres 17 + the API image built from the `api` submodule + Mailpit.
// Everything runs in Testcontainers on a private network. Nothing is shared between test files.
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Network, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_IMAGE = 'hypot-auth-api-docs-test:local';
const MAILPIT_IMAGE = 'axllent/mailpit:v1.31.3';
const POSTGRES_IMAGE = 'postgres:17-alpine';
const NODE = '/nodejs/bin/node'; // the runtime image is distroless: no shell, only node

/** The browser origin that the registered test app allows. Node has no real browser origin, so tests send it. */
export const APP_ORIGIN = 'http://localhost:5173';
/** What AUTH_PUBLIC_BASE_URL says. It is only the `iss` claim: tests fetch the JWKS from the mapped port. */
export const ISSUER = 'http://localhost:3000';

/** Builds the API image from the submodule. Docker caches the layers, so only the first run is slow. */
async function buildApiImage() {
  await GenericContainer.fromDockerfile(join(ROOT, 'api')).build(API_IMAGE, { deleteOnExit: false });
}

/** Same format as the API's own dev generator: an RSA JWK with an RFC 7638 thumbprint as `kid`. */
export function generateSigningKeys() {
  const privateJwk = () => {
    const jwk = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });
    const kid = createHash('sha256')
      .update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
      .digest('base64url');
    return { ...jwk, kid };
  };
  return { active: privateJwk(), next: privateJwk() };
}

function apiEnv(extra = {}) {
  return {
    // The image sets production, which refuses http URLs. The dev compose of the API does the same override.
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'postgres://hypot:hypot_test@postgres:5432/hypot',
    AUTH_PUBLIC_BASE_URL: ISSUER,
    SMTP_HOST: 'mailpit',
    SMTP_PORT: '1025',
    SMTP_SECURE: 'false',
    MAIL_FROM: 'no-reply@hypot.local',
    // A single docker bridge address serves every test, so raise the limits that are not under test.
    ABUSE_EMAIL_IP_LIMIT: '100000',
    ABUSE_CONFIRM_IP_LIMIT: '100000',
    ABUSE_RESET_IP_LIMIT: '100000',
    ABUSE_REFRESH_IP_LIMIT: '100000',
    ABUSE_LOGIN_IP_LIMIT: '100000',
    ...extra,
  };
}

/** Splits `docker compose run --rm api dist/cli.js <args>` into the args that follow `dist/cli.js`. */
export function cliArgsFromSnippet(snippet, env = {}) {
  const prefix = 'docker compose run --rm api dist/cli.js ';
  const text = snippet
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\r?\n/g, ' ')
    .trim();
  if (!text.startsWith(prefix)) throw new Error(`The CLI snippet must start with "${prefix}"`);
  const args = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(text.slice(prefix.length))) !== null) {
    const raw = match[1] ?? match[2];
    args.push(raw.replace(/\$(\w+)/g, (_, name) => env[name] ?? ''));
  }
  return args;
}

/**
 * Starts the stack. Options:
 * - `strict`: also starts a second API instance (own app) whose refresh limit is 2 per window, to see a real 429.
 * Returns URLs, the registered test app and `stop()`.
 */
export async function startStack({ strict = false } = {}) {
  await buildApiImage();
  const network = await new Network().start();
  const started = [];
  const track = (container) => (started.push(container), container);

  try {
    const postgres = track(
      await new PostgreSqlContainer(POSTGRES_IMAGE)
        .withDatabase('hypot')
        .withUsername('hypot')
        .withPassword('hypot_test')
        .withNetwork(network)
        .withNetworkAliases('postgres')
        .start(),
    );
    const mailpit = track(
      await new GenericContainer(MAILPIT_IMAGE)
        .withNetwork(network)
        .withNetworkAliases('mailpit')
        .withExposedPorts(8025, 1025)
        .withWaitStrategy(Wait.forHttp('/livez', 8025))
        .start(),
    );

    // One-shot migration. Same command as the `migrate` service of api/compose.yaml.
    await track(
      await new GenericContainer(API_IMAGE)
        .withNetwork(network)
        .withEnvironment({ DATABASE_URL: apiEnv().DATABASE_URL })
        .withCommand(['node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/platform/persistence/data-source.js'])
        .withWaitStrategy(Wait.forOneShotStartup())
        .start(),
    );

    const signingKeys = JSON.stringify(generateSigningKeys());
    const startApi = async (extraEnv, alias) =>
      track(
        await new GenericContainer(API_IMAGE)
          .withNetwork(network)
          .withNetworkAliases(alias)
          .withEnvironment(apiEnv({ AUTH_SIGNING_KEYS: signingKeys, ...extraEnv }))
          .withExposedPorts(3000)
          .withWaitStrategy(Wait.forHttp('/health', 3000))
          .start(),
      );

    const api = await startApi({}, 'auth');
    const authUrl = `http://${api.getHost()}:${api.getMappedPort(3000)}`;
    const mailpitUrl = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`;

    /** Registers an app through the operator CLI inside the container, like an operator would. */
    const runCli = async (container, args) => {
      const result = await container.exec([NODE, 'dist/cli.js', ...args]);
      return { exitCode: result.exitCode, output: result.output.trim(), stdout: result.stdout.trim() };
    };
    const registerApp = async (container, name = 'Docs test app') => {
      const { exitCode, output, stdout } = await runCli(container, [
        'app',
        'create',
        '--name',
        name,
        '--origin',
        APP_ORIGIN,
        '--email-confirmation-url',
        `${APP_ORIGIN}/confirm`,
        '--password-reset-url',
        `${APP_ORIGIN}/reset`,
      ]);
      const clientId = /client_id: (app_[0-9a-f]{32})/.exec(stdout)?.[1];
      if (exitCode !== 0 || !clientId) throw new Error(`app create failed: ${output}`);
      return clientId;
    };

    const clientId = await registerApp(api);
    const stack = {
      authUrl,
      mailpitUrl,
      // The same services as seen from other containers on the test network.
      internal: { authUrl: 'http://auth:3000', mailpitUrl: 'http://mailpit:8025', strictAuthUrl: 'http://auth-strict:3000' },
      issuer: ISSUER,
      jwksUrl: `${authUrl}/.well-known/jwks.json`,
      origin: APP_ORIGIN,
      clientId,
      network,
      api,
      runCli: (args) => runCli(api, args),
      registerApp: (name) => registerApp(api, name),
      stop: async () => {
        for (const container of started.reverse()) await container.stop({ remove: true, removeVolumes: true });
        await network.stop();
      },
    };

    if (strict) {
      const strictApi = await startApi({ ABUSE_REFRESH_IP_LIMIT: '2' }, 'auth-strict');
      stack.strict = {
        authUrl: `http://${strictApi.getHost()}:${strictApi.getMappedPort(3000)}`,
        clientId: await registerApp(strictApi, 'Docs strict app'),
      };
    }
    return stack;
  } catch (error) {
    for (const container of started.reverse()) await container.stop({ remove: true, removeVolumes: true }).catch(() => {});
    await network.stop().catch(() => {});
    throw error;
  }
}

/** A fetch that adds the browser's `Origin` header. Node has no real origin, and Auth binds CORS to it. */
export function fetchWithOrigin(origin = APP_ORIGIN, baseFetch = globalThis.fetch) {
  return (url, init = {}) => baseFetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
}

export function uniqueEmail(label = 'user') {
  return `${label}-${randomBytes(4).toString('hex')}@example.com`;
}

export const PASSWORD = 'correct horse battery';
export const NEW_PASSWORD = 'a new long passphrase';

/** Reads mail through Mailpit's HTTP API, the way a developer would in the local stack. */
export function mailbox(mailpitUrl) {
  async function messagesTo(email) {
    const response = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    return (await response.json()).messages ?? [];
  }
  return {
    messagesTo,
    /** Waits until `count` messages exist for the address (the outbox worker polls every 2 s) and returns the newest text. */
    async waitForMessage(email, count = 1, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const messages = await messagesTo(email);
        if (messages.length >= count) {
          const detail = await fetch(`${mailpitUrl}/api/v1/message/${messages[0].ID}`);
          return (await detail.json()).Text;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`No email #${count} for ${email} after ${timeoutMs} ms`);
    },
  };
}

/** Extracts the `#token=` value of the first link in an email body. */
export function tokenFromEmail(text) {
  const match = /#token=([^\s"<>]+)/.exec(text);
  if (!match) throw new Error('The email has no #token= link');
  return match[1];
}

/** Signup + confirm with plain `fetch` calls (no snippet involved). Returns the email of a confirmed account. */
export async function confirmedAccountRaw(stack, mail, clientId = stack.clientId, label = 'raw') {
  const email = uniqueEmail(label);
  const post = (path, body) =>
    fetch(`${stack.authUrl}/api/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: stack.origin },
      body: JSON.stringify(body),
    });
  const signup = await post('/accounts/signup', { client_id: clientId, email, password: PASSWORD });
  if (signup.status !== 202) throw new Error(`signup failed: ${signup.status}`);
  const token = tokenFromEmail(await mail.waitForMessage(email));
  const confirm = await post('/accounts/confirm', { token });
  if (confirm.status !== 200) throw new Error(`confirm failed: ${confirm.status}`);
  return email;
}

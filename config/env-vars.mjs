// Every environment variable of the Auth API, in the order the Configuración page shows them.
// Source of truth for the page AND for test/api/config.test.js, which compares this list with
// api/docs/env-example-additions.md and with the defaults that the API's own loaders return.
//
// Fields: name, required, default (string shown to the reader; null when there is none), rule, description.

const abuse = (scope, label, limit, windowSeconds, block) => [
  {
    name: `ABUSE_${scope}_LIMIT`,
    required: false,
    default: String(limit),
    rule: 'Entero positivo (máximo 2147483647)',
    description: `${label}: intentos permitidos por ventana.`,
  },
  {
    name: `ABUSE_${scope}_WINDOW_SECONDS`,
    required: false,
    default: String(windowSeconds),
    rule: 'Entero positivo (máximo 2147483647)',
    description: `${label}: duración de la ventana, en segundos.`,
  },
  ...(block === undefined
    ? []
    : [
        {
          name: `ABUSE_${scope}_BLOCK_SECONDS`,
          required: false,
          default: String(block),
          rule: 'Entero positivo (máximo 2147483647)',
          description: `${label}: duración del bloqueo, en segundos.`,
        },
      ]),
];

export const envGroups = [
  {
    id: 'ejecucion',
    title: 'Ejecución',
    vars: [
      {
        name: 'NODE_ENV',
        required: false,
        default: 'development',
        rule: '`development`, `test` o `production`',
        description:
          'Con `production` el servicio exige un `AUTH_PUBLIC_BASE_URL` `https` y rechaza orígenes y URL `http`. La imagen ya trae `production`.',
      },
      { name: 'PORT', required: false, default: '3000', rule: 'Entero de 1 a 65535', description: 'Puerto HTTP del servicio.' },
      {
        name: 'DATABASE_URL',
        required: true,
        default: null,
        rule: 'URL de conexión a Postgres',
        description: 'Base de datos del servicio. Es el único estado, junto con las claves de firma.',
      },
    ],
  },
  {
    id: 'emisor',
    title: 'Emisor',
    vars: [
      {
        name: 'AUTH_PUBLIC_BASE_URL',
        required: true,
        default: null,
        rule: 'URL absoluta http(s), sin barra final, sin query y sin fragmento. Solo `https` en producción',
        description:
          'Se copia tal cual en el claim `iss` de cada token y de ella sale la URL de la JWKS (`<valor>/.well-known/jwks.json`).',
      },
    ],
  },
  {
    id: 'correo',
    title: 'Correo (SMTP)',
    vars: [
      { name: 'SMTP_HOST', required: true, default: null, rule: 'Texto no vacío', description: 'Servidor SMTP.' },
      { name: 'SMTP_PORT', required: false, default: '587', rule: 'Entero de 1 a 65535', description: 'Puerto SMTP.' },
      { name: 'SMTP_SECURE', required: false, default: 'false', rule: '`true` o `false`', description: 'TLS directo (puerto 465).' },
      {
        name: 'SMTP_USER',
        required: false,
        default: null,
        rule: 'Texto no vacío. Se define junto con `SMTP_PASS` o ninguno',
        description: 'Usuario SMTP.',
      },
      {
        name: 'SMTP_PASS',
        required: false,
        default: null,
        rule: 'Texto no vacío. Se define junto con `SMTP_USER` o ninguno',
        description: 'Contraseña SMTP.',
      },
      {
        name: 'MAIL_FROM',
        required: true,
        default: null,
        rule: 'Texto no vacío',
        description: 'Remitente por defecto. Cada app puede reemplazarlo con `--email-from`.',
      },
    ],
  },
  {
    id: 'claves',
    title: 'Claves de firma',
    vars: [
      {
        name: 'AUTH_SIGNING_KEYS_FILE',
        required: false,
        default: null,
        rule: 'Ruta de un archivo. Define exactamente una de las dos variables de claves',
        description: 'Archivo montado con el conjunto de claves JSON (recomendado).',
      },
      {
        name: 'AUTH_SIGNING_KEYS',
        required: false,
        default: null,
        rule: 'JSON del conjunto de claves. Define exactamente una de las dos variables de claves',
        description: 'El mismo JSON, en la propia variable.',
      },
    ],
  },
  {
    id: 'proxy',
    title: 'Proxy inverso',
    vars: [
      {
        name: 'TRUST_PROXY',
        required: false,
        default: 'false',
        rule: '`false`, un número de saltos de 1 a 10, o una lista separada por comas de `loopback`, `linklocal`, `uniquelocal`, IP o CIDR (no más amplios que /8 en IPv4 ni /16 en IPv6). `true` se rechaza',
        description: 'Qué proxies delante de Auth son de confianza para leer la IP real del cliente.',
      },
    ],
  },
  {
    id: 'abuso',
    title: 'Límites de abuso',
    vars: [
      ...abuse('LOGIN_IP', 'Login por IP', 100, 900),
      ...abuse('LOGIN_ACCOUNT_IP', 'Login por par (cuenta, IP)', 5, 900, 900),
      ...abuse('LOGIN_ACCOUNT', 'Login por cuenta, desde cualquier IP', 50, 3600, 900),
      ...abuse('EMAIL_IP', 'Correos (signup, resend y forgot) por IP', 20, 3600),
      ...abuse('RESET_IP', 'Restablecimiento de contraseña por IP', 20, 3600),
      ...abuse('CONFIRM_IP', 'Confirmación de correo por IP', 20, 3600),
      ...abuse('REFRESH_IP', 'Refresh por (app, IP)', 60, 900),
      ...abuse('EMAIL_ACCOUNT', 'Correos por cuenta', 3, 3600),
    ],
  },
  {
    id: 'sesiones',
    title: 'Sesiones',
    vars: [
      {
        name: 'REFRESH_IDLE_TTL_SECONDS',
        required: false,
        default: '604800',
        rule: 'Entero positivo (máximo 2147483647)',
        description: 'Un refresh token vence tras este tiempo sin usarse (7 días), limitado al fin de la sesión.',
      },
      {
        name: 'REFRESH_ABSOLUTE_TTL_SECONDS',
        required: false,
        default: '2592000',
        rule: 'Entero positivo (máximo 2147483647)',
        description: 'Duración de la sesión desde el login (30 días). La rotación no la extiende.',
      },
      {
        name: 'REFRESH_REUSE_GRACE_SECONDS',
        required: false,
        default: '10',
        rule: 'Entero no negativo (máximo 2147483647). `0` la desactiva',
        description: 'Ventana en la que un token rotado, presentado de nuevo una vez desde la misma IP, se perdona.',
      },
    ],
  },
  {
    id: 'capacidad',
    title: 'Capacidad (Node, no Auth)',
    vars: [
      {
        name: 'UV_THREADPOOL_SIZE',
        required: false,
        default: '4',
        rule: 'Entero positivo',
        description:
          'bcrypt corre en el pool de hilos de libuv. Ponlo igual al número de núcleos del contenedor: con más hilos que núcleos no hay ganancia.',
      },
    ],
  },
];

export const allEnvVars = envGroups.flatMap((group) => group.vars);

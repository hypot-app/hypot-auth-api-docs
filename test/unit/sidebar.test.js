// The sidebar must list every page of the approved plan, in order, and every page must exist.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { aboutSection, referenceLabel, sidebarSections, sidebarSlugs } from '../../config/sidebar.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

// The approved plan (section label -> pages). Changing the structure of the site means changing this list on purpose.
const PLAN = [
  ['Inicio', ['index', 'inicio-rapido']],
  [
    'Para frontend',
    [
      'frontend/registro-y-confirmacion',
      'frontend/login-y-tokens',
      'frontend/refresh',
      'frontend/logout',
      'frontend/recuperar-y-cambiar-contrasena',
      'frontend/manejo-de-errores',
    ],
  ],
  ['Para backend', ['backend/validar-access-tokens', 'backend/leer-el-usuario']],
  [
    'Conceptos',
    ['conceptos/apps-y-origenes', 'conceptos/sesiones-y-tokens', 'conceptos/proteccion-contra-abuso', 'conceptos/seguridad'],
  ],
  ['Operación', ['operacion/despliegue', 'operacion/configuracion', 'operacion/operaciones', 'operacion/capacidad']],
];

describe('sidebar', () => {
  it('has the planned sections and pages, in order', () => {
    assert.deepEqual(
      sidebarSections.map((section) => [section.label, section.items.map((item) => item.slug)]),
      PLAN,
    );
    assert.equal(aboutSection.label, 'Sobre esta documentación');
    assert.deepEqual(aboutSection.items.map((item) => item.slug), ['sobre-esta-documentacion']);
  });

  it('every sidebar page exists as a content file, and every content file is in the sidebar', () => {
    for (const slug of sidebarSlugs()) assert.ok(existsSync(join(ROOT, 'src', 'content', 'docs', `${slug}.mdx`)), `${slug}.mdx is missing`);
    const listed = new Set(sidebarSlugs());
    const files = [
      'index',
      'inicio-rapido',
      'sobre-esta-documentacion',
      ...PLAN.flatMap(([, slugs]) => slugs),
    ];
    for (const slug of files) assert.ok(listed.has(slug), `${slug} is not in the sidebar`);
  });

  it('puts the generated API reference between Operación and Sobre esta documentación', () => {
    const config = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8');
    assert.match(config, /sidebar: \[\.\.\.sidebarSections, \.\.\.openAPISidebarGroups, aboutSection\]/);
    assert.match(config, /schema: '\.\/api\/openapi\.json'/);
    assert.equal(referenceLabel, 'Referencia de la API');
  });

  it('labels and titles are in Spanish and every page has a title and a description', () => {
    for (const slug of sidebarSlugs()) {
      const text = readFileSync(join(ROOT, 'src', 'content', 'docs', `${slug}.mdx`), 'utf8');
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
      assert.match(front, /^title: ".+"$/m, `${slug} has no title`);
      assert.match(front, /^description: ".{20,}"$/m, `${slug} has no description`);
    }
  });
});

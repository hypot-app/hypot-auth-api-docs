// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';
import { aboutSection, referenceLabel, sidebarSections } from './config/sidebar.mjs';

export default defineConfig({
  // Never inline CSS in the HTML: the Content-Security-Policy of the container does not allow inline styles.
  // Never inline CSS or small scripts in the HTML: the Content-Security-Policy of the container allows
  // only same-origin files plus the hashes of the few inline scripts that Starlight itself writes.
  build: { inlineStylesheets: 'never' },
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [
    starlight({
      title: 'hypot Auth',
      description: 'Documentación de la API de autenticación hypot Auth para equipos de frontend y backend.',
      defaultLocale: 'root',
      locales: { root: { label: 'Español', lang: 'es' } },
      editLink: { baseUrl: 'https://github.com/hypot-app/hypot-auth-api-docs/edit/develop/' },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/hypot-app/hypot-auth-api-docs' }],
      plugins: [
        // The API reference pages are injected routes by starlight-openapi, which the validator does not know about.
        starlightLinksValidator({ exclude: ['/referencia/', '/referencia/**'] }),
        starlightOpenAPI([
          {
            base: 'referencia',
            schema: './api/openapi.json',
            sidebar: { label: referenceLabel, collapsed: false },
          },
        ]),
      ],
      sidebar: [...sidebarSections, ...openAPISidebarGroups, aboutSection],
    }),
  ],
});

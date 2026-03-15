// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  // ── Site Metadata ──────────────────────────────────────────────────────
  title: 'Market Data Bridge',
  tagline: 'Auto-generated API docs, architecture diagrams, and UI previews',
  favicon: 'img/favicon.svg',

  // ── GitHub Pages Deployment ────────────────────────────────────────────
  url: 'https://dotcal604.github.io',
  baseUrl: '/market-data-bridge/',
  organizationName: 'dotcal604',
  projectName: 'market-data-bridge',
  trailingSlash: false,

  // ── Build Settings ─────────────────────────────────────────────────────
  onBrokenLinks: 'warn',
  onBrokenAnchors: 'warn',

  markdown: {
    // Use CommonMark format to avoid MDX parsing errors on angle brackets,
    // generics, and JSX-like syntax in TypeDoc-generated API docs.
    format: 'md',
    mermaid: true,
    hooks: {
      onBrokenMarkdownImages: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // ── Mermaid Support ────────────────────────────────────────────────────
  // Enabled via markdown.mermaid above. Theme provides client-side rendering.
  themes: ['@docusaurus/theme-mermaid'],

  // ── Presets ────────────────────────────────────────────────────────────
  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/dotcal604/market-data-bridge/tree/main/docs-site/',
        },
        blog: false, // No blog needed
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  // ── Theme Configuration ────────────────────────────────────────────────
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'Market Data Bridge',
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'apiSidebar',
            position: 'left',
            label: 'API Reference',
          },
          {
            type: 'docSidebar',
            sidebarId: 'architectureSidebar',
            position: 'left',
            label: 'Architecture',
          },
          {
            type: 'docSidebar',
            sidebarId: 'previewsSidebar',
            position: 'left',
            label: 'UI Previews',
          },
          {
            href: 'https://github.com/dotcal604/market-data-bridge',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              { label: 'API Reference', to: '/docs/api/' },
              { label: 'Architecture', to: '/docs/architecture/' },
              { label: 'UI Previews', to: '/docs/previews/' },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/dotcal604/market-data-bridge',
              },
            ],
          },
        ],
        copyright: `Copyright \u00a9 ${new Date().getFullYear()} Market Data Bridge. Built with Docusaurus.`,
      },
      prism: {
        theme: require('prism-react-renderer').themes.github,
        darkTheme: require('prism-react-renderer').themes.dracula,
      },
      // Mermaid theme configuration
      mermaid: {
        theme: { light: 'default', dark: 'dark' },
      },
    }),
};

module.exports = config;

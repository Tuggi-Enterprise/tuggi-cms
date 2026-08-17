const createNextIntlPlugin = require('next-intl/plugin');
 
const withNextIntl = createNextIntlPlugin('./i18n.ts');
 
/**
 * Where the partnership proposal moved to (#396).
 *
 * The form used to be `app/[locale]/parceria/page.tsx` here; it is now served by the site, at
 * `tuggi-enterprise`, route `/partners/proposal`, whose `pt` slug is `/parcerias/proposta`. The
 * URL is absolute and typed out because the two repositories cannot import each other's route
 * map — the document that binds them is `docs/contracts/partner-proposal-answers.md`, and
 * `tests/api/partner-form.test.ts` asserts this exact string so a slug change is not silent.
 *
 * THIS REDIRECT IS NOT OPTIONAL. The commercial team e-mailed `/pt/parceria` to real
 * establishments before the move, so the old address has to keep working — deleting the page
 * without it would answer 404 to material already handed out.
 */
const PARTNER_PROPOSAL_URL = 'https://www.tuggi.app/pt/parcerias/proposta'

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        // Every locale, not only `pt`: the page redirected the other three to `/pt/parceria`
        // before, so all four are addresses somebody may have.
        source: '/:locale(en|pt|es)/parceria',
        destination: PARTNER_PROPOSAL_URL,
        // 301 and not `permanent: true`, which Next emits as 308. The page is gone from this
        // deployment for good, and 301 is the status the search engines and the mail clients
        // that already saw this URL handle without surprises. `statusCode` and `permanent` are
        // mutually exclusive in Next's config, so only one of them appears here.
        statusCode: 301,
      },
      {
        // The address without a locale segment. `proxy.ts` would otherwise prepend `/en` and
        // hand it to the auth gate, which sends anonymous callers to the login screen — and a
        // login screen is a worse answer than a 404 for a merchant with a link in an e-mail.
        // Config redirects run BEFORE the proxy (Next.js 16, "Execution order", step 2 against
        // step 3), so this one is what answers.
        source: '/parceria',
        destination: PARTNER_PROPOSAL_URL,
        statusCode: 301,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'xvlpjyxobtddrqyihdzy.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'tysnkzmljlmmqpbotkxv.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'maps.googleapis.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow, nosnippet, noarchive, noimageindex'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)'
          }
        ]
      }
    ]
  },
  // `data/` holds local development caches, not runtime assets. `next build` runs
  // @vercel/nft, which statically evaluates `fs` usage: `SRTMLocalService` builds
  // `path.join(process.cwd(), 'data', 'srtm-cache')` and passes it to `TileSet`, so
  // nft emits that *whole directory* as an asset of every route that can reach the
  // module. With a populated local tile cache that is ~2.9 GB copied into each of
  // nine Functions, which is what broke the production deploy (#179 — the Vercel
  // limit is 250 MB uncompressed per Function).
  //
  // Nothing reads these directories in production: the Lambda filesystem is
  // read-only, so the SRTM tiles can only ever be downloaded and read on a
  // developer machine or in a script. `data/sample-data` is test fixture data.
  // Keys are route globs (picomatch); values are globs from the project root.
  // See tests/bundle/route-trace-size.test.ts for the ruler that measures this.
  outputFileTracingExcludes: {
    '/**': ['./data/**/*'],
  },
  // Explicitly exclude supabase functions and plugins from the build process
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    // Ignore supabase functions and plugins directories
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/supabase/functions/**/*', '**/plugins/**/*']
    };
    return config;
  },
  turbopack: {},
}
 
module.exports = withNextIntl(nextConfig);
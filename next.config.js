const createNextIntlPlugin = require('next-intl/plugin');
 
const withNextIntl = createNextIntlPlugin('./i18n.ts');
 
/** @type {import('next').NextConfig} */
const nextConfig = {
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
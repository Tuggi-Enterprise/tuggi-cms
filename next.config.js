/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: [
      'supabase.co',
      'xvlpjyxobtddrqyihdzy.supabase.co', // Add your actual Supabase project URL
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
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ]
      }
    ]
  },
  // Explicitly exclude supabase functions from the build process
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    // Ignore supabase functions directory
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/supabase/functions/**/*']
    };
    return config;
  },
}

module.exports = nextConfig
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: [
      'supabase.co',
      'xvlpjyxobtddrqyihdzy.supabase.co', // Add your actual Supabase project URL
    ],
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
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
  },
  images: {
    domains: [
      'supabase.co',
      'xvlpjyxobtddrqyihdzy.supabase.co', // Add your actual Supabase project URL
    ],
  },
}

module.exports = nextConfig 
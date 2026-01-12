/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['libsodium-wrappers'],
  },
  transpilePackages: ['@laneshare/shared'],
}

module.exports = nextConfig

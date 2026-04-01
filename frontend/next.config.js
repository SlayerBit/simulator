import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd()),
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://34.47.214.250/api/:path*'
      },
    ];
  },
};

export default nextConfig;
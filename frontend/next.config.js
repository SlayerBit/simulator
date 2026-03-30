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
        destination: 'http://34.93.101.127/:path*',
      },
    ];
  },
};

export default nextConfig;
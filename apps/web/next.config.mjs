const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_ORIGIN ?? 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
};
export default nextConfig;


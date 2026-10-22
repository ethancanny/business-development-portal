/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      // Navigation Restructure: the audit trail now lives under Settings.
      {
        source: "/audit-trail",
        destination: "/settings/audit-trail",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;

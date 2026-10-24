/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // sharp (logo ingest) is a native module — keep it external so
    // route handlers load the platform binary instead of a bundle.
    serverComponentsExternalPackages: ["sharp"],
  },
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

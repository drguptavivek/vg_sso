/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  allowedDevOrigins: ["sso1admin.aiims.edu.in"],
  output: "standalone",
};

export default nextConfig;

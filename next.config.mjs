/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The floating dev badge sits exactly on top of the first tab-bar button,
  // which makes the Scan tab unclickable while developing. Dev-only setting;
  // it has no effect on a production build.
  devIndicators: {
    buildActivity: false,
    appIsrStatus: false,
  },
};

export default nextConfig;

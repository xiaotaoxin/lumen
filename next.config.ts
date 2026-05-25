import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js dev-mode on-screen indicator (the small N badge in the
  // bottom-left that opens a Route / Bundler / Preferences popover). Its
  // labels are bundled English and not translatable; production builds don't
  // show it either way.
  devIndicators: false,
};

export default nextConfig;

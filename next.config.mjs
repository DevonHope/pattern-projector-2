import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  cacheOnFrontEndNav: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
});

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-hosting: serve under a sub-path (e.g. "/pattern-projector") and
  // build a standalone server for the Docker image.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    config.resolve.fallback = { fs: false };
    return config;
  },
};

export default withNextIntl(withSerwist(nextConfig));

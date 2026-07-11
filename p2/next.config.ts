import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal server bundle for the Docker/Railway runtime stage.
  output: "standalone",
};

export default nextConfig;

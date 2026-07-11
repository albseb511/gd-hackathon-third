import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // minimal server bundle for the Docker runtime stage
  output: "standalone",
};

export default nextConfig;

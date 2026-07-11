"use client";

// Client-only mount: R3F cannot server-render, so load the Canvas with ssr:false.
import dynamic from "next/dynamic";

const Viewport = dynamic(() => import("./Viewport"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-zinc-400">
      Loading 3D room…
    </div>
  ),
});

export default function ViewportMount() {
  return <Viewport />;
}

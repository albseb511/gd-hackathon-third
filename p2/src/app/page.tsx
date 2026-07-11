import ViewportMount from "@/components/viewport/ViewportMount";

export default function Home() {
  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#0e0f12]">
      <div className="absolute inset-0">
        <ViewportMount />
      </div>
      <div className="pointer-events-none absolute left-6 top-6 z-10 select-none">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Atelier</h1>
        <p className="text-xs text-zinc-400">Agentic 3D interior design — M0 scaffold</p>
      </div>
    </div>
  );
}

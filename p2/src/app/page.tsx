import ViewportMount from "@/components/viewport/ViewportMount";
import { ControlPanel } from "@/components/panel/ControlPanel";

export default function Home() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0e0f12]">
      <div className="relative min-w-0 flex-1">
        <ViewportMount />
        <div className="pointer-events-none absolute left-6 top-5 z-10 select-none">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Atelier</h1>
          <p className="text-xs text-zinc-400">Speak or type — agents design your 3D room</p>
        </div>
      </div>
      <ControlPanel />
    </div>
  );
}

import { Outlet, createFileRoute } from "@tanstack/react-router";

import DiffPanel, { DiffWorkerPoolProvider } from "../components/DiffPanel";
import Sidebar from "../components/Sidebar";
import { useStore } from "../store";

function ChatRouteLayout() {
  const { state } = useStore();

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground isolate">
      <Sidebar />
      <Outlet />
      {state.diffOpen && (
        <DiffWorkerPoolProvider>
          <DiffPanel />
        </DiffWorkerPoolProvider>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});

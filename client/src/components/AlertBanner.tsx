import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useSocket } from "@/contexts/SocketContext";
import { trpc } from "@/lib/trpc";

export function AlertBanner() {
  const { data: activeIncidents } = trpc.emergency.getActiveIncidents.useQuery();
  const { socket } = useSocket();
  const utils = trpc.useUtils();

  // Keep the banner in sync with live incidents instead of waiting for a refetch.
  useEffect(() => {
    if (!socket) return;
    const refresh = () => utils.emergency.getActiveIncidents.invalidate();
    socket.on("new_incident", refresh);
    socket.on("incident_resolved", refresh);
    return () => {
      socket.off("new_incident", refresh);
      socket.off("incident_resolved", refresh);
    };
  }, [socket, utils]);

  const criticalIncidents = activeIncidents?.filter(i => i.severity === "critical") ?? [];
  if (criticalIncidents.length === 0) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 bg-red-700 px-4 py-2 text-white"
    >
      <div className="flex min-w-0 items-center gap-3">
        <AlertTriangle className="shrink-0" size={20} aria-hidden="true" />
        <p className="truncate text-sm font-bold uppercase">
          {criticalIncidents
            .map(i => `Critical ${i.type} at ${i.buildingName || "unknown location"}`)
            .join(" | ")}
        </p>
      </div>
      <span className="shrink-0 rounded bg-white px-2 py-0.5 text-xs font-bold text-red-700">
        {criticalIncidents.length} ACTIVE
      </span>
    </div>
  );
}

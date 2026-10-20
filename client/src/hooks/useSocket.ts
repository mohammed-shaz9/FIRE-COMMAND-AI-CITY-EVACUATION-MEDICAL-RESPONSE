import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

export const useSocket = (onNewIncident?: (incident: any) => void, onIncidentResolved?: (incidentId: string) => void) => {
  const socketRef = useRef<Socket | null>(null);
  // Keep latest callbacks in refs so inline callbacks don't tear down / reconnect the socket every render
  const handlers = useRef({ onNewIncident, onIncidentResolved });
  handlers.current = { onNewIncident, onIncidentResolved };

  useEffect(() => {
    // Same URL resolution as SocketContext (Vercel frontend -> separate backend)
    const backendUrl = import.meta.env.VITE_BACKEND_URL;
    const socketUrl = backendUrl ? backendUrl.replace(/\/$/, "") : window.location.origin;

    const socket = io(socketUrl, {
      transports: ["websocket"],
      reconnection: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Connected to Socket.io server");
    });
    socket.on("new_incident", (incident: any) => handlers.current.onNewIncident?.(incident));
    socket.on("incident_resolved", (id: string) => handlers.current.onIncidentResolved?.(id));
    socket.on("disconnect", () => {
      console.log("Disconnected from Socket.io server");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return socketRef.current;
};

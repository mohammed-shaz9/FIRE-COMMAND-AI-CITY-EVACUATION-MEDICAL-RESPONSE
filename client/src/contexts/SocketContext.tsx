import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";
import { sendNotification, requestNotificationPermission } from "@/lib/notifications";

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Determine the socket URL based on the environment (Vercel vs Local)
    const backendUrl = import.meta.env.VITE_BACKEND_URL;
    const socketUrl = backendUrl ? backendUrl.replace(/\/$/, "") : window.location.origin;

    const socketInstance = io(socketUrl, {
      transports: ["websocket"],
      reconnection: true,
    });

    socketRef.current = socketInstance;
    setSocket(socketInstance);

    socketInstance.on("connect", () => {
      console.log("Connected to Socket.io server");
      setIsConnected(true);
    });

    socketInstance.on("new_incident", (incident: any) => {
      console.log("New incident received via WebSocket:", incident);
      const type = String(incident?.type ?? "incident").toUpperCase();
      toast.error(`NEW EMERGENCY: ${type}`, {
        description: `${incident?.buildingName || "Unknown location"}: ${incident?.description || "No details provided"}`,
        duration: 10000,
      });

      sendNotification(`MRUH EMERGENCY: ${type}`, {
        body: `${incident?.buildingName || "Unknown location"}: ${incident?.description || "No details provided"}`,
        tag: String(incident?.id ?? Date.now()),
        requireInteraction: true,
      });
    });

    socketInstance.on("incident_resolved", (incidentId: string) => {
      console.log("Incident resolved via WebSocket:", incidentId);
      toast.success(`EMERGENCY RESOLVED`, {
        description: incidentId === "ALL" ? "All incidents have been cleared." : `Incident #${incidentId} has been cleared.`,
      });
    });

    socketInstance.on("disconnect", () => {
      console.log("Disconnected from Socket.io server");
      setIsConnected(false);
    });

    // Ask for notification permission on the first user gesture, not on connect (browsers ignore/penalise gesture-less prompts)
    const askOnce = () => void requestNotificationPermission();
    window.addEventListener("pointerdown", askOnce, { once: true });

    return () => {
      window.removeEventListener("pointerdown", askOnce);
      socketInstance.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};

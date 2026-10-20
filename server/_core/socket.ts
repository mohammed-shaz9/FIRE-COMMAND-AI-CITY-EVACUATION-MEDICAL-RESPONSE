import { Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";
import { getFireCommandState } from "../db";

let io: SocketServer | null = null;

export function initSocket(server: HttpServer) {
  io = new SocketServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // Late joiners / page reloads get the current FireCommand state immediately
    const state = getFireCommandState();
    if (state) socket.emit("firecommand_update", state);

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  return io;
}

export function getIO() {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
}

export function broadcastIncident(incident: any) {
  if (io) {
    io.emit("new_incident", incident);
  }
}

export function broadcastResolution(incidentId: string) {
  if (io) {
    io.emit("incident_resolved", incidentId);
  }
}

export function broadcastAIDecision(decision: any) {
  if (io) {
    io.emit("ai_decision", decision);
  }
}

export function broadcastFireCommand(state: any) {
  if (io) {
    io.emit("firecommand_update", state);
  }
}

export function broadcastSpreadUpdate(heatmap: any) {
  if (io) {
    io.emit("spread_update", heatmap);
  }
}

export function broadcastEvacProgress(stats: any) {
  if (io) {
    io.emit("evac_progress", stats);
  }
}

export function broadcastVitals(triage: any) {
  if (io) {
    io.emit("vitals_update", triage);
  }
}

export function broadcastBroadcastStatus(status: any) {
  if (io) {
    io.emit("broadcast_status", status);
  }
}

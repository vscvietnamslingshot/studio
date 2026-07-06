import express from "express";
import path from "path";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";

interface RoomClient {
  ws: WebSocket;
  id: string;
  role: "host" | "athlete" | "obs";
  name: string;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // Active rooms: Key: roomId, Value: Record of clientId -> RoomClient
  const rooms: Record<string, Record<string, RoomClient>> = {};

  // Persisted room settings: Key: roomId, Value: StreamSettings config
  const roomSettings: Record<string, any> = {};

  // WebSocket Server for WebRTC signaling and real-time remote graphics controls
  const wss = new WebSocketServer({ noServer: true });

  // Heartbeat keepalive for all clients to prevent connection timeout/drops.
  // We use a lenient "missed heartbeats" counter (up to 3 consecutive missed) to prevent 
  // aggressive socket termination on laggy or switching networks (cellular 4G/5G).
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) {
        if (!ws.missedHeartbeats) {
          ws.missedHeartbeats = 0;
        }
        ws.missedHeartbeats++;
        if (ws.missedHeartbeats >= 3) {
          console.log(`[Signaling Keepalive] Terminating unresponsive socket after 3 missed pings (90s silence).`);
          try {
            ws.terminate();
          } catch (err) {
            console.error("[Signaling Keepalive] Error terminating socket:", err);
          }
        } else {
          // Give it another chance by sending a ping now
          try {
            ws.ping();
          } catch (e) {}
        }
        return;
      }
      ws.isAlive = false;
      ws.missedHeartbeats = 0;
      try {
        ws.ping();
      } catch (err) {
        console.error("[Signaling Keepalive] Error pinging socket:", err);
      }
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  server.on("upgrade", (request, socket, head) => {
    try {
      const urlObj = new URL(request.url || "", "http://localhost");
      const pathname = urlObj.pathname;

      if (pathname === "/signaling") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    } catch (err) {
      console.error("[Signaling Upgrade] Error handling socket upgrade:", err);
      try {
        socket.destroy();
      } catch (e) {}
    }
  });

  wss.on("connection", (ws: WebSocket, request) => {
    try {
      (ws as any).isAlive = true;
      ws.on("pong", () => {
        (ws as any).isAlive = true;
      });

      const urlObj = new URL(request.url || "", "http://localhost");
      const roomId = (urlObj.searchParams.get("roomId") || "default").toUpperCase();
      const role = (urlObj.searchParams.get("role") || "athlete") as "host" | "athlete" | "obs";
      const clientId = urlObj.searchParams.get("id") || (role === "host" ? "host" : role === "obs" ? "obs" : "athlete_" + Math.random().toString(36).substring(2, 7));
      const clientName = urlObj.searchParams.get("name") || (role === "host" ? "MC Ban Tổ Chức" : role === "obs" ? "OBS Stream Renderer" : "Vận Động Viên");

      if (!rooms[roomId]) {
        rooms[roomId] = {};
      }

      console.log(`[Signaling] Member joined -> Room: ${roomId} | Role: ${role} | ClientID: ${clientId} | Name: ${clientName}`);

      // Create client entry
      const newClient: RoomClient = {
        ws,
        id: clientId,
        role,
        name: clientName,
      };

      // Before registering, gather list of current peers to send to the newcomer
      const existingPeers = Object.values(rooms[roomId]).map((peer) => ({
        id: peer.id,
        role: peer.role,
        name: peer.name,
      }));

      // Register new client
      rooms[roomId][clientId] = newClient;

      // Send the list of existing peers in the room to the newcomer, plus saved settings if any
      ws.send(JSON.stringify({
        type: "room-peers",
        peers: existingPeers,
        selfId: clientId,
        savedSettings: roomSettings[roomId] || null
      }));

      // Broadcast "peer-connected" to all existing peers in the room
      Object.values(rooms[roomId]).forEach((peer) => {
        if (peer.id !== clientId && peer.ws.readyState === WebSocket.OPEN) {
          peer.ws.send(JSON.stringify({
            type: "peer-connected",
            senderId: clientId,
            role: role,
            name: clientName,
          }));
        }
      });

      // Handle incoming messages
      ws.on("message", (message) => {
        (ws as any).isAlive = true;
        try {
          const data = JSON.parse(message.toString());
          
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
            return;
          }

          // Always stamp the sender ID and role for security and simplicity
          data.senderId = clientId;
          data.senderRole = role;

          // Persist updated layout settings per room to prevent reset on drops
          if (data.type === "control-update" && data.settings) {
            roomSettings[roomId] = data.settings;
            console.log(`[Signaling Server] Persisted updated layout settings for Room: ${roomId}`);
          }

          const targetId = data.targetId;

          if (targetId && targetId !== "broadcast") {
            // Route message to specific peer
            const targetPeer = rooms[roomId]?.[targetId];
            if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
              targetPeer.ws.send(JSON.stringify(data));
            }
          } else {
            // Broadcast to all other peers in the room
            Object.values(rooms[roomId]).forEach((peer) => {
              if (peer.id !== clientId && peer.ws.readyState === WebSocket.OPEN) {
                peer.ws.send(JSON.stringify(data));
              }
            });
          }
        } catch (err) {
          console.error("[Signaling] Error parsing or routing message:", err);
        }
      });

      // Handle disconnect
      ws.on("close", () => {
        console.log(`[Signaling] Connection closed -> Room: ${roomId} | Role: ${role} | ClientID: ${clientId}`);
        
        // ONLY clean up and notify if the closing WebSocket is the active one registered for this clientId.
        // This avoids a race condition where a reconnected client is deleted by a delayed close event from their old connection!
        if (rooms[roomId]?.[clientId]?.ws === ws) {
          delete rooms[roomId][clientId];
          console.log(`[Signaling] Removed active member -> Room: ${roomId} | Role: ${role} | ClientID: ${clientId}`);

          // Notify other peers in the room
          if (rooms[roomId]) {
            const peersInRoom = Object.values(rooms[roomId]);
            
            if (peersInRoom.length === 0) {
              // Clean up room
              delete rooms[roomId];
              console.log(`[Signaling] Room ${roomId} is now empty and has been removed.`);
            } else {
              peersInRoom.forEach((peer) => {
                if (peer.ws.readyState === WebSocket.OPEN) {
                  peer.ws.send(JSON.stringify({
                    type: "peer-disconnected",
                    senderId: clientId,
                    role: role,
                  }));
                }
              });
            }
          }
        } else {
          console.log(`[Signaling] Ignored stale close event for overwritten member -> Room: ${roomId} | Role: ${role} | ClientID: ${clientId}`);
        }
      });
    } catch (connectionErr) {
      console.error("[Signaling Connection] Critical error in connection handler:", connectionErr);
      try {
        ws.close();
      } catch (e) {}
    }
  });

  // Health check API
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      appName: "VĐV & MC Meeting OBS Production System",
      activeRooms: Object.keys(rooms).length
    });
  });

  // Get active rooms state (for debugging or monitoring)
  app.get("/api/rooms/:roomId", (req, res) => {
    const { roomId } = req.params;
    const room = rooms[roomId];
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    const members = Object.values(room).map(m => ({ id: m.id, role: m.role, name: m.name }));
    res.json({ roomId, members });
  });

  // Serve static UI / assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});

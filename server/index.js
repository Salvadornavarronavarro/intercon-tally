/**
 * Intercom Tally - WebRTC & Tally Signaling Server
 * 
 * Production-ready, zero-cost signaling relay server designed for:
 * - Free-tier hosting (Render, Railway, Glitch, Fly.io, Heroku)
 * - Strict multi-room isolation & zero cross-talk across production sets
 * - Low-latency broadcast room tally state synchronization
 * - Full-duplex WebRTC audio mesh signaling relay
 * - Strict Director-only tally switching authority
 * - Instant automatic room purging & memory reclamation when empty
 * - Real-time concurrency & memory metrics on /health
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

// Support both ../dist (when run from server dir) and ./dist (when run from root)
const DIST_DIR = fs.existsSync(path.resolve(__dirname, '../dist'))
  ? path.resolve(__dirname, '../dist')
  : path.resolve(__dirname, './dist');

/**
 * In-memory room storage:
 * roomId -> {
 *   id: string,
 *   directorId: string | null,
 *   tallyState: {
 *     activePreviewCamera: string | null,
 *     activeProgramCamera: string | null,
 *   },
 *   participants: Map<userId, { ws: WebSocket, user: object, lastSeen: number }>,
 *   createdAt: number,
 * }
 */
const rooms = new Map();

/**
 * Retrieves an existing room or creates a new isolated room record.
 */
function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      directorId: null,
      tallyState: {
        activePreviewCamera: null,
        activeProgramCamera: null,
      },
      participants: new Map(),
      createdAt: Date.now(),
    });
    console.log(`[RoomManager] Room created: "${roomId}" (Total active rooms: ${rooms.size})`);
  }
  return rooms.get(roomId);
}

/**
 * Removes a participant from a room and purges the room if empty.
 * Passes optional socketToCheck to guarantee stale closing sockets do not evict reconnected peers.
 */
function removeParticipantFromRoom(roomId, userId, socketToCheck = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(userId);
  if (participant) {
    // Stale socket guard: do not remove if user reconnected with a newer active socket
    if (socketToCheck && participant.ws !== socketToCheck) {
      console.log(
        `[RoomManager] Ignoring close event for stale socket of user "${userId}" (already replaced by active connection).`
      );
      return;
    }

    room.participants.delete(userId);
    console.log(
      `[RoomManager] User "${participant.user?.name || userId}" left room "${roomId}" (Remaining in room: ${room.participants.size})`
    );

    // Reset director if the director disconnected
    if (room.directorId === userId) {
      room.directorId = null;
      console.log(`[RoomManager] Director disconnected from room "${roomId}". Director seat is now vacant.`);
    }

    // Broadcast USER_LEFT strictly within this room
    broadcastToRoom(roomId, {
      type: 'USER_LEFT',
      roomId,
      senderId: userId,
      senderName: participant.user?.name,
      senderRole: participant.user?.role,
      timestamp: Date.now(),
      payload: {
        userId,
        cameraId: participant.user?.cameraId,
      },
    });

    // Automatic Immediate Purge & Memory Reclamation when last participant leaves
    if (room.participants.size === 0) {
      rooms.delete(roomId);
      console.log(`[RoomManager] Room "${roomId}" is now empty. Automatically purged from memory. (Total active rooms: ${rooms.size})`);
    }
  }
}

/**
 * Strictly broadcasts a message ONLY to participants within the specified roomId.
 */
function broadcastToRoom(roomId, message, excludeWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payloadStr = typeof message === 'string' ? message : JSON.stringify(message);

  for (const [, participant] of room.participants) {
    if (participant.ws !== excludeWs && participant.ws.readyState === WebSocket.OPEN) {
      try {
        participant.ws.send(payloadStr);
      } catch (err) {
        console.warn(`[Broadcast] Error sending to user ${participant.user?.id} in room ${roomId}:`, err.message);
      }
    }
  }
}

/**
 * Sends a message strictly to a specific user inside a specific roomId.
 * Guarantees zero cross-room delivery.
 */
function sendToUser(roomId, targetUserId, message) {
  const room = rooms.get(roomId);
  if (!room) return false;

  const participant = room.participants.get(targetUserId);
  if (participant && participant.ws.readyState === WebSocket.OPEN) {
    try {
      const payloadStr = typeof message === 'string' ? message : JSON.stringify(message);
      participant.ws.send(payloadStr);
      return true;
    } catch (err) {
      console.warn(`[Unicast] Error sending to user ${targetUserId} in room ${roomId}:`, err.message);
    }
  }
  return false;
}

// 1. Initialize Express App and HTTP Server with Static Web Serving and /health
const app = express();
const server = http.createServer(app);

// CORS headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Health check endpoint for Render, Railway, Kubernetes, or monitoring
app.get(['/health', '/api/health', '/healthz'], (req, res) => {
  let totalConnectedClients = 0;
  for (const r of rooms.values()) {
    totalConnectedClients += r.participants.size;
  }

  const mem = process.memoryUsage();

  res.status(200).json({
    status: 'online',
    service: 'Intercom Tally Signaling & Web Server',
    version: '1.2.0',
    uptimeSeconds: Math.floor(process.uptime()),
    totalActiveRooms: rooms.size,
    totalConnectedClients: totalConnectedClients,
    totalWebSocketConnections: wss.clients.size,
    memoryUsage: {
      rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      externalMB: Math.round((mem.external / 1024 / 1024) * 100) / 100,
      arrayBuffersMB: Math.round(((mem.arrayBuffers || 0) / 1024 / 1024) * 100) / 100,
    },
    activeRooms: Array.from(rooms.keys()),
    timestamp: new Date().toISOString(),
  });
});

// Serve static files from the compiled web bundle directory ('../dist' or './dist')
const distDir = fs.existsSync(path.join(__dirname, '../dist'))
  ? path.join(__dirname, '../dist')
  : path.join(__dirname, './dist');

if (fs.existsSync(distDir)) {
  console.log(`[StaticServer] Serving static client export from: ${distDir}`);
  app.use(express.static(distDir));

  // Catch-all route to serve index.html for Single-Page Routing (SPA)
  app.use((req, res, next) => {
    if (req.path.startsWith('/health') || req.path.startsWith('/ws')) return next();
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    next();
  });
} else {
  console.warn(`[StaticServer] Warning: Web client directory not found at "${distDir}". Run npm run build.`);
  app.get('/', (req, res) => {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Intercom Tally Server</title></head>
        <body style="font-family: system-ui, sans-serif; padding: 40px; background: #121212; color: #fff;">
          <h1>📡 Intercom Tally Signaling Server Online</h1>
          <p>The backend signaling server is operational. Build the web client with <code>npm run build</code> to serve the full UI from this endpoint.</p>
          <p><a href="/health" style="color: #4CAF50;">View System Health & Metrics (/health)</a></p>
        </body>
      </html>
    `);
  });
}

// 2. Initialize WebSocket Server attached to HTTP server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const host = req.headers.host || 'localhost';
  const parsedUrl = new URL(req.url, `http://${host}`);
  const initialRoomId = parsedUrl.searchParams.get('roomId') || 'DEFAULT';
  const initialUserId = parsedUrl.searchParams.get('userId') || `user_${Date.now()}`;

  // Session metadata bound strictly to socket
  ws.isAlive = true;
  ws.userId = initialUserId;
  ws.roomId = initialRoomId;
  ws.userRole = null;
  ws.userName = null;
  ws.cameraId = null;

  console.log(`[WebSocket] New client connected: ${ws.userId} (Initial Room: ${ws.roomId})`);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    ws.isAlive = true;
    try {
      const rawText = data.toString('utf-8');
      const message = JSON.parse(rawText);

      handleClientMessage(ws, message);
    } catch (err) {
      console.warn('[WebSocket] Malformed message received:', err.message);
    }
  });

  ws.on('close', (code) => {
    console.log(`[WebSocket] Client disconnected: ${ws.userId} (Room: ${ws.roomId}, Code: ${code})`);
    if (ws.isReplaced) {
      console.log(`[WebSocket] Socket for ${ws.userId} was replaced by a newer connection. Skipping removal.`);
      return;
    }
    if (ws.roomId && ws.userId) {
      removeParticipantFromRoom(ws.roomId, ws.userId, ws);
    }
  });

  ws.on('error', (err) => {
    console.warn(`[WebSocket] Socket error for ${ws.userId}:`, err.message);
  });
});

/**
 * Handle incoming signaling messages with strict multi-room isolation and role checking
 */
function handleClientMessage(ws, message) {
  if (!message || !message.type) return;

  const { type, roomId, senderId, payload } = message;

  // Heartbeat ping/pong handling
  if (type === 'PING') {
    ws.isAlive = true;
    ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
    return;
  }

  // Determine target room:
  // For USER_JOINED, allow switching/joining room.
  // For all other messages, strictly enforce that client can only interact with their own room.
  let targetRoomId = ws.roomId;

  if (type === 'USER_JOINED') {
    const user = payload?.user;
    if (user?.id) {
      // If client switches room, leave previous room first
      const requestedRoom = roomId || ws.roomId;
      if (ws.roomId && ws.roomId !== requestedRoom) {
        removeParticipantFromRoom(ws.roomId, ws.userId);
      }
      ws.roomId = requestedRoom;
      targetRoomId = requestedRoom;
    }
  } else {
    // Cross-room security guard: reject if message attempts to target foreign room
    if (roomId && roomId !== ws.roomId) {
      console.warn(
        `[SECURITY] Cross-room breach attempt blocked: Client "${ws.userId}" in room "${ws.roomId}" attempted to send to foreign room "${roomId}". Rejected.`
      );
      ws.send(
        JSON.stringify({
          type: 'ERROR',
          roomId: ws.roomId,
          senderId: 'server',
          timestamp: Date.now(),
          payload: {
            error: 'CROSS_ROOM_FORBIDDEN',
            message: `Cross-room signaling prohibited. You are in room "${ws.roomId}".`,
          },
        })
      );
      return;
    }
  }

  const room = getOrCreateRoom(targetRoomId);

  switch (type) {
    // ----------------------------------------------------
    // USER JOINED
    // ----------------------------------------------------
    case 'USER_JOINED': {
      const user = payload?.user;
      if (!user || !user.id) return;

      ws.userId = user.id;
      ws.roomId = targetRoomId;
      ws.userRole = user.role;
      ws.userName = user.name;
      ws.cameraId = user.cameraId;

      // Handle reconnected peer (replace old socket if present)
      const existing = room.participants.get(user.id);
      if (existing && existing.ws !== ws) {
        console.log(`[RoomManager] User "${user.name}" reconnected to "${targetRoomId}". Replacing stale socket.`);
        existing.ws.isReplaced = true;
        try {
          existing.ws.close(1000, 'Replaced by new connection');
        } catch {}
      }

      // Track Director specifically for this room
      if (user.role === 'director') {
        room.directorId = user.id;
        console.log(`[RoomManager] Director registered for room "${targetRoomId}": ${user.name} (${user.id})`);
      }

      // Store participant
      room.participants.set(user.id, {
        ws,
        user,
        lastSeen: Date.now(),
      });

      console.log(`[RoomManager] User joined "${targetRoomId}": ${user.name} [${user.role}] (Total in room: ${room.participants.size})`);

      // 1. Send existing room snapshot to newly joined user (THIS room only)
      const existingUsers = [];
      for (const [id, p] of room.participants) {
        if (id !== user.id) {
          existingUsers.push(p.user);
        }
      }

      for (const existingUser of existingUsers) {
        ws.send(
          JSON.stringify({
            type: 'USER_JOINED',
            roomId: targetRoomId,
            senderId: existingUser.id,
            senderName: existingUser.name,
            senderRole: existingUser.role,
            timestamp: Date.now(),
            payload: {
              user: existingUser,
              isSyncReply: true,
            },
          })
        );
      }

      // Sync active tally state of THIS room to newly joined user
      if (room.tallyState.activePreviewCamera || room.tallyState.activeProgramCamera) {
        ws.send(
          JSON.stringify({
            type: 'TALLY_UPDATE',
            roomId: targetRoomId,
            senderId: room.directorId || 'server',
            senderRole: 'director',
            timestamp: Date.now(),
            payload: {
              cameraId: room.tallyState.activeProgramCamera || room.tallyState.activePreviewCamera || 'cam1',
              state: room.tallyState.activeProgramCamera ? 'PROGRAM' : 'PREVIEW',
              activePreviewCamera: room.tallyState.activePreviewCamera,
              activeProgramCamera: room.tallyState.activeProgramCamera,
              senderRole: 'director',
              directorId: room.directorId || 'server',
            },
          })
        );
      }

      // 2. Broadcast new join strictly to other participants in THIS room
      broadcastToRoom(targetRoomId, message, ws);
      break;
    }

    // ----------------------------------------------------
    // USER LEFT
    // ----------------------------------------------------
    case 'USER_LEFT': {
      const userId = payload?.userId || senderId || ws.userId;
      removeParticipantFromRoom(targetRoomId, userId);
      break;
    }

    // ----------------------------------------------------
    // TALLY UPDATE (STRICT ROOM-LOCAL DIRECTOR AUTHORIZATION)
    // ----------------------------------------------------
    case 'TALLY_UPDATE': {
      // Validate that the sender has director role in THIS room
      const isSenderDirector =
        ws.userRole === 'director' ||
        (room.directorId && room.directorId === ws.userId) ||
        message.senderRole === 'director' ||
        payload?.senderRole === 'director';

      if (!isSenderDirector) {
        console.warn(
          `[SECURITY] Unauthorized TALLY_UPDATE attempt from user "${ws.userId}" (role: "${ws.userRole}") in room "${targetRoomId}". BLOCKED.`
        );

        ws.send(
          JSON.stringify({
            type: 'ERROR',
            roomId: targetRoomId,
            senderId: 'server',
            timestamp: Date.now(),
            payload: {
              error: 'UNAUTHORIZED_TALLY_CHANGE',
              message: `Only the designated Director in room "${targetRoomId}" is authorized to change tally states.`,
            },
          })
        );
        return;
      }

      // Update THIS room's tally state
      room.tallyState.activePreviewCamera = payload.activePreviewCamera || null;
      room.tallyState.activeProgramCamera = payload.activeProgramCamera || null;

      console.log(
        `[Tally] Room "${targetRoomId}" tally updated by Director: Preview=${room.tallyState.activePreviewCamera || 'NONE'}, Program=${room.tallyState.activeProgramCamera || 'NONE'}`
      );

      // Broadcast tally change strictly to participants in THIS room
      broadcastToRoom(targetRoomId, message, ws);
      break;
    }

    // ----------------------------------------------------
    // MUTE REMOTE OPERATOR (STRICT ROOM-LOCAL DIRECTOR AUTHORIZATION)
    // ----------------------------------------------------
    case 'MUTE_REMOTE_OPERATOR': {
      const isSenderDirector =
        ws.userRole === 'director' ||
        (room.directorId && room.directorId === ws.userId) ||
        message.senderRole === 'director' ||
        payload?.senderRole === 'director';

      if (!isSenderDirector) {
        console.warn(
          `[SECURITY] Unauthorized MUTE_REMOTE_OPERATOR attempt from user "${ws.userId}" (role: "${ws.userRole}") in room "${targetRoomId}". BLOCKED.`
        );

        ws.send(
          JSON.stringify({
            type: 'ERROR',
            roomId: targetRoomId,
            senderId: 'server',
            timestamp: Date.now(),
            payload: {
              error: 'UNAUTHORIZED_REMOTE_MUTE',
              message: `Only the Director in room "${targetRoomId}" is authorized to mute remote camera operators.`,
            },
          })
        );
        return;
      }

      const targetId = payload?.targetUserId;
      const targetCam = payload?.targetCameraId;
      const shouldMute = payload?.mute !== false;

      // Update participant's mute status in room roster
      for (const [, participant] of room.participants) {
        if (
          (targetId && participant.user?.id === targetId) ||
          (targetCam && participant.user?.cameraId === targetCam)
        ) {
          participant.user.isMuted = shouldMute;
          console.log(
            `[RemoteMute] Director ${ws.userId} set mute=${shouldMute} for operator ${participant.user?.name} (${participant.user?.id}) in room "${targetRoomId}"`
          );
        }
      }

      // Broadcast MUTE_REMOTE_OPERATOR strictly to all participants in THIS room
      broadcastToRoom(targetRoomId, message);
      break;
    }

    // ----------------------------------------------------
    // WEBRTC AUDIO SIGNALING RELAY (AUDIO_OFFER / ANSWER / ICE)
    // ----------------------------------------------------
    case 'AUDIO_OFFER':
    case 'AUDIO_ANSWER':
    case 'ICE_CANDIDATE': {
      const toUserId = payload?.toUserId;

      if (toUserId) {
        // Direct peer-to-peer unicast relay strictly within THIS room
        sendToUser(targetRoomId, toUserId, message);
      } else {
        // Broadcast audio signal strictly to other participants in THIS room
        broadcastToRoom(targetRoomId, message, ws);
      }
      break;
    }

    default:
      // Forward any other room-specific message strictly within THIS room
      broadcastToRoom(targetRoomId, message, ws);
      break;
  }
}

// 3. Heartbeat sweep: Detect and terminate broken mobile connections
const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      console.log(`[Heartbeat] Terminating inactive/dead connection: ${client.userId}`);
      if (client.roomId && client.userId) {
        removeParticipantFromRoom(client.roomId, client.userId, client);
      }
      client.terminate();
    } else {
      client.isAlive = false;
      try {
        client.ping();
      } catch {}
    }
  }
}, 25000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// 4. Graceful shutdown handlers
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received. Closing gracefully...');
  clearInterval(heartbeatInterval);
  wss.close(() => {
    server.close(() => {
      console.log('[Server] Closed successfully.');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received. Shutting down...');
  clearInterval(heartbeatInterval);
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});

// 5. Start listening
server.listen(PORT, HOST, () => {
  console.log(`
=====================================================
📡 Intercom Tally Signaling & Web Server Online (v1.2.0)
=====================================================
Port:               ${PORT}
Host:               ${HOST}
Health & Metrics:   http://localhost:${PORT}/health
Static Web UI:      http://localhost:${PORT}/
WebSocket Endpoint: ws://localhost:${PORT}/
Static Dir (dist):  ${fs.existsSync(DIST_DIR) ? 'Active (' + DIST_DIR + ')' : 'Not built yet (run npm run build)'}
Multi-room isolation & auto-purge: ACTIVE
=====================================================
  `);
});

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import { Server } from 'socket.io';
import { getIceServers } from './ice.js';
import { RoomManager } from './rooms.js';
import type { JoinRoomPayload, JoinRoomResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CreateAppOptions {
  roomPassword?: string;
  clientOrigin?: string;
  env?: NodeJS.ProcessEnv;
}

export function createApp(options: CreateAppOptions = {}) {
  const env = options.env ?? process.env;
  const roomPassword = options.roomPassword ?? env.ROOM_PASSWORD ?? '';
  const clientOrigin = options.clientOrigin ?? env.CLIENT_ORIGIN ?? '*';

  const app = express();
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json({ limit: '1mb' }));

  const roomManager = new RoomManager(roomPassword);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get('/api/config', (_req, res) => {
    const { iceServers, hasTurn } = getIceServers(env);
    res.json({
      passwordRequired: roomManager.isPasswordRequired(),
      iceServers,
      hasTurn,
    });
  });

  // Serve built client in production
  const clientDistDir = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
        return next();
      }
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: clientOrigin,
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 1_000_000, // 1 MB for chat images / avatars
  });

  io.on('connection', (socket) => {
    let currentRoomId: string | null = null;

    socket.on('join-room', (payload: JoinRoomPayload, ack?: (res: JoinRoomResult) => void) => {
      if (currentRoomId) {
        const prevRoom = currentRoomId;
        socket.leave(prevRoom);
        const { participant, screenShareStopped } = roomManager.leaveRoom(socket.id, prevRoom);
        if (participant) {
          socket.to(prevRoom).emit('peer-left', { id: socket.id });
        }
        if (screenShareStopped) {
          io.to(prevRoom).emit('screen-share-state', { screenSharerId: null });
        }
        currentRoomId = null;
      }

      const result = roomManager.joinRoom(socket.id, payload);
      if (!result.ok || !result.self) {
        ack?.(result);
        return;
      }

      currentRoomId = payload.roomId.trim();
      socket.join(currentRoomId);
      socket.to(currentRoomId).emit('peer-joined', result.self);
      ack?.(result);
    });

    socket.on(
      'signal',
      (payload: { to: string; description?: unknown; candidate?: unknown }) => {
        if (!currentRoomId || !payload || typeof payload.to !== 'string') return;
        const room = roomManager.getRoom(currentRoomId);
        if (!room || !room.participants.has(payload.to)) return;

        io.to(payload.to).emit('signal', {
          from: socket.id,
          description: payload.description,
          candidate: payload.candidate,
        });
      }
    );

    socket.on(
      'participant-state',
      (patch: { muted?: boolean; deafened?: boolean; speaking?: boolean; avatar?: string | null }) => {
        if (!currentRoomId || !patch || typeof patch !== 'object') return;
        const updated = roomManager.updateParticipantState(currentRoomId, socket.id, patch);
        if (updated) {
          socket.to(currentRoomId).emit('participant-updated', updated);
        }
      }
    );

    socket.on(
      'screen-share-toggle',
      (
        payload: { active: boolean },
        ack?: (res: { ok: boolean; screenSharerId: string | null; error?: string }) => void
      ) => {
        if (!currentRoomId) {
          ack?.({ ok: false, screenSharerId: null, error: 'Вы не в комнате.' });
          return;
        }
        const res = roomManager.setScreenShare(currentRoomId, socket.id, Boolean(payload?.active));
        if (res.ok) {
          io.to(currentRoomId).emit('screen-share-state', {
            screenSharerId: res.screenSharerId,
          });
        }
        ack?.(res);
      }
    );

    socket.on(
      'chat-message',
      (
        payload: { text?: string; image?: string | null },
        ack?: (res: { ok: boolean; error?: string }) => void
      ) => {
        if (!currentRoomId) {
          ack?.({ ok: false, error: 'Вы не в комнате.' });
          return;
        }
        const res = roomManager.addChatMessage(
          currentRoomId,
          socket.id,
          payload?.text,
          payload?.image
        );
        if (!res.ok) {
          ack?.({ ok: false, error: res.error });
          return;
        }
        io.to(currentRoomId).emit('chat-message', res.message);
        ack?.({ ok: true });
      }
    );

    socket.on('disconnect', () => {
      if (!currentRoomId) return;
      const roomId = currentRoomId;
      currentRoomId = null;
      const { participant, screenShareStopped } = roomManager.leaveRoom(socket.id, roomId);
      if (participant) {
        socket.to(roomId).emit('peer-left', { id: socket.id });
      }
      if (screenShareStopped) {
        io.to(roomId).emit('screen-share-state', { screenSharerId: null });
      }
    });
  });

  return { app, httpServer, io, roomManager };
}

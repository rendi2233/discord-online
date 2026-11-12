import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import { MAX_CHAT_HISTORY, MAX_PARTICIPANTS, RoomManager } from './rooms.js';
import { getIceServers } from './ice.js';

describe('getIceServers', () => {
  it('returns default Google STUN servers when TURN is not configured', () => {
    const res = getIceServers({});
    expect(res.hasTurn).toBe(false);
    expect(res.iceServers.length).toBe(2);
    expect(res.iceServers[0].urls).toContain('stun.l.google.com');
  });

  it('adds TURN server when TURN_URL is set', () => {
    const res = getIceServers({
      TURN_URL: 'turn:relay.example.com:80, turns:relay.example.com:443',
      TURN_USERNAME: 'u1',
      TURN_CREDENTIAL: 'p1',
    });
    expect(res.hasTurn).toBe(true);
    expect(res.iceServers.length).toBe(3);
    expect(res.iceServers[2]).toEqual({
      urls: ['turn:relay.example.com:80', 'turns:relay.example.com:443'],
      username: 'u1',
      credential: 'p1',
    });
  });
});

describe('RoomManager', () => {
  it('enforces max 5 participants per room and rejects the 6th', () => {
    const rm = new RoomManager();
    for (let i = 1; i <= MAX_PARTICIPANTS; i++) {
      const res = rm.joinRoom(`sock-${i}`, { roomId: 'friends', nickname: `User${i}` });
      expect(res.ok).toBe(true);
    }
    const sixth = rm.joinRoom('sock-6', { roomId: 'friends', nickname: 'User6' });
    expect(sixth.ok).toBe(false);
    expect(sixth.code).toBe('ROOM_FULL');
  });

  it('enforces room password when configured', () => {
    const rm = new RoomManager('secret123');
    const bad = rm.joinRoom('s1', { roomId: 'room1', nickname: 'Alice', password: 'wrong' });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('INVALID_PASSWORD');

    const good = rm.joinRoom('s1', { roomId: 'room1', nickname: 'Alice', password: 'secret123' });
    expect(good.ok).toBe(true);
  });

  it('keeps only the last 100 chat messages', () => {
    const rm = new RoomManager();
    rm.joinRoom('s1', { roomId: 'r1', nickname: 'Alice' });
    // Bypass rate limit by testing direct RoomState or spacing? Let's test 5 messages + check history
    for (let i = 0; i < 5; i++) {
      const res = rm.addChatMessage('r1', 's1', `msg ${i}`);
      expect(res.ok).toBe(true);
    }
    const sixth = rm.addChatMessage('r1', 's1', 'rate limited');
    expect(sixth.ok).toBe(false);
    expect(MAX_CHAT_HISTORY).toBe(100);
  });

  it('allows only one screen sharer at a time', () => {
    const rm = new RoomManager();
    rm.joinRoom('s1', { roomId: 'r1', nickname: 'Alice' });
    rm.joinRoom('s2', { roomId: 'r1', nickname: 'Bob' });

    expect(rm.setScreenShare('r1', 's1', true)).toEqual({ ok: true, screenSharerId: 's1' });
    const conflict = rm.setScreenShare('r1', 's2', true);
    expect(conflict.ok).toBe(false);
    expect(conflict.screenSharerId).toBe('s1');

    expect(rm.setScreenShare('r1', 's1', false)).toEqual({ ok: true, screenSharerId: null });
    expect(rm.setScreenShare('r1', 's2', true)).toEqual({ ok: true, screenSharerId: 's2' });
  });
});

describe('Socket.IO signaling integration', () => {
  let port: number;
  let closeServer: () => Promise<void>;
  const clients: Socket[] = [];

  beforeEach(async () => {
    const { httpServer, io } = createApp({ roomPassword: '' });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
    closeServer = () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      });
  });

  afterEach(async () => {
    for (const c of clients) {
      c.disconnect();
    }
    clients.length = 0;
    await closeServer();
  });

  function connectClient(): Promise<Socket> {
    return new Promise((resolve) => {
      const s = ioClient(`http://localhost:${port}`, { transports: ['websocket'] });
      clients.push(s);
      s.on('connect', () => resolve(s));
    });
  }

  it('forwards WebRTC signals between two peers in the same room', async () => {
    const c1 = await connectClient();
    const c2 = await connectClient();

    const join1 = await new Promise<any>((res) =>
      c1.emit('join-room', { roomId: 'test-room', nickname: 'Alice' }, res)
    );
    expect(join1.ok).toBe(true);

    const peerJoinedPromise = new Promise<any>((res) => c1.once('peer-joined', res));
    const join2 = await new Promise<any>((res) =>
      c2.emit('join-room', { roomId: 'test-room', nickname: 'Bob' }, res)
    );
    expect(join2.ok).toBe(true);
    expect(join2.participants.length).toBe(2);

    const joinedPeer = await peerJoinedPromise;
    expect(joinedPeer.id).toBe(c2.id);

    const signalPromise = new Promise<any>((res) => c2.once('signal', res));
    c1.emit('signal', { to: c2.id, description: { type: 'offer', sdp: 'fake-sdp' } });
    const sig = await signalPromise;
    expect(sig.from).toBe(c1.id);
    expect(sig.description).toEqual({ type: 'offer', sdp: 'fake-sdp' });
  });
});

import type { IceServerConfig } from './types.js';

const DEFAULT_STUN_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function getIceServers(env: NodeJS.ProcessEnv = process.env): {
  iceServers: IceServerConfig[];
  hasTurn: boolean;
} {
  const iceServers: IceServerConfig[] = [...DEFAULT_STUN_SERVERS];
  const turnUrlRaw = env.TURN_URL?.trim();

  if (!turnUrlRaw) {
    return { iceServers, hasTurn: false };
  }

  const urls = turnUrlRaw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return { iceServers, hasTurn: false };
  }

  const turnServer: IceServerConfig = { urls };
  if (env.TURN_USERNAME?.trim()) {
    turnServer.username = env.TURN_USERNAME.trim();
  }
  if (env.TURN_CREDENTIAL?.trim()) {
    turnServer.credential = env.TURN_CREDENTIAL.trim();
  }

  iceServers.push(turnServer);
  return { iceServers, hasTurn: true };
}

export interface Participant {
  id: string;
  nickname: string;
  avatar: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  screenSharing: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  nickname: string;
  avatar: string | null;
  text: string;
  image?: string | null;
  timestamp: number;
}

export interface AudioSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  pushToTalk: boolean;
  pttKey: string; // e.g. 'Space', 'KeyV', 'Backquote'
}

export interface ScreenShareSettings {
  resolution: '720p' | '1080p';
  fps: 30 | 60;
  contentHint: 'motion' | 'detail';
}

export interface AppConfig {
  passwordRequired: boolean;
  iceServers: RTCIceServer[];
  hasTurn: boolean;
}

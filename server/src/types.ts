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

export interface JoinRoomPayload {
  roomId: string;
  nickname: string;
  avatar?: string | null;
  password?: string;
}

export interface JoinRoomResult {
  ok: boolean;
  error?: string;
  code?: 'ROOM_FULL' | 'INVALID_PASSWORD' | 'INVALID_INPUT';
  self?: Participant;
  participants?: Participant[];
  messages?: ChatMessage[];
  screenSharerId?: string | null;
  passwordRequired?: boolean;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

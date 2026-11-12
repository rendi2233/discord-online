import crypto from 'node:crypto';
import type { ChatMessage, JoinRoomPayload, JoinRoomResult, Participant } from './types.js';

export const MAX_PARTICIPANTS = 5;
export const MAX_CHAT_HISTORY = 100;
export const MAX_AVATAR_DATA_URL_LENGTH = 72_000; // ~50 KB base64 image
export const MAX_CHAT_IMAGE_DATA_URL_LENGTH = 750_000; // ~500 KB pasted image
export const MAX_MESSAGE_TEXT_LENGTH = 2000;

const ROOM_ID_REGEX = /^[a-zA-Z0-9_-]{2,32}$/;
const AVATAR_DATA_URL_REGEX = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const CHAT_IMAGE_DATA_URL_REGEX = /^data:image\/(webp|jpeg|png|gif);base64,[A-Za-z0-9+/=]+$/;

export interface RoomState {
  id: string;
  participants: Map<string, Participant>;
  messages: ChatMessage[];
  screenSharerId: string | null;
}

export class RoomManager {
  private rooms = new Map<string, RoomState>();
  private rateLimits = new Map<string, number[]>();

  constructor(private readonly roomPassword: string = '') {}

  isPasswordRequired(): boolean {
    return this.roomPassword.length > 0;
  }

  validateAvatar(avatar?: string | null): string | null {
    if (!avatar || typeof avatar !== 'string') return null;
    if (avatar.length > MAX_AVATAR_DATA_URL_LENGTH) return null;
    if (!AVATAR_DATA_URL_REGEX.test(avatar)) return null;
    return avatar;
  }

  validateChatImage(image?: string | null): string | null {
    if (!image || typeof image !== 'string') return null;
    if (image.length > MAX_CHAT_IMAGE_DATA_URL_LENGTH) return null;
    if (!CHAT_IMAGE_DATA_URL_REGEX.test(image)) return null;
    return image;
  }

  joinRoom(socketId: string, payload: JoinRoomPayload): JoinRoomResult {
    const roomId = typeof payload?.roomId === 'string' ? payload.roomId.trim() : '';
    const nickname = typeof payload?.nickname === 'string' ? payload.nickname.trim() : '';

    if (!ROOM_ID_REGEX.test(roomId)) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        error: 'Код комнаты должен содержать от 2 до 32 символов (латиница, цифры, _ или -).',
      };
    }

    if (nickname.length < 1 || nickname.length > 24) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        error: 'Никнейм должен быть от 1 до 24 символов.',
      };
    }

    if (this.roomPassword && payload?.password !== this.roomPassword) {
      return {
        ok: false,
        code: 'INVALID_PASSWORD',
        error: 'Неверный пароль комнаты.',
      };
    }

    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        participants: new Map(),
        messages: [],
        screenSharerId: null,
      };
      this.rooms.set(roomId, room);
    }

    if (room.participants.size >= MAX_PARTICIPANTS && !room.participants.has(socketId)) {
      return {
        ok: false,
        code: 'ROOM_FULL',
        error: `Комната заполнена (максимум ${MAX_PARTICIPANTS} человек).`,
      };
    }

    const participant: Participant = {
      id: socketId,
      nickname,
      avatar: this.validateAvatar(payload.avatar),
      muted: false,
      deafened: false,
      speaking: false,
      screenSharing: false,
    };

    room.participants.set(socketId, participant);

    return {
      ok: true,
      self: participant,
      participants: Array.from(room.participants.values()),
      messages: [...room.messages],
      screenSharerId: room.screenSharerId,
    };
  }

  leaveRoom(socketId: string, roomId: string): {
    participant?: Participant;
    screenShareStopped: boolean;
  } {
    this.rateLimits.delete(socketId);
    const room = this.rooms.get(roomId);
    if (!room) return { screenShareStopped: false };

    const participant = room.participants.get(socketId);
    room.participants.delete(socketId);

    let screenShareStopped = false;
    if (room.screenSharerId === socketId) {
      room.screenSharerId = null;
      screenShareStopped = true;
    }

    return { participant, screenShareStopped };
  }

  getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  updateParticipantState(
    roomId: string,
    socketId: string,
    patch: Partial<Pick<Participant, 'muted' | 'deafened' | 'speaking' | 'avatar'>>
  ): Participant | null {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(socketId);
    if (!participant) return null;

    if (typeof patch.muted === 'boolean') participant.muted = patch.muted;
    if (typeof patch.deafened === 'boolean') participant.deafened = patch.deafened;
    if (typeof patch.speaking === 'boolean') participant.speaking = patch.speaking;
    if (patch.avatar !== undefined) {
      participant.avatar = this.validateAvatar(patch.avatar);
    }
    return participant;
  }

  setScreenShare(roomId: string, socketId: string, active: boolean): {
    ok: boolean;
    screenSharerId: string | null;
    error?: string;
  } {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(socketId);
    if (!room || !participant) {
      return { ok: false, screenSharerId: null, error: 'Участник не найден в комнате.' };
    }

    if (active) {
      if (room.screenSharerId && room.screenSharerId !== socketId) {
        return {
          ok: false,
          screenSharerId: room.screenSharerId,
          error: 'Кто-то уже демонстрирует экран.',
        };
      }
      room.screenSharerId = socketId;
      participant.screenSharing = true;
      return { ok: true, screenSharerId: socketId };
    } else {
      if (room.screenSharerId === socketId) {
        room.screenSharerId = null;
      }
      participant.screenSharing = false;
      return { ok: true, screenSharerId: room.screenSharerId };
    }
  }

  addChatMessage(
    roomId: string,
    socketId: string,
    rawText: unknown,
    rawImage?: unknown
  ): { ok: true; message: ChatMessage } | { ok: false; error: string } {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(socketId);
    if (!room || !participant) {
      return { ok: false, error: 'Вы не находитесь в комнате.' };
    }

    // Rate limit: max 5 messages per 3 seconds
    const now = Date.now();
    const history = (this.rateLimits.get(socketId) ?? []).filter((t) => now - t < 3000);
    if (history.length >= 5) {
      return { ok: false, error: 'Слишком много сообщений. Подождите пару секунд.' };
    }
    history.push(now);
    this.rateLimits.set(socketId, history);

    const text = typeof rawText === 'string' ? rawText.trim().slice(0, MAX_MESSAGE_TEXT_LENGTH) : '';
    const image = typeof rawImage === 'string' ? this.validateChatImage(rawImage) : null;

    if (!text && !image) {
      return { ok: false, error: 'Пустое сообщение.' };
    }

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      senderId: socketId,
      nickname: participant.nickname,
      avatar: participant.avatar,
      text,
      image,
      timestamp: now,
    };

    room.messages.push(message);
    if (room.messages.length > MAX_CHAT_HISTORY) {
      room.messages.shift();
    }

    return { ok: true, message };
  }
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  AppConfig,
  AudioSettings,
  ChatMessage,
  Participant,
  ScreenShareSettings,
} from '../types';
import { applySenderBitrate, computeScreenBitrate, tuneOpusSdp } from '../utils/sdp';

interface PeerState {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
  audioSender?: RTCRtpSender;
  screenVideoSender?: RTCRtpSender;
  screenAudioSender?: RTCRtpSender;
}

export interface UseWebRTCResult {
  connected: boolean;
  joined: boolean;
  joining: boolean;
  joinError: string | null;
  roomId: string;
  self: Participant | null;
  participants: Participant[];
  messages: ChatMessage[];
  screenSharerId: string | null;
  remoteScreenStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  peerVolumes: Record<string, number>;
  micWarning: string | null;
  joinRoom: (params: {
    roomId: string;
    nickname: string;
    avatar: string | null;
    password?: string;
  }) => Promise<void>;
  leaveRoom: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setPeerVolume: (peerId: string, volume: number) => void;
  updateAvatar: (avatar: string | null) => void;
  sendMessage: (text: string, image?: string | null) => Promise<{ ok: boolean; error?: string }>;
  startScreenShare: () => Promise<string | null>;
  stopScreenShare: () => void;
  applyAudioSettings: (next: AudioSettings) => Promise<void>;
  applyScreenSettings: (next: ScreenShareSettings) => Promise<void>;
  remoteAudioStreams: Map<string, MediaStream>;
}

export function useWebRTC(
  config: AppConfig | null,
  audioSettings: AudioSettings,
  screenSettings: ScreenShareSettings
): UseWebRTCResult {
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserTimerRef = useRef<number | null>(null);
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);
  const pttPressedRef = useRef(false);
  const audioSettingsRef = useRef(audioSettings);
  const screenSettingsRef = useRef(screenSettings);
  const configRef = useRef(config);

  audioSettingsRef.current = audioSettings;
  screenSettingsRef.current = screenSettings;
  configRef.current = config;

  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState('');
  const [self, setSelf] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [screenSharerId, setScreenSharerId] = useState<string | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
  const [micWarning, setMicWarning] = useState<string | null>(null);
  const [remoteAudioStreams, setRemoteAudioStreams] = useState<Map<string, MediaStream>>(
    () => new Map()
  );

  const updateMicTrackEnabled = useCallback(() => {
    const stream = localAudioStreamRef.current;
    if (!stream) return;
    const settings = audioSettingsRef.current;
    const isMuted = mutedRef.current || deafenedRef.current;
    const enabled = settings.pushToTalk ? !isMuted && pttPressedRef.current : !isMuted;
    for (const track of stream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }, []);

  const stopSpeakingDetector = useCallback(() => {
    if (analyserTimerRef.current !== null) {
      window.clearInterval(analyserTimerRef.current);
      analyserTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const startSpeakingDetector = useCallback(
    (stream: MediaStream) => {
      stopSpeakingDetector();
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        let wasSpeaking = false;
        let silenceCount = 0;

        analyserTimerRef.current = window.setInterval(() => {
          const track = stream.getAudioTracks()[0];
          const canSpeak = Boolean(track && track.enabled);
          let isSpeaking = false;

          if (canSpeak) {
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / data.length;
            if (avg > 14) {
              isSpeaking = true;
              silenceCount = 0;
            } else if (wasSpeaking && silenceCount < 4) {
              // Small hangover to avoid flickering
              isSpeaking = true;
              silenceCount++;
            }
          }

          if (isSpeaking !== wasSpeaking) {
            wasSpeaking = isSpeaking;
            setSelf((prev) => (prev ? { ...prev, speaking: isSpeaking } : prev));
            setParticipants((prev) =>
              prev.map((p) => (p.id === selfIdRef.current ? { ...p, speaking: isSpeaking } : p))
            );
            socketRef.current?.emit('participant-state', { speaking: isSpeaking });
          }
        }, 90);
      } catch {
        // AudioContext blocked or unsupported
      }
    },
    [stopSpeakingDetector]
  );

  const acquireMic = useCallback(
    async (settings: AudioSettings): Promise<MediaStream | null> => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: {
            deviceId: settings.inputDeviceId ? { exact: settings.inputDeviceId } : undefined,
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl,
            channelCount: 1,
            sampleRate: 48000,
          },
          video: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setMicWarning(null);
        return stream;
      } catch (err) {
        console.warn('getUserMedia failed:', err);
        setMicWarning('Микрофон недоступен (режим прослушивания). Проверьте разрешения браузера.');
        return null;
      }
    },
    []
  );

  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (peer) {
      peer.pc.close();
      peersRef.current.delete(peerId);
    }
    setRemoteAudioStreams((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

  const updateAllScreenBitrates = useCallback(async () => {
    const viewerCount = peersRef.current.size;
    if (viewerCount === 0) return;
    const bitrate = computeScreenBitrate(screenSettingsRef.current, viewerCount);
    for (const peer of peersRef.current.values()) {
      if (peer.screenVideoSender) {
        await applySenderBitrate(peer.screenVideoSender, bitrate);
      }
    }
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string): PeerState => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const iceServers = configRef.current?.iceServers ?? [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];

      const pc = new RTCPeerConnection({ iceServers });
      const selfId = selfIdRef.current ?? '';
      const polite = selfId < peerId;

      const peerState: PeerState = {
        pc,
        makingOffer: false,
        ignoreOffer: false,
        polite,
      };
      peersRef.current.set(peerId, peerState);

      // Add local mic track
      if (localAudioStreamRef.current) {
        for (const track of localAudioStreamRef.current.getAudioTracks()) {
          peerState.audioSender = pc.addTrack(track, localAudioStreamRef.current);
          applySenderBitrate(peerState.audioSender, 112_000);
        }
      }

      // Add local screen share tracks if currently sharing
      if (localScreenStreamRef.current) {
        for (const track of localScreenStreamRef.current.getTracks()) {
          const sender = pc.addTrack(track, localScreenStreamRef.current);
          if (track.kind === 'video') {
            peerState.screenVideoSender = sender;
            const bitrate = computeScreenBitrate(screenSettingsRef.current, peersRef.current.size);
            applySenderBitrate(sender, bitrate);
          } else {
            peerState.screenAudioSender = sender;
          }
        }
      }

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          socketRef.current?.emit('signal', { to: peerId, candidate });
        }
      };

      pc.onnegotiationneeded = async () => {
        try {
          peerState.makingOffer = true;
          const offer = await pc.createOffer();
          if (offer.sdp) {
            offer.sdp = tuneOpusSdp(offer.sdp, 112000);
          }
          await pc.setLocalDescription(offer);
          socketRef.current?.emit('signal', {
            to: peerId,
            description: pc.localDescription,
          });
        } catch (err) {
          console.error('Negotiation error:', err);
        } finally {
          peerState.makingOffer = false;
        }
      };

      pc.ontrack = ({ track, streams }) => {
        const stream = streams[0] ?? new MediaStream([track]);
        const hasVideo = stream.getVideoTracks().length > 0 || track.kind === 'video';

        if (hasVideo) {
          setRemoteScreenStream(stream);
          track.onended = () => {
            setRemoteScreenStream((curr) => (curr === stream ? null : curr));
          };
        } else if (track.kind === 'audio') {
          setRemoteAudioStreams((prev) => {
            const next = new Map(prev);
            next.set(peerId, stream);
            return next;
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          pc.restartIce();
        }
      };

      return peerState;
    },
    []
  );

  // Initialize socket once
  useEffect(() => {
    const socket = io({ autoConnect: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      selfIdRef.current = socket.id ?? null;
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('peer-joined', (peer: Participant) => {
      setParticipants((prev) => {
        if (prev.some((p) => p.id === peer.id)) return prev;
        return [...prev, peer];
      });
      createPeerConnection(peer.id);
      updateAllScreenBitrates();
    });

    socket.on('peer-left', ({ id }: { id: string }) => {
      closePeer(id);
      setParticipants((prev) => prev.filter((p) => p.id !== id));
      updateAllScreenBitrates();
    });

    socket.on('participant-updated', (updated: Participant) => {
      setParticipants((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    });

    socket.on('screen-share-state', ({ screenSharerId: sharerId }: { screenSharerId: string | null }) => {
      setScreenSharerId(sharerId);
      setParticipants((prev) =>
        prev.map((p) => ({ ...p, screenSharing: p.id === sharerId }))
      );
      if (!sharerId) {
        setRemoteScreenStream(null);
      }
    });

    socket.on('chat-message', (msg: ChatMessage) => {
      setMessages((prev) => [...prev.slice(-99), msg]);
    });

    socket.on(
      'signal',
      async ({
        from,
        description,
        candidate,
      }: {
        from: string;
        description?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      }) => {
        const peer = createPeerConnection(from);
        const { pc } = peer;

        try {
          if (description) {
            const offerCollision =
              description.type === 'offer' &&
              (peer.makingOffer || pc.signalingState !== 'stable');

            peer.ignoreOffer = !peer.polite && offerCollision;
            if (peer.ignoreOffer) return;

            const tunedDesc =
              description.sdp && (description.type === 'offer' || description.type === 'answer')
                ? { ...description, sdp: tuneOpusSdp(description.sdp, 112000) }
                : description;

            await pc.setRemoteDescription(tunedDesc);

            if (description.type === 'offer') {
              const answer = await pc.createAnswer();
              if (answer.sdp) {
                answer.sdp = tuneOpusSdp(answer.sdp, 112000);
              }
              await pc.setLocalDescription(answer);
              socket.emit('signal', {
                to: from,
                description: pc.localDescription,
              });
            }
          } else if (candidate) {
            try {
              await pc.addIceCandidate(candidate);
            } catch (err) {
              if (!peer.ignoreOffer) throw err;
            }
          }
        } catch (err) {
          console.error('Signal handling error:', err);
        }
      }
    );

    return () => {
      socket.disconnect();
    };
  }, [closePeer, createPeerConnection, updateAllScreenBitrates]);

  // Push-to-Talk key listener
  useEffect(() => {
    if (!joined || !audioSettings.pushToTalk) {
      pttPressedRef.current = false;
      updateMicTrackEnabled();
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.code === audioSettings.pttKey && !e.repeat) {
        pttPressedRef.current = true;
        updateMicTrackEnabled();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === audioSettings.pttKey) {
        pttPressedRef.current = false;
        updateMicTrackEnabled();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [joined, audioSettings.pushToTalk, audioSettings.pttKey, updateMicTrackEnabled]);

  const stopScreenShare = useCallback(() => {
    const stream = localScreenStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      localScreenStreamRef.current = null;
      setLocalScreenStream(null);
    }

    for (const peer of peersRef.current.values()) {
      if (peer.screenVideoSender) {
        peer.pc.removeTrack(peer.screenVideoSender);
        peer.screenVideoSender = undefined;
      }
      if (peer.screenAudioSender) {
        peer.pc.removeTrack(peer.screenAudioSender);
        peer.screenAudioSender = undefined;
      }
    }

    socketRef.current?.emit('screen-share-toggle', { active: false });
  }, []);

  const joinRoom = useCallback(
    async (params: {
      roomId: string;
      nickname: string;
      avatar: string | null;
      password?: string;
    }) => {
      const socket = socketRef.current;
      if (!socket) return;
      setJoining(true);
      setJoinError(null);

      const stream = await acquireMic(audioSettingsRef.current);
      if (stream) {
        localAudioStreamRef.current = stream;
        updateMicTrackEnabled();
        startSpeakingDetector(stream);
      }

      const res = await new Promise<{
        ok: boolean;
        error?: string;
        self?: Participant;
        participants?: Participant[];
        messages?: ChatMessage[];
        screenSharerId?: string | null;
      }>((resolve) => {
        socket.emit('join-room', params, resolve);
      });

      setJoining(false);

      if (!res.ok || !res.self) {
        if (localAudioStreamRef.current) {
          localAudioStreamRef.current.getTracks().forEach((t) => t.stop());
          localAudioStreamRef.current = null;
        }
        stopSpeakingDetector();
        setJoinError(res.error ?? 'Не удалось войти в комнату.');
        return;
      }

      selfIdRef.current = res.self.id;
      setSelf(res.self);
      setParticipants(res.participants ?? [res.self]);
      setMessages(res.messages ?? []);
      setScreenSharerId(res.screenSharerId ?? null);
      setRoomId(params.roomId.trim());
      setJoined(true);

      // Connect to existing peers
      for (const p of res.participants ?? []) {
        if (p.id !== res.self.id) {
          createPeerConnection(p.id);
        }
      }
    },
    [acquireMic, createPeerConnection, startSpeakingDetector, stopSpeakingDetector, updateMicTrackEnabled]
  );

  const leaveRoom = useCallback(() => {
    stopScreenShare();
    stopSpeakingDetector();
    if (localAudioStreamRef.current) {
      localAudioStreamRef.current.getTracks().forEach((t) => t.stop());
      localAudioStreamRef.current = null;
    }
    for (const peerId of Array.from(peersRef.current.keys())) {
      closePeer(peerId);
    }
    socketRef.current?.disconnect();
    socketRef.current?.connect();

    setJoined(false);
    setRoomId('');
    setSelf(null);
    setParticipants([]);
    setMessages([]);
    setScreenSharerId(null);
    setRemoteScreenStream(null);
  }, [closePeer, stopScreenShare, stopSpeakingDetector]);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    updateMicTrackEnabled();
    setSelf((prev) => (prev ? { ...prev, muted: nextMuted } : prev));
    setParticipants((prev) =>
      prev.map((p) => (p.id === selfIdRef.current ? { ...p, muted: nextMuted } : p))
    );
    socketRef.current?.emit('participant-state', { muted: nextMuted });
  }, [updateMicTrackEnabled]);

  const toggleDeafen = useCallback(() => {
    const nextDeafened = !deafenedRef.current;
    deafenedRef.current = nextDeafened;
    updateMicTrackEnabled();
    setSelf((prev) => (prev ? { ...prev, deafened: nextDeafened } : prev));
    setParticipants((prev) =>
      prev.map((p) => (p.id === selfIdRef.current ? { ...p, deafened: nextDeafened } : p))
    );
    socketRef.current?.emit('participant-state', { deafened: nextDeafened });
  }, [updateMicTrackEnabled]);

  const setPeerVolume = useCallback((peerId: string, volume: number) => {
    setPeerVolumes((prev) => ({ ...prev, [peerId]: volume }));
  }, []);

  const updateAvatar = useCallback((avatar: string | null) => {
    setSelf((prev) => (prev ? { ...prev, avatar } : prev));
    setParticipants((prev) =>
      prev.map((p) => (p.id === selfIdRef.current ? { ...p, avatar } : p))
    );
    socketRef.current?.emit('participant-state', { avatar });
  }, []);

  const sendMessage = useCallback(
    async (text: string, image?: string | null): Promise<{ ok: boolean; error?: string }> => {
      const socket = socketRef.current;
      if (!socket) return { ok: false, error: 'Нет соединения с сервером.' };
      return new Promise((resolve) => {
        socket.emit('chat-message', { text, image }, resolve);
      });
    },
    []
  );

  const startScreenShare = useCallback(async (): Promise<string | null> => {
    const socket = socketRef.current;
    if (!socket) return 'Нет соединения.';

    const s = screenSettingsRef.current;
    const width = s.resolution === '1080p' ? 1920 : 1280;
    const height = s.resolution === '1080p' ? 1080 : 720;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: s.fps, max: s.fps },
        },
        audio: true,
      });
    } catch {
      return 'Демонстрация экрана отменена или не поддерживается.';
    }

    const lockRes = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socket.emit('screen-share-toggle', { active: true }, resolve);
    });

    if (!lockRes.ok) {
      stream.getTracks().forEach((t) => t.stop());
      return lockRes.error ?? 'Кто-то уже демонстрирует экран.';
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      if ('contentHint' in videoTrack) {
        videoTrack.contentHint = s.contentHint;
      }
      videoTrack.onended = () => {
        stopScreenShare();
      };
    }

    localScreenStreamRef.current = stream;
    setLocalScreenStream(stream);

    const bitrate = computeScreenBitrate(s, peersRef.current.size);
    for (const peer of peersRef.current.values()) {
      for (const track of stream.getTracks()) {
        const sender = peer.pc.addTrack(track, stream);
        if (track.kind === 'video') {
          peer.screenVideoSender = sender;
          await applySenderBitrate(sender, bitrate);
        } else {
          peer.screenAudioSender = sender;
        }
      }
    }

    return null;
  }, [stopScreenShare]);

  const applyAudioSettings = useCallback(
    async (next: AudioSettings) => {
      audioSettingsRef.current = next;
      if (!joined) return;

      const newStream = await acquireMic(next);
      if (!newStream) return;

      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      // Replace track on all existing peer connections without renegotiation
      for (const peer of peersRef.current.values()) {
        if (peer.audioSender) {
          await peer.audioSender.replaceTrack(newTrack);
        } else {
          peer.audioSender = peer.pc.addTrack(newTrack, newStream);
        }
      }

      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      localAudioStreamRef.current = newStream;
      updateMicTrackEnabled();
      startSpeakingDetector(newStream);
    },
    [acquireMic, joined, startSpeakingDetector, updateMicTrackEnabled]
  );

  const applyScreenSettings = useCallback(
    async (next: ScreenShareSettings) => {
      screenSettingsRef.current = next;
      const stream = localScreenStreamRef.current;
      if (!stream) return;

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && 'contentHint' in videoTrack) {
        videoTrack.contentHint = next.contentHint;
      }
      await updateAllScreenBitrates();
    },
    [updateAllScreenBitrates]
  );

  return {
    connected,
    joined,
    joining,
    joinError,
    roomId,
    self,
    participants,
    messages,
    screenSharerId,
    remoteScreenStream,
    localScreenStream,
    peerVolumes,
    micWarning,
    joinRoom,
    leaveRoom,
    toggleMute,
    toggleDeafen,
    setPeerVolume,
    updateAvatar,
    sendMessage,
    startScreenShare,
    stopScreenShare,
    applyAudioSettings,
    applyScreenSettings,
    remoteAudioStreams,
  };
}

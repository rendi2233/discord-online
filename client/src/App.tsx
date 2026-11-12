import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Headphones,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { AppConfig, AudioSettings, ScreenShareSettings } from './types';
import { useWebRTC } from './hooks/useWebRTC';
import { Avatar } from './components/Avatar';
import { JoinScreen } from './components/JoinScreen';
import { ChatPanel } from './components/ChatPanel';
import { ScreenSharePlayer } from './components/ScreenSharePlayer';
import { SettingsModal } from './components/SettingsModal';
import { RemoteAudio } from './components/RemoteAudio';

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  inputDeviceId: '',
  outputDeviceId: '',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  pushToTalk: false,
  pttKey: 'Space',
};

const DEFAULT_SCREEN_SETTINGS: ScreenShareSettings = {
  resolution: '1080p',
  fps: 30,
  contentHint: 'motion',
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function getInitialRoomFromUrl(): string {
  const match = window.location.pathname.match(/^\/room\/([a-zA-Z0-9_-]{2,32})/);
  return match ? match[1] : 'friends';
}

export const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() =>
    loadJson('discord_online_audio', DEFAULT_AUDIO_SETTINGS)
  );
  const [screenSettings, setScreenSettings] = useState<ScreenShareSettings>(() =>
    loadJson('discord_online_screen', DEFAULT_SCREEN_SETTINGS)
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpenMobile, setChatOpenMobile] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);

  const initialNickname = localStorage.getItem('discord_online_nickname') ?? '';
  const initialAvatar = localStorage.getItem('discord_online_avatar') ?? null;

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data: AppConfig) => setConfig(data))
      .catch(() =>
        setConfig({
          passwordRequired: false,
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          hasTurn: false,
        })
      );
  }, []);

  const rtc = useWebRTC(config, audioSettings, screenSettings);

  const handleJoin = async (params: {
    roomId: string;
    nickname: string;
    avatar: string | null;
    password?: string;
  }) => {
    await rtc.joinRoom(params);
    window.history.replaceState(null, '', `/room/${params.roomId}`);
  };

  const handleCopyInvite = () => {
    const url = `${window.location.origin}/room/${rtc.roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleToggleScreenShare = async () => {
    setScreenError(null);
    if (rtc.localScreenStream) {
      rtc.stopScreenShare();
      return;
    }
    const err = await rtc.startScreenShare();
    if (err) setScreenError(err);
  };

  const handleAudioSettingsChange = (next: AudioSettings) => {
    setAudioSettings(next);
    localStorage.setItem('discord_online_audio', JSON.stringify(next));
    rtc.applyAudioSettings(next);
  };

  const handleScreenSettingsChange = (next: ScreenShareSettings) => {
    setScreenSettings(next);
    localStorage.setItem('discord_online_screen', JSON.stringify(next));
    rtc.applyScreenSettings(next);
  };

  if (!rtc.joined || !rtc.self) {
    return (
      <JoinScreen
        initialRoomId={getInitialRoomFromUrl()}
        initialNickname={initialNickname}
        initialAvatar={initialAvatar}
        passwordRequired={config?.passwordRequired ?? false}
        joining={rtc.joining}
        error={rtc.joinError}
        onJoin={handleJoin}
      />
    );
  }

  const isSharing = Boolean(rtc.localScreenStream);
  const someoneElseSharing = Boolean(rtc.screenSharerId && rtc.screenSharerId !== rtc.self.id);
  const activeScreenStream = rtc.localScreenStream ?? rtc.remoteScreenStream;
  const sharer = rtc.participants.find((p) => p.id === rtc.screenSharerId);

  return (
    <div className="app-shell">
      <RemoteAudio
        streams={rtc.remoteAudioStreams}
        peerVolumes={rtc.peerVolumes}
        deafened={rtc.self.deafened}
        outputDeviceId={audioSettings.outputDeviceId}
      />

      {/* Left Sidebar: Room & Participants */}
      <aside className="sidebar">
        <div className="sidebar__header">
          <div className="room-title">
            <Headphones size={18} />
            <span>{rtc.roomId}</span>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleCopyInvite}
            title="Скопировать ссылку-приглашение"
          >
            {copiedLink ? <Check size={14} /> : <Copy size={14} />}
            <span>{copiedLink ? 'Скопировано' : 'Ссылка'}</span>
          </button>
        </div>

        <div className="sidebar__section-title">
          Участники — {rtc.participants.length}/5
        </div>

        <div className="participant-list">
          {rtc.participants.map((p) => {
            const isSelf = p.id === rtc.self?.id;
            const vol = rtc.peerVolumes[p.id] ?? 1;
            return (
              <div key={p.id} className="participant-item">
                <div className="participant-item__top">
                  <Avatar
                    nickname={p.nickname}
                    avatar={p.avatar}
                    size={34}
                    speaking={p.speaking}
                  />
                  <div className="participant-item__name">
                    <span>{p.nickname}</span>
                    {isSelf && <span className="tag-self">вы</span>}
                  </div>
                  <div className="participant-item__icons">
                    {p.screenSharing && (
                      <span className="icon-live" title="Демонстрирует экран">
                        LIVE
                      </span>
                    )}
                    {p.muted && <MicOff size={15} className="icon-danger" />}
                    {p.deafened && <VolumeX size={15} className="icon-danger" />}
                  </div>
                </div>

                {!isSelf && (
                  <div className="participant-item__vol">
                    <Volume2 size={13} />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={vol}
                      onChange={(e) => rtc.setPeerVolume(p.id, Number(e.target.value))}
                      title={`Громкость: ${Math.round(vol * 100)}%`}
                    />
                    <span>{Math.round(vol * 100)}%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom User Controls */}
        <div className="user-dock">
          <div className="user-dock__me">
            <Avatar
              nickname={rtc.self.nickname}
              avatar={rtc.self.avatar}
              size={34}
              speaking={rtc.self.speaking}
            />
            <div className="user-dock__info">
              <div className="user-dock__name">{rtc.self.nickname}</div>
              <div className="user-dock__status">
                {audioSettings.pushToTalk
                  ? `PTT: ${audioSettings.pttKey}`
                  : rtc.connected
                    ? 'В сети'
                    : 'Переподключение...'}
              </div>
            </div>
          </div>

          <div className="user-dock__actions">
            <button
              type="button"
              className={`btn btn--icon ${rtc.self.muted ? 'btn--danger' : 'btn--ghost'}`}
              onClick={rtc.toggleMute}
              title={rtc.self.muted ? 'Включить микрофон' : 'Выключить микрофон'}
            >
              {rtc.self.muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              type="button"
              className={`btn btn--icon ${rtc.self.deafened ? 'btn--danger' : 'btn--ghost'}`}
              onClick={rtc.toggleDeafen}
              title={rtc.self.deafened ? 'Включить звук' : 'Отключить весь звук'}
            >
              {rtc.self.deafened ? <VolumeX size={18} /> : <Headphones size={18} />}
            </button>
            <button
              type="button"
              className={`btn btn--icon ${isSharing ? 'btn--success' : 'btn--ghost'}`}
              onClick={handleToggleScreenShare}
              disabled={someoneElseSharing}
              title={
                someoneElseSharing
                  ? 'Кто-то уже демонстрирует экран'
                  : isSharing
                    ? 'Остановить демонстрацию'
                    : 'Демонстрация экрана'
              }
            >
              {isSharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
            </button>
            <button
              type="button"
              className="btn btn--icon btn--ghost"
              onClick={() => setSettingsOpen(true)}
              title="Настройки"
            >
              <Settings size={18} />
            </button>
            <button
              type="button"
              className="btn btn--icon btn--danger-subtle"
              onClick={rtc.leaveRoom}
              title="Выйти из комнаты"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Center Stage */}
      <main className="stage">
        <div className="stage__topbar">
          <div className="stage__status">
            {!config?.hasTurn && (
              <span className="pill-warn" title="TURN не настроен в .env — за строгим NAT связь может не подняться">
                Только STUN (без TURN)
              </span>
            )}
            {rtc.micWarning && <span className="pill-warn">{rtc.micWarning}</span>}
            {screenError && <span className="pill-error">{screenError}</span>}
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm mobile-chat-toggle"
            onClick={() => setChatOpenMobile((v) => !v)}
          >
            <MessageSquare size={15} /> Чат
          </button>
        </div>

        <div className="stage__content">
          <ScreenSharePlayer
            stream={activeScreenStream}
            isLocalPreview={isSharing}
            sharer={sharer}
            participants={rtc.participants}
            selfId={rtc.self.id}
          />
        </div>
      </main>

      {/* Right Chat Panel */}
      <div className={`chat-wrapper ${chatOpenMobile ? 'chat-wrapper--open' : ''}`}>
        <ChatPanel messages={rtc.messages} onSend={rtc.sendMessage} />
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        nickname={rtc.self.nickname}
        avatar={rtc.self.avatar}
        onAvatarChange={rtc.updateAvatar}
        audioSettings={audioSettings}
        onAudioSettingsChange={handleAudioSettingsChange}
        screenSettings={screenSettings}
        onScreenSettingsChange={handleScreenSettingsChange}
      />
    </div>
  );
};

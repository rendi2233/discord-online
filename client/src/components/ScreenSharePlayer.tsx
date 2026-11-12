import React, { useEffect, useRef } from 'react';
import { Maximize2, Monitor, MicOff, VolumeX } from 'lucide-react';
import type { Participant } from '../types';
import { Avatar } from './Avatar';

interface ScreenSharePlayerProps {
  stream: MediaStream | null;
  isLocalPreview: boolean;
  sharer: Participant | undefined;
  participants: Participant[];
  selfId: string | undefined;
}

export const ScreenSharePlayer: React.FC<ScreenSharePlayerProps> = ({
  stream,
  isLocalPreview,
  sharer,
  participants,
  selfId,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) {
      el.play().catch(() => {});
    }
  }, [stream]);

  const handleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  };

  if (stream) {
    return (
      <div className="stage-screen" ref={containerRef}>
        <div className="stage-screen__topbar">
          <div className="stage-screen__label">
            <Monitor size={16} />
            <span>
              {isLocalPreview
                ? 'Вы демонстрируете экран'
                : `${sharer?.nickname ?? 'Участник'} демонстрирует экран`}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleFullscreen}
            title="На весь экран"
          >
            <Maximize2 size={15} /> На весь экран
          </button>
        </div>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocalPreview}
          className="stage-screen__video"
        />
      </div>
    );
  }

  return (
    <div className="stage-grid">
      {participants.map((p) => (
        <div
          key={p.id}
          className={`voice-card ${p.speaking ? 'voice-card--speaking' : ''}`}
        >
          <Avatar nickname={p.nickname} avatar={p.avatar} size={72} speaking={p.speaking} />
          <div className="voice-card__name">
            {p.nickname} {p.id === selfId ? '(вы)' : ''}
          </div>
          <div className="voice-card__badges">
            {p.muted && (
              <span className="status-pill status-pill--danger" title="Микрофон выключен">
                <MicOff size={13} />
              </span>
            )}
            {p.deafened && (
              <span className="status-pill status-pill--danger" title="Звук выключен">
                <VolumeX size={13} />
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

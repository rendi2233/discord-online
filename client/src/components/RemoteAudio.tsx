import React, { useEffect, useRef } from 'react';

interface PeerAudioElementProps {
  stream: MediaStream;
  volume: number;
  deafened: boolean;
  outputDeviceId: string;
}

const PeerAudioElement: React.FC<PeerAudioElementProps> = ({
  stream,
  volume,
  deafened,
  outputDeviceId,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, volume));
    el.muted = deafened;
  }, [volume, deafened]);

  useEffect(() => {
    const el = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el || !outputDeviceId || typeof el.setSinkId !== 'function') return;
    el.setSinkId(outputDeviceId).catch(() => {});
  }, [outputDeviceId]);

  return <audio ref={audioRef} autoPlay playsInline />;
};

interface RemoteAudioProps {
  streams: Map<string, MediaStream>;
  peerVolumes: Record<string, number>;
  deafened: boolean;
  outputDeviceId: string;
}

export const RemoteAudio: React.FC<RemoteAudioProps> = ({
  streams,
  peerVolumes,
  deafened,
  outputDeviceId,
}) => {
  return (
    <div style={{ display: 'none' }} aria-hidden="true">
      {Array.from(streams.entries()).map(([peerId, stream]) => (
        <PeerAudioElement
          key={peerId}
          stream={stream}
          volume={peerVolumes[peerId] ?? 1}
          deafened={deafened}
          outputDeviceId={outputDeviceId}
        />
      ))}
    </div>
  );
};

import type { ScreenShareSettings } from '../types';

/**
 * Tunes Opus SDP parameters for high-quality mono voice (96-128 kbps, FEC on, DTX off, 48 kHz).
 */
export function tuneOpusSdp(sdp: string, bitrateBps = 112000): string {
  const lines = sdp.split('\r\n');
  let opusPayloadType: string | null = null;

  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2/i);
    if (match) {
      opusPayloadType = match[1];
      break;
    }
  }

  if (!opusPayloadType) return sdp;

  const fmtpPrefix = `a=fmtp:${opusPayloadType} `;
  let foundFmtp = false;

  const updated = lines.map((line) => {
    if (!line.startsWith(fmtpPrefix)) return line;
    foundFmtp = true;

    const existingParams = line.slice(fmtpPrefix.length).split(';').filter(Boolean);
    const paramMap = new Map<string, string>();
    for (const p of existingParams) {
      const [k, v] = p.split('=');
      if (k) paramMap.set(k.trim(), (v ?? '').trim());
    }

    paramMap.set('maxaveragebitrate', String(bitrateBps));
    paramMap.set('useinbandfec', '1');
    paramMap.set('usedtx', '0');
    paramMap.set('stereo', '0');
    paramMap.set('sprop-stereo', '0');

    const serialized = Array.from(paramMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    return `${fmtpPrefix}${serialized}`;
  });

  if (!foundFmtp) {
    // Insert fmtp right after rtpmap for opus
    const idx = updated.findIndex((l) => l.startsWith(`a=rtpmap:${opusPayloadType} `));
    if (idx !== -1) {
      updated.splice(
        idx + 1,
        0,
        `${fmtpPrefix}minptime=10;useinbandfec=1;usedtx=0;stereo=0;sprop-stereo=0;maxaveragebitrate=${bitrateBps}`
      );
    }
  }

  return updated.join('\r\n');
}

/**
 * Computes adaptive video bitrate per peer based on resolution, fps, and active viewer count (mesh).
 */
export function computeScreenBitrate(
  settings: ScreenShareSettings,
  viewerCount: number
): number {
  const baseMax =
    settings.resolution === '1080p'
      ? settings.fps === 60
        ? 3_200_000
        : 2_200_000
      : settings.fps === 60
        ? 2_000_000
        : 1_300_000;

  const viewers = Math.max(1, Math.min(4, viewerCount));
  // Mesh scaling: keep total upload reasonable (~4-5 Mbps total max)
  const scale = viewers === 1 ? 1 : viewers === 2 ? 0.72 : viewers === 3 ? 0.55 : 0.42;
  return Math.round(baseMax * scale);
}

export async function applySenderBitrate(
  sender: RTCRtpSender,
  maxBitrate: number
): Promise<void> {
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = maxBitrate;
    await sender.setParameters(params);
  } catch {
    // Some browsers disallow setParameters before negotiation completes; ignore safely
  }
}

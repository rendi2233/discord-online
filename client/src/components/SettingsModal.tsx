import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, Trash2 } from 'lucide-react';
import type { AudioSettings, ScreenShareSettings } from '../types';
import { Avatar } from './Avatar';
import { processAvatarFile } from '../utils/avatar';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  nickname: string;
  avatar: string | null;
  onAvatarChange: (avatar: string | null) => void;
  audioSettings: AudioSettings;
  onAudioSettingsChange: (next: AudioSettings) => void;
  screenSettings: ScreenShareSettings;
  onScreenSettingsChange: (next: ScreenShareSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  nickname,
  avatar,
  onAvatarChange,
  audioSettings,
  onAudioSettingsChange,
  screenSettings,
  onScreenSettingsChange,
}) => {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [capturingPtt, setCapturingPtt] = useState(false);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        setInputs(devices.filter((d) => d.kind === 'audioinput'));
        setOutputs(devices.filter((d) => d.kind === 'audiooutput'));
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!capturingPtt) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      onAudioSettingsChange({ ...audioSettings, pttKey: e.code });
      setCapturingPtt(false);
    };
    window.addEventListener('keydown', onKey, { once: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [capturingPtt, audioSettings, onAudioSettingsChange]);

  if (!open) return null;

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarErr(null);
    try {
      const dataUrl = await processAvatarFile(file);
      localStorage.setItem('discord_online_avatar', dataUrl);
      onAvatarChange(dataUrl);
    } catch (err) {
      setAvatarErr(err instanceof Error ? err.message : 'Ошибка загрузки');
    }
    e.target.value = '';
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Настройки</h2>
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal__body">
          <section className="settings-section">
            <h3>Профиль и аватарка</h3>
            <div className="join-avatar-row">
              <Avatar nickname={nickname} avatar={avatar} size={56} />
              <div className="join-avatar-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={14} /> Изменить
                </button>
                {avatar && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      localStorage.removeItem('discord_online_avatar');
                      onAvatarChange(null);
                    }}
                  >
                    <Trash2 size={14} /> Удалить
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleAvatarFile}
                />
              </div>
            </div>
            {avatarErr && <div className="form-error">{avatarErr}</div>}
          </section>

          <section className="settings-section">
            <h3>Аудио</h3>
            <label className="form-field">
              <span>Микрофон</span>
              <select
                value={audioSettings.inputDeviceId}
                onChange={(e) =>
                  onAudioSettingsChange({ ...audioSettings, inputDeviceId: e.target.value })
                }
              >
                <option value="">По умолчанию</option>
                {inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Микрофон (${d.deviceId.slice(0, 6)})`}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span>Устройство вывода</span>
              <select
                value={audioSettings.outputDeviceId}
                onChange={(e) =>
                  onAudioSettingsChange({ ...audioSettings, outputDeviceId: e.target.value })
                }
              >
                <option value="">По умолчанию</option>
                {outputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Динамики (${d.deviceId.slice(0, 6)})`}
                  </option>
                ))}
              </select>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={audioSettings.echoCancellation}
                onChange={(e) =>
                  onAudioSettingsChange({ ...audioSettings, echoCancellation: e.target.checked })
                }
              />
              <span>Подавление эха (Echo Cancellation)</span>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={audioSettings.noiseSuppression}
                onChange={(e) =>
                  onAudioSettingsChange({ ...audioSettings, noiseSuppression: e.target.checked })
                }
              />
              <span>Шумоподавление (Noise Suppression)</span>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={audioSettings.autoGainControl}
                onChange={(e) =>
                  onAudioSettingsChange({ ...audioSettings, autoGainControl: e.target.checked })
                }
              />
              <span>Авторегулировка усиления (AGC)</span>
            </label>

            <div className="ptt-row">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={audioSettings.pushToTalk}
                  onChange={(e) =>
                    onAudioSettingsChange({ ...audioSettings, pushToTalk: e.target.checked })
                  }
                />
                <span>Push-to-Talk (Рация)</span>
              </label>
              {audioSettings.pushToTalk && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setCapturingPtt(true)}
                >
                  {capturingPtt ? 'Нажмите клавишу...' : `Клавиша: ${audioSettings.pttKey}`}
                </button>
              )}
            </div>
          </section>

          <section className="settings-section">
            <h3>Демонстрация экрана</h3>
            <div className="settings-grid-3">
              <label className="form-field">
                <span>Разрешение</span>
                <select
                  value={screenSettings.resolution}
                  onChange={(e) =>
                    onScreenSettingsChange({
                      ...screenSettings,
                      resolution: e.target.value as '720p' | '1080p',
                    })
                  }
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </label>

              <label className="form-field">
                <span>FPS</span>
                <select
                  value={screenSettings.fps}
                  onChange={(e) =>
                    onScreenSettingsChange({
                      ...screenSettings,
                      fps: Number(e.target.value) as 30 | 60,
                    })
                  }
                >
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </label>

              <label className="form-field">
                <span>Приоритет</span>
                <select
                  value={screenSettings.contentHint}
                  onChange={(e) =>
                    onScreenSettingsChange({
                      ...screenSettings,
                      contentHint: e.target.value as 'motion' | 'detail',
                    })
                  }
                >
                  <option value="motion">Игры / Видео (motion)</option>
                  <option value="detail">Текст / Код (detail)</option>
                </select>
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

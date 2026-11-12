import React, { useRef, useState } from 'react';
import { Headphones, Lock, Upload, Trash2 } from 'lucide-react';
import { Avatar } from './Avatar';
import { processAvatarFile } from '../utils/avatar';

interface JoinScreenProps {
  initialRoomId: string;
  initialNickname: string;
  initialAvatar: string | null;
  passwordRequired: boolean;
  joining: boolean;
  error: string | null;
  onJoin: (params: {
    roomId: string;
    nickname: string;
    avatar: string | null;
    password?: string;
  }) => void;
}

export const JoinScreen: React.FC<JoinScreenProps> = ({
  initialRoomId,
  initialNickname,
  initialAvatar,
  passwordRequired,
  joining,
  error,
  onJoin,
}) => {
  const [nickname, setNickname] = useState(initialNickname);
  const [roomId, setRoomId] = useState(initialRoomId);
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState<string | null>(initialAvatar);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarErr(null);
    try {
      const dataUrl = await processAvatarFile(file);
      setAvatar(dataUrl);
      localStorage.setItem('discord_online_avatar', dataUrl);
    } catch (err) {
      setAvatarErr(err instanceof Error ? err.message : 'Ошибка загрузки аватарки');
    }
  };

  const handleRemoveAvatar = () => {
    setAvatar(null);
    localStorage.removeItem('discord_online_avatar');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('discord_online_nickname', nickname.trim());
    onJoin({
      roomId: roomId.trim(),
      nickname: nickname.trim(),
      avatar,
      password: passwordRequired ? password : undefined,
    });
  };

  return (
    <div className="join-page">
      <div className="join-card">
        <div className="join-header">
          <div className="join-logo">
            <Headphones size={28} />
          </div>
          <h1>DiscordOnline</h1>
          <p>Голосовая комната для друзей (до 5 человек)</p>
        </div>

        <form onSubmit={handleSubmit} className="join-form">
          <div className="join-avatar-row">
            <Avatar nickname={nickname || 'Друг'} avatar={avatar} size={64} />
            <div className="join-avatar-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={14} /> Загрузить аватарку
              </button>
              {avatar && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={handleRemoveAvatar}
                  title="Удалить аватарку"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleAvatarChange}
              />
            </div>
          </div>
          {avatarErr && <div className="form-error">{avatarErr}</div>}

          <label className="form-field">
            <span>Никнейм</span>
            <input
              type="text"
              required
              maxLength={24}
              placeholder="Например, Alex"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>

          <label className="form-field">
            <span>Код комнаты</span>
            <input
              type="text"
              required
              maxLength={32}
              pattern="[a-zA-Z0-9_-]{2,32}"
              placeholder="например, squad-1"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
          </label>

          {passwordRequired && (
            <label className="form-field">
              <span>
                <Lock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Пароль комнаты
              </span>
              <input
                type="password"
                required
                placeholder="Введите общий пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="btn btn--primary btn--full" disabled={joining}>
            {joining ? 'Подключение...' : 'Войти в комнату'}
          </button>
        </form>
      </div>
    </div>
  );
};

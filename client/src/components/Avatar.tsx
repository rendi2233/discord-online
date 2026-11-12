import React from 'react';
import { getAvatarColor, getInitials } from '../utils/avatar';

interface AvatarProps {
  nickname: string;
  avatar: string | null;
  size?: number;
  speaking?: boolean;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  nickname,
  avatar,
  size = 36,
  speaking = false,
  className = '',
}) => {
  const bg = getAvatarColor(nickname);
  const initials = getInitials(nickname);

  return (
    <div
      className={`avatar ${speaking ? 'avatar--speaking' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        backgroundColor: avatar ? 'transparent' : bg,
        fontSize: Math.max(11, Math.round(size * 0.38)),
      }}
      title={nickname}
    >
      {avatar ? (
        <img src={avatar} alt={nickname} className="avatar__img" />
      ) : (
        <span className="avatar__initials">{initials}</span>
      )}
    </div>
  );
};

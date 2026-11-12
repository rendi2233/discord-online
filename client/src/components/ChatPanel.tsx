import React, { useEffect, useRef, useState } from 'react';
import { Send, Image as ImageIcon, X } from 'lucide-react';
import type { ChatMessage } from '../types';
import { Avatar } from './Avatar';
import { processChatImageFile } from '../utils/avatar';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string, image?: string | null) => Promise<{ ok: boolean; error?: string }>;
}

const URL_REGEX = /(https?:\/\/[^\s<]+)/g;

function renderTextWithLinks(text: string): React.ReactNode {
  const parts = text.split(URL_REGEX);
  return parts.map((part, idx) => {
    if (part.match(/^https?:\/\//)) {
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="chat-link"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ messages, onSend }) => {
  const [text, setText] = useState('');
  const [pastedImage, setPastedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        try {
          setError(null);
          const dataUrl = await processChatImageFile(file);
          setPastedImage(dataUrl);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Ошибка вставки изображения');
        }
        break;
      }
    }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setError(null);
      const dataUrl = await processChatImageFile(file);
      setPastedImage(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки изображения');
    }
    e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!text.trim() && !pastedImage) || sending) return;
    setSending(true);
    setError(null);
    const res = await onSend(text.trim(), pastedImage);
    setSending(false);
    if (!res.ok) {
      setError(res.error ?? 'Ошибка отправки');
      return;
    }
    setText('');
    setPastedImage(null);
  };

  return (
    <aside className="chat-panel">
      <div className="panel-header">
        <span>Текстовый чат</span>
        <span className="badge">{messages.length}/100</span>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">Сообщений пока нет. Напишите что-нибудь или вставьте картинку (Ctrl+V).</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="chat-msg">
            <Avatar nickname={m.nickname} avatar={m.avatar} size={32} />
            <div className="chat-msg__body">
              <div className="chat-msg__meta">
                <span className="chat-msg__author">{m.nickname}</span>
                <span className="chat-msg__time">{formatTime(m.timestamp)}</span>
              </div>
              {m.text && <div className="chat-msg__text">{renderTextWithLinks(m.text)}</div>}
              {m.image && (
                <a href={m.image} target="_blank" rel="noopener noreferrer">
                  <img src={m.image} alt="Вложение" className="chat-msg__image" />
                </a>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {pastedImage && (
        <div className="chat-preview">
          <img src={pastedImage} alt="Предпросмотр" />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setPastedImage(null)}
            title="Убрать изображение"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {error && <div className="chat-error">{error}</div>}

      <form onSubmit={handleSubmit} className="chat-input-row">
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={() => fileRef.current?.click()}
          title="Прикрепить картинку"
        >
          <ImageIcon size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFilePick}
        />
        <input
          type="text"
          placeholder="Написать в чат... (Ctrl+V для картинки)"
          value={text}
          maxLength={2000}
          onPaste={handlePaste}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn--primary btn--icon" disabled={sending}>
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
};

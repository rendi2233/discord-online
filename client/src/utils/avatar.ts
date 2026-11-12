const AVATAR_COLORS = [
  '#5865f2',
  '#3ba55c',
  '#faa61a',
  '#eb459e',
  '#ed4245',
  '#00a8fc',
  '#9b59b6',
  '#e67e22',
];

export function getAvatarColor(nickname: string): string {
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = nickname.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function getInitials(nickname: string): string {
  const parts = nickname.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const MAX_AVATAR_BYTES_BASE64 = 68_000; // ~50 KB binary

/**
 * Crops image to center square, resizes to 128x128, compresses to WebP/JPEG <= ~50 KB.
 */
export function processAvatarFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Некорректный формат изображения.'));
      img.onload = () => {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas не поддерживается.'));
          return;
        }

        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

        // Try WebP first, then JPEG, lowering quality if needed
        const formats: Array<'image/webp' | 'image/jpeg'> = ['image/webp', 'image/jpeg'];
        for (const fmt of formats) {
          for (const q of [0.85, 0.7, 0.55, 0.4]) {
            const dataUrl = canvas.toDataURL(fmt, q);
            if (dataUrl.startsWith(`data:${fmt}`) && dataUrl.length <= MAX_AVATAR_BYTES_BASE64) {
              resolve(dataUrl);
              return;
            }
          }
        }
        reject(new Error('Не удалось сжать аватарку до 50 КБ.'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Compresses pasted chat image to fit within ~450 KB.
 */
export function processChatImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Некорректное изображение.'));
      img.onload = () => {
        const maxDim = 1280;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas error'));
        ctx.drawImage(img, 0, 0, width, height);

        for (const q of [0.82, 0.65, 0.45]) {
          const dataUrl = canvas.toDataURL('image/webp', q);
          if (dataUrl.length <= 700_000) {
            resolve(dataUrl);
            return;
          }
        }
        const fallback = canvas.toDataURL('image/jpeg', 0.5);
        if (fallback.length <= 700_000) {
          resolve(fallback);
        } else {
          reject(new Error('Изображение слишком большое для чата.'));
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

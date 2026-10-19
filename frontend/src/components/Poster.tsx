import { useState } from 'react';

function hue(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Poster image with a generated placeholder when there is no URL or the image fails to load. */
export default function Poster({ title, url, size = 'md' }: { title: string; url: string | null; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return <img className={`poster poster-${size}`} src={url} alt={`${title} poster`} loading="lazy" onError={() => setFailed(true)} />;
  }
  const h = hue(title);
  return (
    <div
      className={`poster poster-${size} poster-fallback`}
      style={{ background: `linear-gradient(160deg, hsl(${h} 55% 32%), hsl(${(h + 50) % 360} 60% 14%))` }}
      role="img"
      aria-label={`${title} (no poster)`}
    >
      <span>{title}</span>
    </div>
  );
}

export interface PosterOptions {
  title: string;
  year: number;
  type: string;
  releaseType: string;
  sourceUrl: string;
  provider: string;
}

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text: string, maxCharsPerLine = 18, maxLines = 4): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }
  return lines;
}

export function generateCustomPoster(options: PosterOptions): string {
  const title = options.title || 'Unknown Release';
  const year = options.year || new Date().getFullYear();
  const type = options.type || 'Movie';
  const releaseType = options.releaseType || 'WEB-DL';
  const sourceUrl = options.sourceUrl || '';
  const provider = options.provider || 'Media Feed';

  const isSeries = type.toLowerCase() === 'series';
  const typeBadge = isSeries ? '📺 SERIES' : '🎬 MOVIE';
  const accentColor = isSeries ? '#a855f7' : '#3b82f6';
  const badgeBg = isSeries ? '#3b0764' : '#1e3a8a';

  const lines = wrapText(title, 18, 4);
  const lineYStart = 280 - (lines.length * 20);

  const titleTspans = lines.map((line, idx) => {
    const y = lineYStart + (idx * 48);
    return `<text x="250" y="${y}" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="36" fill="#ffffff" text-anchor="middle" letter-spacing="-0.5">${escapeXml(line)}</text>`;
  }).join('\n');

  const displayUrl = sourceUrl.length > 42 ? sourceUrl.substring(0, 39) + '...' : sourceUrl;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 750" width="500" height="750">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#090d16" />
        <stop offset="50%" stop-color="#111827" />
        <stop offset="100%" stop-color="#030712" />
      </linearGradient>
      <linearGradient id="overlay" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.2" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0.8" />
      </linearGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="16" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>

    <!-- Background -->
    <rect width="500" height="750" fill="url(#bg)" />
    <rect width="500" height="750" fill="url(#overlay)" />

    <!-- Outer Frame -->
    <rect x="18" y="18" width="464" height="714" rx="16" fill="none" stroke="${accentColor}" stroke-opacity="0.4" stroke-width="2" />
    <rect x="26" y="26" width="448" height="698" rx="12" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1" />

    <!-- Top Badge -->
    <g transform="translate(250, 75)">
      <rect x="-95" y="-18" width="190" height="36" rx="18" fill="${badgeBg}" stroke="${accentColor}" stroke-width="1.5" />
      <text x="0" y="5" font-family="system-ui, sans-serif" font-weight="700" font-size="13" fill="#e0e7ff" text-anchor="middle" letter-spacing="1">${escapeXml(typeBadge)} • ${year}</text>
    </g>

    <!-- Glowing Accent Circle -->
    <circle cx="250" cy="290" r="110" fill="${accentColor}" opacity="0.18" filter="url(#glow)" />

    <!-- Title Lines -->
    ${titleTspans}

    <!-- Quality Tag Badge -->
    <g transform="translate(250, 480)">
      <rect x="-85" y="-18" width="170" height="36" rx="10" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5" />
      <text x="0" y="5" font-family="system-ui, sans-serif" font-weight="700" font-size="14" fill="#38bdf8" text-anchor="middle" letter-spacing="0.5">🏷️ ${escapeXml(releaseType)}</text>
    </g>

    <!-- File Info & Source Link Box -->
    <rect x="40" y="540" width="420" height="135" rx="12" fill="#030712" fill-opacity="0.8" stroke="#1e293b" stroke-width="1.5" />
    
    <text x="60" y="570" font-family="system-ui, sans-serif" font-weight="700" font-size="11" fill="#94a3b8" letter-spacing="0.5">📁 FILE NAME:</text>
    <text x="60" y="592" font-family="system-ui, monospace" font-weight="600" font-size="13" fill="#f8fafc">${escapeXml(title.length > 42 ? title.substring(0, 39) + '...' : title)}</text>

    <line x1="60" y1="608" x2="440" y2="608" stroke="#1e293b" stroke-width="1" />

    <text x="60" y="630" font-family="system-ui, sans-serif" font-weight="700" font-size="11" fill="#94a3b8" letter-spacing="0.5">🔗 SOURCE LINK:</text>
    <text x="60" y="652" font-family="system-ui, monospace" font-weight="500" font-size="12" fill="#38bdf8">${escapeXml(displayUrl)}</text>

    <!-- Footer -->
    <text x="250" y="708" font-family="system-ui, sans-serif" font-weight="600" font-size="11" fill="#64748b" text-anchor="middle" letter-spacing="1">🎬 ${escapeXml(provider.toUpperCase())} • RELEASE RADAR</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

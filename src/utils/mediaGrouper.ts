export interface ReleaseItem {
  id: number;
  title: string;
  year: number;
  type: string;
  provider: string;
  sourceUrl: string;
  releaseType: string;
  seeders?: number;
  leechers?: number;
  poster: string | null;
  metadataJson: any | null;
  createdAt: string;
}

export interface MediaGroup {
  groupKey: string;
  canonicalTitle: string;
  year: number;
  type: string;
  poster: string | null;
  metadata: any | null;
  latestCreatedAt: string;
  releases: ReleaseItem[];
  availableQualities: string[];
  topSeeders: number;
  totalSeeders: number;
  totalLeechers: number;
}

export function cleanReleaseTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  let title = rawTitle.replace(/[._]/g, ' ');
  
  // Remove 4-digit year if inside parentheses or brackets e.g. (2023) or [2023]
  title = title.replace(/[\(\[\{]\s*(19\d\d|20\d\d)\s*[\)\]\}]/g, ' ');
  
  // Also remove year if preceded by word and followed by S01/Season/Quality
  title = title.replace(/\b(19\d\d|20\d\d)\b(?=\s*(?:S\d|Season|720p|1080p|2160p|4k|WEB|BluRay|HDTV))/i, ' ');
  
  // Standardize S01E01 / Season 1 Episode 1 spacing/formatting in title
  title = title.replace(/season\s*0*(\d+)\s*episode\s*0*(\d+)/gi, (m, s, e) => `S${s.padStart(2,'0')}E${e.padStart(2,'0')}`);
  title = title.replace(/season\s*0*(\d+)/gi, (m, s) => `S${s.padStart(2,'0')}`);
  title = title.replace(/episode\s*0*(\d+)/gi, (m, e) => `E${e.padStart(2,'0')}`);
  title = title.replace(/s0*(\d+)\s*e0*(\d+)/gi, (m, s, e) => `S${s.padStart(2,'0')}E${e.padStart(2,'0')}`);
  title = title.replace(/s0*(\d+)(?![e\d])/gi, (m, s) => `S${s.padStart(2,'0')}`);

  // Cut off at quality/resolution/encoding tags
  const splitMatch = title.split(/\b(720p|1080p|2160p|4k|WEB-DL|WEBRip|WEB|BluRay|HDTV|BrRip|DVDRip|XviD|x264|x265|HEVC|AAC|DDP5\.1|AMZN|ATVP|HMAX|NF|mSD|AFG)\b/i);
  title = splitMatch[0];
  
  // Clean empty parentheses/brackets leftover from year removal
  title = title.replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ');

  // Clean trailing/leading punctuation & extra spaces
  title = title.replace(/[\(\[\{:\-_.\s]+$/g, '')
               .replace(/^[\(\[\{:\-_.\s]+/g, '')
               .replace(/\s+/g, ' ')
               .trim();
               
  return title || rawTitle;
}

export function normalizeMediaTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  let title = rawTitle.replace(/[._]/g, ' ');

  // 1. Remove 4-digit years in parens/brackets e.g. (2023) or [2023] or standalone year
  title = title.replace(/[\(\[\{]\s*(19\d\d|20\d\d)\s*[\)\]\}]/g, ' ');
  title = title.replace(/\b(19\d\d|20\d\d)\b/g, ' ');

  // 2. Cut off at S01E01, S01, Season 1, Episode 1 patterns
  const tvMatch = title.match(/^(.*?)\b(S\d{1,2}E\d{1,2}|S\d{1,2}|Season\s*\d+|Episode\s*\d+)\b/i);
  if (tvMatch && tvMatch[1].trim().length > 0) {
    title = tvMatch[1].trim();
  }

  // 3. Cut off at quality/resolution/encoding/source tags
  const splitMatch = title.split(/\b(720p|1080p|2160p|4k|WEB-DL|WEBRip|WEB|BluRay|HDTV|HD|BrRip|DVDRip|XviD|x264|x265|HEVC|AAC|DDP5\.1|AMZN|ATVP|HMAX|NF|mSD|AFG|FLAC|TRUEHD|DTS)\b/i);
  title = splitMatch[0];

  // 4. Normalize Part numbers e.g. "Part Two" -> "Part 2", "Part II" -> "Part 2"
  title = title.replace(/\bpart\s+(?:two|ii)\b/gi, 'Part 2');
  title = title.replace(/\bpart\s+(?:one|i)\b/gi, 'Part 1');
  title = title.replace(/\bpart\s+(?:three|iii)\b/gi, 'Part 3');
  title = title.replace(/\bpart\s+(?:four|iv)\b/gi, 'Part 4');

  // 5. Strip scene descriptors, languages, edition, 3D/audio flags
  const sceneTags = [
    '3D', '2D', 'HSBS', 'OU', 'SBS', 'HOU', 'MULTi', 'VFi', 'VF', 'VOSTFR', 'TRUEFRENCH',
    'NORDiC', 'ENG', 'ENGLISH', 'GERMAN', 'SPANISH', 'iTA', 'ITALIAN', 'RUSSIAN', 'SWESUB', 'SWEDISH', 'DANISH', 'NORWEGIAN', 'FINNISH', 'FRENCH',
    'REPACK', 'PROPER', 'EXTENDED', 'UNRATED', 'DIRECTORS', 'CUT', 'THEATRICAL', 'REMUX', 'COMPLETE', 'DUAL', 'MULTI5',
    'READNFO', 'INTERNAL', 'SUBBED', 'CUSTOM', 'RERIP', 'HYBRID', 'HDR', 'HDR10', 'DV', 'DOLBY', 'VISION', 'LATIN'
  ];
  const tagRegex = new RegExp(`\\b(${sceneTags.join('|')})\\b`, 'gi');
  title = title.replace(tagRegex, ' ');

  // 6. Strip empty parens/brackets leftover from year/tag removal
  title = title.replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ');

  // 7. Clean trailing/leading punctuation & extra spaces
  title = title
    .replace(/[\(\[\{:\-_.\s]+$/g, '')
    .replace(/^[\(\[\{:\-_.\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return title || rawTitle;
}

export function getGroupKey(title: string, type?: string): string {
  const canonicalTitle = normalizeMediaTitle(title);
  const cleanTitleKey = canonicalTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleanTitleKey || 'unknown';
}

export function getReleaseSeedsAndLeeches(rel: ReleaseItem): { seeders: number; leechers: number } {
  return {
    seeders: rel.seeders || 0,
    leechers: rel.leechers || 0
  };
}

export function groupReleases(releases: ReleaseItem[]): MediaGroup[] {
  const groupsMap = new Map<string, MediaGroup>();

  for (const rel of releases) {
    const canonicalTitle = normalizeMediaTitle(rel.title);
    
    // Group key based purely on canonical clean title so all releases for the same show/movie group into 1 poster
    const cleanTitleKey = canonicalTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    const groupKey = cleanTitleKey || 'unknown';

    let group = groupsMap.get(groupKey);

    if (!group) {
      group = {
        groupKey,
        canonicalTitle: (rel.title && !rel.title.includes('1080p') && !rel.title.includes('720p') && !rel.title.includes('x265')) 
          ? rel.title 
          : canonicalTitle,
        year: rel.year,
        type: rel.type || 'Movie',
        poster: rel.poster || null,
        metadata: rel.metadataJson || null,
        latestCreatedAt: rel.createdAt,
        releases: [],
        availableQualities: [],
        topSeeders: 0,
        totalSeeders: 0,
        totalLeechers: 0,
      };
      groupsMap.set(groupKey, group);
    }

    // Ensure group type becomes Series if any release indicates TV series
    if (rel.type === 'Series' || rel.type === 'TV Series' || /S\d|Season|Episode/i.test(rel.title)) {
      group.type = 'Series';
    }

    // Unpack downloads array if stored in metadataJson.downloads
    const downloadsList: any[] = Array.isArray(rel.metadataJson?.downloads) && rel.metadataJson.downloads.length > 0
      ? rel.metadataJson.downloads
      : [rel];

    for (const dl of downloadsList) {
      const itemRelease: ReleaseItem = {
        id: dl.id || rel.id,
        title: dl.title || rel.title,
        year: rel.year,
        type: rel.type,
        provider: dl.provider || rel.provider,
        sourceUrl: dl.sourceUrl || rel.sourceUrl,
        releaseType: dl.releaseType || rel.releaseType,
        seeders: dl.seeders !== undefined ? dl.seeders : (rel.seeders || 0),
        leechers: dl.leechers !== undefined ? dl.leechers : (rel.leechers || 0),
        poster: rel.poster,
        metadataJson: rel.metadataJson,
        createdAt: dl.createdAt || rel.createdAt
      };

      // Deduplicate by sourceUrl inside group
      const alreadyHas = group.releases.some(r => r.sourceUrl && itemRelease.sourceUrl && r.sourceUrl === itemRelease.sourceUrl);
      if (!alreadyHas) {
        group.releases.push(itemRelease);
        group.totalSeeders += itemRelease.seeders || 0;
        group.totalLeechers += itemRelease.leechers || 0;
        if ((itemRelease.seeders || 0) > group.topSeeders) {
          group.topSeeders = itemRelease.seeders || 0;
        }
        if (itemRelease.releaseType && !group.availableQualities.includes(itemRelease.releaseType)) {
          group.availableQualities.push(itemRelease.releaseType);
        }
      }
    }

    // Update poster if current group poster is null but this release has one
    if (!group.poster && rel.poster) {
      group.poster = rel.poster;
    }

    // Update metadata if current group metadata is null but this release has one
    if (!group.metadata && rel.metadataJson) {
      group.metadata = rel.metadataJson;
    }

    // Update latest timestamp if needed
    if (new Date(rel.createdAt) > new Date(group.latestCreatedAt)) {
      group.latestCreatedAt = rel.createdAt;
    }

    // Collect available qualities uniquely
    if (rel.releaseType && !group.availableQualities.includes(rel.releaseType)) {
      group.availableQualities.push(rel.releaseType);
    }
  }

  // Convert map to array and sort each group's releases by quality and date
  const qualityRank = (type: string) => {
    const l = (type || '').toLowerCase();
    if (l.includes('4k') || l.includes('2160p')) return 4;
    if (l.includes('1080p')) return 3;
    if (l.includes('bluray')) return 2;
    if (l.includes('720p')) return 1;
    return 0;
  };

  const result = Array.from(groupsMap.values()).map(group => {
    group.releases.sort((a, b) => {
      const qDiff = qualityRank(b.releaseType) - qualityRank(a.releaseType);
      if (qDiff !== 0) return qDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return group;
  });

  // Sort groups by latestCreatedAt desc
  result.sort((a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime());

  return result;
}

export function getStandardizedMatchKey(title: string): string {
  let t = title.toLowerCase();
  t = t.replace(/season\s*0*(\d+)\s*episode\s*0*(\d+)/gi, 's$1e$2');
  t = t.replace(/season\s*0*(\d+)/gi, 's$1');
  t = t.replace(/episode\s*0*(\d+)/gi, 'e$1');
  t = t.replace(/s0*(\d+)\s*e0*(\d+)/gi, 's$1e$2');
  t = t.replace(/s0*(\d+)(?![e\d])/gi, 's$1');
  
  t = t.replace(/s(\d+)e(\d+)/g, (m, s, e) => `s${s.padStart(2,'0')}e${e.padStart(2,'0')}`);
  t = t.replace(/s(\d+)(?![e\d])/g, (m, s) => `s${s.padStart(2,'0')}`);
  t = t.replace(/(?<!s\d{2})e(\d+)(?!\d)/g, (m, e) => `e${e.padStart(2,'0')}`);
  
  return t.replace(/[^a-z0-9]/g, '');
}

export function generateSearchQueries(title: string, mediaType?: string, year?: number): string[] {
  const queries = new Set<string>();
  
  const rawTitle = title.trim();
  if (!rawTitle) return [];
  queries.add(rawTitle);
  
  // 1. Remove 4-digit year in brackets/parens/standalone
  const titleWithoutYear = rawTitle
    .replace(/[\(\[\{]\s*(19\d\d|20\d\d)\s*[\)\]\}]/g, ' ')
    .replace(/\b(19\d\d|20\d\d)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (titleWithoutYear && titleWithoutYear !== rawTitle) {
    queries.add(titleWithoutYear);
  }

  // 2. Clean special characters into spaces (e.g. "Spider-Man: Brand New Day" -> "Spider-Man Brand New Day" & "Spider Man Brand New Day")
  const cleanSpacedTitle = (titleWithoutYear || rawTitle)
    .replace(/[:_.,/\\!?'"@#$%^&*+=\-[\](){}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  if (cleanSpacedTitle) {
    queries.add(cleanSpacedTitle);
  }

  // 3. Add Title + Year if year is present
  if (year && year > 1900) {
    if (cleanSpacedTitle) queries.add(`${cleanSpacedTitle} ${year}`);
    if (titleWithoutYear) queries.add(`${titleWithoutYear} ${year}`);
  }

  const isSeries = mediaType?.toLowerCase() === 'series' || 
                   /season|episode|s\d{1,2}e\d{1,2}|s\d{1,2}/i.test(rawTitle);
  
  const baseTitle = normalizeMediaTitle(titleWithoutYear || rawTitle);

  if (isSeries && baseTitle) {
    queries.add(baseTitle);
    
    // Check if title has season/episode specifier
    const tvMatch = rawTitle.match(/\b(S\d{1,2}E\d{1,2}|S\d{1,2}|Season\s*\d+)\b/i);
    if (tvMatch) {
      const spec = tvMatch[1].toUpperCase();
      queries.add(`${baseTitle} ${spec}`);
      
      // If it's a specific episode, also search for the season
      const seasonMatch = spec.match(/S(\d{1,2})E(\d{1,2})/i);
      if (seasonMatch) {
        queries.add(`${baseTitle} S${seasonMatch[1]}`);
      }
    } else {
      // Add season queries for series to catch all latest seasons and episodes
      queries.add(`${baseTitle} S01`);
      queries.add(`${baseTitle} S02`);
      queries.add(`${baseTitle} S03`);
      queries.add(`${baseTitle} S04`);
      queries.add(`${baseTitle} S05`);
      queries.add(`${baseTitle} S06`);
      queries.add(`${baseTitle} Season`);
      queries.add(`${baseTitle} Complete`);
    }
  }
  
  return Array.from(queries).filter(q => q.length > 1);
}


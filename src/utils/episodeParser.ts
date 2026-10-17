export interface ParsedEpisode {
  hasEpisode: boolean;
  season: number | null;
  episode: number | null;
  isPack: boolean;
  code: string;        // e.g. "S02E01"
  groupKey: string;    // Uniform grouping key: "s02_e01"
  label: string;       // "Season 2 • Episode 1"
  sortPriority: number; // (season * 10000) + episode
}

/**
 * Parses any release title or releaseType text to accurately detect Season and Episode.
 * Unifies all formats: S02E01, Season 2 Episode 1, 2x01, Ep 1, E01, Season Packs.
 */
export function parseEpisodeInfo(rawTitle: string, rawType?: string): ParsedEpisode {
  const text = `${rawTitle || ''} ${rawType || ''}`.trim();
  if (!text) {
    return {
      hasEpisode: false,
      season: null,
      episode: null,
      isPack: false,
      code: 'Feature',
      groupKey: 'feature',
      label: 'Full Feature',
      sortPriority: 0,
    };
  }

  // 1. S01E02 or S1E2 or S01.E02 or S01_E02
  const sEPattern = /\bS0*(\d{1,3})[._\s\-]*E0*(\d{1,4})\b/i;
  const matchSE = text.match(sEPattern);
  if (matchSE) {
    const s = parseInt(matchSE[1], 10);
    const e = parseInt(matchSE[2], 10);
    const code = `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
    return {
      hasEpisode: true,
      season: s,
      episode: e,
      isPack: false,
      code,
      groupKey: `s${s}_e${e}`,
      label: `Season ${s} • Episode ${e}`,
      sortPriority: s * 10000 + e,
    };
  }

  // 2. Season 1 Episode 2 or Season 1 Ep 2
  const seasonEpPattern = /\bSeason\s*0*(\d{1,3})\s*[._\s\-]*\s*(?:Episode|Ep)\s*0*(\d{1,4})\b/i;
  const matchSeasonEp = text.match(seasonEpPattern);
  if (matchSeasonEp) {
    const s = parseInt(matchSeasonEp[1], 10);
    const e = parseInt(matchSeasonEp[2], 10);
    const code = `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
    return {
      hasEpisode: true,
      season: s,
      episode: e,
      isPack: false,
      code,
      groupKey: `s${s}_e${e}`,
      label: `Season ${s} • Episode ${e}`,
      sortPriority: s * 10000 + e,
    };
  }

  // 3. 1x02 (e.g. 7x26)
  const xPattern = /\b(\d{1,2})x0*(\d{1,4})\b/i;
  const matchX = text.match(xPattern);
  if (matchX) {
    const s = parseInt(matchX[1], 10);
    const e = parseInt(matchX[2], 10);
    const code = `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;
    return {
      hasEpisode: true,
      season: s,
      episode: e,
      isPack: false,
      code,
      groupKey: `s${s}_e${e}`,
      label: `Season ${s} • Episode ${e}`,
      sortPriority: s * 10000 + e,
    };
  }

  // 4. Season Pack: Season 1 Complete or S01 Complete or Season 1 Batch
  const packPattern = /\b(?:Season\s*0*(\d{1,3})|S0*(\d{1,3}))\s*(?:Complete|Pack|Batch|All\s*Episodes|Boxset|\bEntire\b)/i;
  const matchPack = text.match(packPattern);
  if (matchPack) {
    const s = parseInt(matchPack[1] || matchPack[2], 10);
    const code = `S${String(s).padStart(2, '0')} Pack`;
    return {
      hasEpisode: true,
      season: s,
      episode: null,
      isPack: true,
      code,
      groupKey: `s${s}_pack`,
      label: `Season ${s} Complete Pack`,
      sortPriority: s * 10000 + 9999, // Packs sort after single episodes of the same season
    };
  }

  // 5. Standalone Season (e.g. "Season 2" or "S02")
  const justSeasonPattern = /\b(?:Season\s*0*(\d{1,3})|S0*(\d{1,3}))\b(?!\s*E\d)/i;
  const matchJustSeason = text.match(justSeasonPattern);
  if (matchJustSeason && (text.toLowerCase().includes('pack') || text.toLowerCase().includes('📦') || text.toLowerCase().includes('complete'))) {
    const s = parseInt(matchJustSeason[1] || matchJustSeason[2], 10);
    const code = `S${String(s).padStart(2, '0')} Pack`;
    return {
      hasEpisode: true,
      season: s,
      episode: null,
      isPack: true,
      code,
      groupKey: `s${s}_pack`,
      label: `Season ${s} Pack`,
      sortPriority: s * 10000 + 9999,
    };
  }

  // 6. Standalone Episode e.g. "Episode 26", "Ep 26", "E26" (default Season 1)
  const standaloneEpPattern = /\b(?:Episode|Ep|E)\s*0*(\d{1,4})\b/i;
  const matchStandaloneEp = text.match(standaloneEpPattern);
  if (matchStandaloneEp) {
    const e = parseInt(matchStandaloneEp[1], 10);
    const code = `E${String(e).padStart(2, '0')}`;
    return {
      hasEpisode: true,
      season: 1,
      episode: e,
      isPack: false,
      code,
      groupKey: `s1_e${e}`,
      label: `Episode ${e}`,
      sortPriority: 10000 + e,
    };
  }

  // Fallback (Movie or feature release)
  return {
    hasEpisode: false,
    season: null,
    episode: null,
    isPack: false,
    code: 'Feature',
    groupKey: 'feature',
    label: 'Full Feature',
    sortPriority: 0,
  };
}

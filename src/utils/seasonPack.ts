export interface SeasonPackInfo {
  isPack: boolean;
  label?: string;
  seasonNumber?: number;
  seasonRange?: string; // e.g. "1-4"
}

export function detectSeasonPack(name: string): SeasonPackInfo {
  if (!name) return { isPack: false };

  // 1. Complete Series / All Seasons
  if (/\b(?:The[ ._-]*)?Complete[ ._-]*Series\b/i.test(name) || /\bAll[ ._-]*Seasons\b/i.test(name) || /\bSeries[ ._-]*Complete\b/i.test(name)) {
    return { isPack: true, label: 'Complete Series Pack' };
  }

  // 2. Multi-Season Ranges: S01-S04, S1-S4, S01-04, Season 1-4, Seasons 1 to 4, Seasons 1-3
  const multiSeasonMatch = name.match(/\bS(\d{1,2})[ ._-]*(?:to|-)[ ._-]*S?(\d{1,2})\b/i) ||
                          name.match(/\bSeasons?[ ._-]*(\d{1,2})[ ._-]*(?:to|-)[ ._-]*(\d{1,2})\b/i);
  if (multiSeasonMatch) {
    const sStart = parseInt(multiSeasonMatch[1], 10);
    const sEnd = parseInt(multiSeasonMatch[2], 10);
    return { 
      isPack: true, 
      label: `Seasons ${sStart}-${sEnd} Complete Pack`, 
      seasonNumber: sStart,
      seasonRange: `${sStart}-${sEnd}`
    };
  }

  // 3. Episode Ranges / Season Batches: S01E01-E10, S01E01-10, S01E01~E12, Season 1 Episodes 1-10
  const epRangeMatch = name.match(/\bS(\d{1,2})[ ._-]*E(\d{1,2})[ ._-]*(?:to|-|~)[ ._-]*E?(\d{1,2})\b/i) ||
                       name.match(/\bSeason[ ._-]*(\d{1,2})[ ._-]*Episodes?[ ._-]*(\d{1,2})[ ._-]*(?:to|-)[ ._-]*(\d{1,2})\b/i);
  if (epRangeMatch) {
    const sNum = parseInt(epRangeMatch[1], 10);
    const eStart = parseInt(epRangeMatch[2], 10);
    const eEnd = parseInt(epRangeMatch[3], 10);
    return { 
      isPack: true, 
      label: `Season ${sNum} (Episodes ${eStart}-${eEnd}) Pack`, 
      seasonNumber: sNum 
    };
  }

  // 4. Strict Single Episode Guard:
  // If it specifies an individual episode (and no batch range), it is 100% NOT a season pack!
  const isSingleEp = /\bS\d{1,2}[ ._-]*E\d{1,2}\b/i.test(name) ||
                     /\b\d{1,2}x\d{1,2}\b/i.test(name) ||
                     /\bSeason[ ._-]*\d{1,2}[ ._-]*(?:Episode|Ep)[ ._-]*\d{1,3}\b/i.test(name) ||
                     /\b(?:Episode|Ep)[ ._-]*\d{1,3}\b/i.test(name);
  if (isSingleEp) {
    return { isPack: false };
  }

  // 5. Written-out Ordinal Season Names: The Complete First Season, Complete Second Season, etc.
  const wordSeasonMatch = name.match(/\b(?:The[ ._-]*)?Complete[ ._-]*(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)[ ._-]*Season\b/i);
  if (wordSeasonMatch) {
    const ordinals: Record<string, number> = { 
      first: 1, second: 2, third: 3, fourth: 4, fifth: 5, 
      sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 
    };
    const sNum = ordinals[wordSeasonMatch[1].toLowerCase()] || 1;
    return { isPack: true, label: `Season ${sNum} Complete Pack`, seasonNumber: sNum };
  }

  // 6. Explicit Complete Season Keywords: Season 1 Complete, S01 Complete, Season 1 Pack, S01 Pack, Boxset, Discs 1-4, Full
  const explicitPackMatch = name.match(/\bSeason[ ._-]*(\d{1,2})[ ._-]*(?:COMPLETE|PACK|BOXSET|DISCS?|FULL|BATCH)\b/i) ||
                            name.match(/\bS(\d{1,2})[ ._-]*(?:COMPLETE|PACK|BOXSET|DISCS?|FULL|BATCH)\b/i) ||
                            name.match(/\bCOMPLETE[ ._-]*Season[ ._-]*(\d{1,2})\b/i) ||
                            name.match(/\b(?:Saison|Stagione|Staffel)[ ._-]*(\d{1,2})[ ._-]*(?:COMPLETE|PACK|INTEGRALE|COMPLETA)\b/i);
  if (explicitPackMatch) {
    const sNum = parseInt(explicitPackMatch[1], 10);
    return { isPack: true, label: `Season ${sNum} Complete Pack`, seasonNumber: sNum };
  }

  // 7. Standalone Season (The Universal Scene Standard: e.g. "Ted.Lasso.S01.1080p.BluRay.x265", "Slow.Horses.Season.1.1080p")
  // Since we already ruled out single episodes in Rule #4, having S01 or Season 1 with NO episode number indicates the full season!
  const standaloneMatch = name.match(/\bSeason[ ._-]*(\d{1,2})\b/i) ||
                          name.match(/\bS(\d{1,2})\b/i) ||
                          name.match(/\b(?:Saison|Stagione|Staffel)[ ._-]*(\d{1,2})\b/i);
  if (standaloneMatch) {
    const sNum = parseInt(standaloneMatch[1], 10);
    return { isPack: true, label: `Season ${sNum} Complete Pack`, seasonNumber: sNum };
  }

  // 8. General Batch / Full Season indicators
  if (/\b(?:COMPLETE[ ._-]*PACK|FULL[ ._-]*SEASON|SEASON[ ._-]*PACK|\[BATCH\])\b/i.test(name)) {
    return { isPack: true, label: 'Season Complete Pack' };
  }

  return { isPack: false };
}

export function extractEpisodeOrPack(name: string): string | undefined {
  if (!name) return undefined;

  // 1. Check if this is a Season Pack first
  const packInfo = detectSeasonPack(name);
  if (packInfo.isPack && packInfo.label) {
    return packInfo.label;
  }

  // 2. Season X Episode Y
  const fullMatch = name.match(/\bSeason[ ._-]*(\d{1,2})[ ._-]*(?:Episode|Ep)[ ._-]*(\d{1,2})\b/i);
  if (fullMatch) {
    return `S${fullMatch[1].padStart(2, '0')}E${fullMatch[2].padStart(2, '0')}`;
  }

  // 3. S01E06 or S1E6 or S01.E06 or S01_E06
  const epMatch = name.match(/\bS(\d{1,2})[ ._-]*E(\d{1,2})\b/i);
  if (epMatch) {
    return `S${epMatch[1].padStart(2, '0')}E${epMatch[2].padStart(2, '0')}`;
  }

  // 4. 4x09 or 04x09
  const xMatch = name.match(/\b(\d{1,2})x(\d{1,2})\b/i);
  if (xMatch) {
    return `S${xMatch[1].padStart(2, '0')}E${xMatch[2].padStart(2, '0')}`;
  }

  // 5. Episode 6 or Ep 06 (when season is omitted)
  const soloEpMatch = name.match(/\b(?:Episode|Ep)[ ._-]*(\d{1,3})\b/i);
  if (soloEpMatch) {
    return `E${soloEpMatch[1].padStart(2, '0')}`;
  }

  return undefined;
}

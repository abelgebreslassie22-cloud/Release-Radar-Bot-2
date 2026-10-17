export type MediaCategory = 'Movie' | 'Series' | 'Animation' | 'Anime' | 'Documentary';

export interface ClassifiableItem {
  id?: number | string;
  title?: string;
  type?: string;
  category?: string;
  metadataJson?: any;
}

export function normalizeCategoryName(cat?: string): string {
  const c = (cat || '').trim().toLowerCase();
  if (c === 'movies' || c === 'movie') return 'movie';
  if (c === 'series' || c === 'tv' || c === 'shows' || c === 'tv shows') return 'series';
  if (c === 'animations' || c === 'animation') return 'animation';
  if (c === 'animes' || c === 'anime') return 'anime';
  if (c === 'documentaries' || c === 'documentary') return 'documentary';
  return c;
}

/**
 * Accurately classifies any media title into one of 5 distinct categories:
 * 1. Anime: Japanese animated productions or explicitly tagged anime
 * 2. Animation: Non-Japanese animated productions (e.g. American & Western animation)
 * 3. Series: Live-action (non-animated) TV shows and series
 * 4. Movie: Live-action feature films
 * 5. Documentary: Documentaries and docuseries
 */
export function classifyMedia(item: ClassifiableItem): MediaCategory {
  if (!item) return 'Movie';

  // If already explicitly classified
  if (item.category) {
    const c = item.category.trim();
    if (['Movie', 'Series', 'Animation', 'Anime', 'Documentary'].includes(c)) {
      return c as MediaCategory;
    }
  }

  const meta = item.metadataJson || {};
  const genres = String(meta.genres || '').toLowerCase();
  const country = String(meta.country || meta.originCountry || '').toLowerCase();
  const lang = String(meta.language || meta.originalLanguage || '').toLowerCase();
  const rawType = String(item.type || '').toLowerCase();
  const title = String(item.title || '').toLowerCase();

  // 1. Documentary
  if (genres.includes('documentary') || rawType === 'documentary') {
    return 'Documentary';
  }

  // Check animation indicators
  const isAnimated = genres.includes('animation') || 
                     rawType === 'animation' || 
                     rawType === 'anime' ||
                     title.includes('the animated series') ||
                     title.includes('animated') ||
                     title.includes('anime');

  // Check Japanese origin indicators
  const isJapanese = country.includes('japan') || 
                     country.includes('jp') || 
                     lang.includes('japanese') || 
                     lang.includes('ja') ||
                     rawType === 'anime';

  // 2. Anime: Japanese animated productions or marked as anime
  if (rawType === 'anime' || genres.includes('anime') || (isAnimated && isJapanese)) {
    return 'Anime';
  }

  // 3. Animation: Non-Japanese / American animated productions (e.g. Arcane, Totally Spies!, Rick and Morty, The Simpsons)
  if (isAnimated) {
    return 'Animation';
  }

  // 4. Series: Live-action episodic television shows
  if (rawType.includes('series') || rawType.includes('tv') || rawType.includes('show')) {
    return 'Series';
  }

  // 5. Default: Live-action Movie
  return 'Movie';
}

/**
 * Checks whether an item matches a selected category filter.
 */
export function matchesCategory(item: ClassifiableItem, selectedCategory: string): boolean {
  if (!selectedCategory || selectedCategory === 'All') return true;

  const actualCategory = normalizeCategoryName(classifyMedia(item));
  const targetCategory = normalizeCategoryName(selectedCategory);
  return actualCategory === targetCategory;
}

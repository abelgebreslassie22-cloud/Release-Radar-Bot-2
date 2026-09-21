import Parser from 'rss-parser';
import { Provider, ReleaseItem } from '../types';

export class RSSProvider implements Provider {
  name = 'RSSProvider';
  url: string;
  parser: Parser;

  constructor(url: string) {
    this.url = url;
    this.parser = new Parser();
  }

  async initialize() {
    console.log(`RSSProvider initialized with URL: ${this.url}`);
  }

  async scan(): Promise<ReleaseItem[]> {
    if (!this.url) return [];
    
    try {
      const feed = await this.parser.parseURL(this.url);
      const items: ReleaseItem[] = [];

      for (const item of feed.items) {
        if (!item.title) continue;
        
        // Very basic parsing for demo: "Title (Year) [Quality]"
        // This is a naive implementation
        const match = item.title.match(/^(.*?)(?:\s*\((\d{4})\))?(?:\s*\[(.*?)\])?/);
        
        let title = item.title;
        let year = new Date().getFullYear();
        let releaseType = 'Web-DL';
        let type = 'Movie'; // Default

        if (match) {
          title = match[1].trim() || title;
          if (match[2]) year = parseInt(match[2], 10);
          if (match[3]) releaseType = match[3].trim();
        }

        // Determine type based on title (e.g., S01E01)
        if (/[sS]\d+[eE]\d+/.test(item.title) || /[sS]eason/.test(item.title)) {
          type = 'Series';
        }

        items.push({
          title,
          year,
          type,
          releaseType,
          sourceUrl: item.link || this.url,
        });
      }

      return items;
    } catch (e: any) {
      console.error('Failed to fetch RSS:', e);
      throw e;
    }
  }
}

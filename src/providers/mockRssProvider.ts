import { Provider, ReleaseItem } from '../types';

export class MockRSSProvider implements Provider {
  name = 'MockRSS';

  async initialize() {
    console.log('MockRSSProvider initialized');
  }

  async scan(): Promise<ReleaseItem[]> {
    console.log('Scanning MockRSSProvider...');
    // In a real application, this would fetch and parse an RSS feed or API.
    // Return empty array to avoid fake data
    return [];
  }
}

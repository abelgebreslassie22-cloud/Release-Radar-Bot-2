import { Provider } from '../types';
import { MockRSSProvider } from './mockRssProvider';
import { TMDBPremiereProvider } from './tmdbProvider';
import { DownloadRadarProvider } from './downloadRadarProvider';

export const providers: Provider[] = [
  new DownloadRadarProvider(),
  new TMDBPremiereProvider(),
  new MockRSSProvider(),
];

export { TMDBPremiereProvider, DownloadRadarProvider };

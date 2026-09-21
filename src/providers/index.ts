import { Provider } from '../types';
import { MockRSSProvider } from './mockRssProvider';
import { TMDBPremiereProvider } from './tmdbProvider';

export const providers: Provider[] = [
  new TMDBPremiereProvider(),
  new MockRSSProvider(),
];

export { TMDBPremiereProvider };

// Registers the live connector with the element. Imported first by `auto-live.ts`, so `<chartist-chart live>` can
// stream when the element is defined (its exported flag keeps a bundler from dropping the module).
import { connectLive } from '../live/connect';
import { setElementLive } from './index';

setElementLive(connectLive as never);
export const liveRegistered = true;

import { BlueBubblesPanel } from './src/renderer/components/BlueBubblesPanel.tsx';
import { BlueBubblesSettings } from './src/renderer/BlueBubblesSettings.tsx';

export function register(env) {
  globalThis.React = env.React;

  env.registerComponents('bluebubbles', {
    BlueBubblesPanel,
    BlueBubblesSettings,
  });
}

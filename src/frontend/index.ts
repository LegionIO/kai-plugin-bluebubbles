import { PanelView } from './components/PanelView.tsx';
import { SettingsView } from './components/SettingsView.tsx';

export function register(env) {
  globalThis.React = env.React;

  env.registerComponents('bluebubbles', {
    PanelView,
    SettingsView,
  });
}

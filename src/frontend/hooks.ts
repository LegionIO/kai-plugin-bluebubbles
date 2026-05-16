import { useState, useEffect } from 'react';

export type PluginComponentProps<
  TState = Record<string, unknown>,
  TConfig = Record<string, unknown>,
> = {
  pluginName: string;
  pluginState?: TState;
  pluginConfig?: TConfig;
  setPluginConfig?: (path: string, value: unknown) => Promise<void>;
  onAction: (action: string, data?: unknown) => void;
  onClose?: () => void;
  props?: Record<string, unknown>;
};

/**
 * Detects dark mode by observing the `.dark` class on document.documentElement
 * (Kai Desktop's theming mechanism) or via prefers-color-scheme media query.
 */
export function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    // Observe class changes on <html> element for Kai's .dark toggle
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Also listen to system preference changes
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      // Only use media query if .dark class isn't explicitly set
      if (!document.documentElement.classList.contains('dark') &&
          !document.documentElement.classList.contains('light')) {
        setIsDark(mql.matches);
      }
    };
    mql.addEventListener('change', handler);

    return () => {
      observer.disconnect();
      mql.removeEventListener('change', handler);
    };
  }, []);

  return isDark;
}

const R = () => (globalThis as any).React;

export const useState: typeof import('react').useState = (...args: any[]) => R().useState(...args);
export const useEffect: typeof import('react').useEffect = (...args: any[]) => R().useEffect(...args);
export const useCallback: typeof import('react').useCallback = (...args: any[]) => R().useCallback(...args);
export const useMemo: typeof import('react').useMemo = (...args: any[]) => R().useMemo(...args);
export const useRef: typeof import('react').useRef = (...args: any[]) => R().useRef(...args);
export const Fragment: typeof import('react').Fragment = (() => R().Fragment) as any;

export function createElement(...args: any[]) {
  return R().createElement(...args);
}

const h = (...args: any[]) => (globalThis as any).React.createElement(...args);

type IconProps = { className?: string };

const svgBase = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '2',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  width: '24',
  height: '24',
};

export function SendIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('path', { d: 'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z' }),
    h('path', { d: 'M21.854 2.147l-10.94 10.939' }),
  );
}

export function SearchIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('circle', { cx: '11', cy: '11', r: '8' }),
    h('path', { d: 'm21 21-4.3-4.3' }),
  );
}

export function XIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('path', { d: 'M18 6 6 18' }),
    h('path', { d: 'm6 6 12 12' }),
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('path', { d: 'm15 18-6-6 6-6' }),
  );
}

export function CheckIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('path', { d: 'M20 6 9 17l-5-5' }),
  );
}

export function CheckCheckIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('path', { d: 'M18 6 7 17l-5-5' }),
    h('path', { d: 'm22 10-7.5 7.5L13 16' }),
  );
}

export function HeartIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' }),
  );
}

export function ThumbsUpIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('path', { d: 'M7 10v12' }),
    h('path', { d: 'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z' }),
  );
}

export function ThumbsDownIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('path', { d: 'M17 14V2' }),
    h('path', { d: 'M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z' }),
  );
}

export function LaughIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('circle', { cx: '12', cy: '12', r: '10' }),
    h('path', { d: 'M18 13a6 6 0 0 1-6 5 6 6 0 0 1-6-5h12Z' }),
    h('line', { x1: '9', y1: '9', x2: '9.01', y2: '9' }),
    h('line', { x1: '15', y1: '9', x2: '15.01', y2: '9' }),
  );
}

export function ExclamationIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('path', { d: 'M12 16h.01' }),
    h('path', { d: 'M12 8v4' }),
    h('circle', { cx: '12', cy: '12', r: '10' }),
  );
}

export function QuestionIcon({ className }: IconProps) {
  return h('svg', { ...svgBase, className },
    h('circle', { cx: '12', cy: '12', r: '10' }),
    h('path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }),
    h('path', { d: 'M12 17h.01' }),
  );
}

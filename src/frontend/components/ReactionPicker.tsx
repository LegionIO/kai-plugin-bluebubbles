import {
  HeartIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  LaughIcon,
  ExclamationIcon,
  QuestionIcon,
} from '../icons';

const h = (...args: any[]) => (globalThis as any).React.createElement(...args);

type ReactionPickerProps = {
  onSelect: (reaction: string) => void;
  onClose: () => void;
};

const REACTIONS = [
  { type: 'love', icon: HeartIcon, label: 'Love' },
  { type: 'like', icon: ThumbsUpIcon, label: 'Like' },
  { type: 'dislike', icon: ThumbsDownIcon, label: 'Dislike' },
  { type: 'laugh', icon: LaughIcon, label: 'Laugh' },
  { type: 'emphasize', icon: ExclamationIcon, label: 'Emphasize' },
  { type: 'question', icon: QuestionIcon, label: 'Question' },
];

export function ReactionPicker({ onSelect, onClose }: ReactionPickerProps) {
  return h('div', { className: 'flex items-center gap-0.5 rounded-full border border-border/50 bg-card shadow-lg px-2 py-1.5 my-1' },
    REACTIONS.map((r) =>
      h('button', {
        key: r.type,
        type: 'button',
        title: r.label,
        onClick: () => onSelect(r.type),
        className: 'flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground',
      },
        h(r.icon, { className: 'h-4 w-4' }),
      ),
    ),
    h('button', {
      type: 'button',
      onClick: onClose,
      className: 'ml-1 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/50 hover:bg-muted/50 hover:text-muted-foreground',
    }, '\u00D7'),
  );
}

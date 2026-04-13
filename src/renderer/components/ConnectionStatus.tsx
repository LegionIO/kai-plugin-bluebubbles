const h = (...args: any[]) => (globalThis as any).React.createElement(...args);

type ConnectionStatusProps = {
  status: string;
  error: string | null;
};

export function ConnectionStatus({ status, error }: ConnectionStatusProps) {
  const dotColor =
    status === 'connected' ? 'bg-green-500' :
    status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
    status === 'error' ? 'bg-red-500' :
    'bg-muted-foreground/30';

  const label =
    status === 'connected' ? 'Connected' :
    status === 'connecting' ? 'Connecting...' :
    status === 'error' ? 'Connection error' :
    'Disconnected';

  return h('div', { className: 'flex items-center gap-2 border-b border-border/50 px-4 py-2.5' },
    h('div', { className: `h-2 w-2 rounded-full ${dotColor}` }),
    h('span', { className: 'text-xs text-muted-foreground' }, label),
    error
      ? h('span', {
          className: 'ml-auto text-[10px] text-red-400 truncate max-w-[150px]',
          title: error,
        }, error)
      : null,
  );
}

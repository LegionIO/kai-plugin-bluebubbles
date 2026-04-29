import React from 'react';

type EmptyStateProps = {
  connected: boolean;
  loading: boolean;
};

export function EmptyState({ connected, loading }: EmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mb-3 text-4xl opacity-20">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="mx-auto h-16 w-16"
          >
            <g transform="translate(24,0) scale(-1,1)">
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            </g>
          </svg>
        </div>
        <h3 className="text-sm font-medium text-muted-foreground">
          {loading
            ? 'Loading conversations...'
            : connected
              ? 'Select a conversation'
              : 'Configure BlueBubbles in Settings'}
        </h3>
        {!connected && !loading ? (
          <p className="mt-1 text-xs text-muted-foreground/60">
            Set your server URL and password to get started
          </p>
        ) : null}
      </div>
    </div>
  );
}

import React from 'react';

type AttachmentPreviewProps = {
  attachment: {
    guid: string;
    mimeType: string;
    filename: string;
    totalBytes: number;
    width?: number;
    height?: number;
    downloadUrl: string;
  };
  onLoad?: () => void;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPreview({ attachment, onLoad }: AttachmentPreviewProps) {
  const isImage = attachment.mimeType.startsWith('image/');
  const isVideo = attachment.mimeType.startsWith('video/');

  if (isImage) {
    return (
      <div className="mt-1">
        <img
          src={attachment.downloadUrl}
          alt={attachment.filename}
          className="max-w-full rounded-lg max-h-64 object-contain"
          loading="lazy"
          onLoad={onLoad}
        />
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="mt-1">
        <video
          src={attachment.downloadUrl}
          controls
          className="max-w-full rounded-lg max-h-64"
          preload="metadata"
          onLoadedMetadata={onLoad}
        />
      </div>
    );
  }

  return (
    <a
      href={attachment.downloadUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs transition-colors hover:bg-white/20"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-4 w-4 flex-shrink-0"
      >
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
      <div className="min-w-0">
        <div className="truncate font-medium">{attachment.filename}</div>
        <div className="text-[10px] opacity-60">{formatFileSize(attachment.totalBytes)}</div>
      </div>
    </a>
  );
}

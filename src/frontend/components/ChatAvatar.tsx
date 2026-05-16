import React from 'react';

const AVATAR_COLORS = [
  '#007AFF', // blue
  '#34C759', // green
  '#FF9500', // orange
  '#AF52DE', // purple
  '#FF2D55', // pink
  '#5AC8FA', // light blue
  '#FF3B30', // red
  '#5856D6', // indigo
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  return name
    .split(/[\s,]+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || '?';
}

function getColorForAddress(address: string): string {
  return AVATAR_COLORS[hashCode(address) % AVATAR_COLORS.length];
}

type Participant = {
  address: string;
  displayName: string;
};

type ChatAvatarProps = {
  chat: {
    isGroup: boolean;
    participants: Participant[];
    service: 'iMessage' | 'SMS';
    displayName: string;
    guid: string;
  };
  contactPhotos: Record<string, string>;
  size?: number;
};

/** Single circle — photo or initials */
function AvatarCircle({
  participant,
  photo,
  size,
  fontSize,
  border,
  serviceColor,
}: {
  participant: Participant;
  photo: string | null;
  size: number;
  fontSize: number;
  border?: boolean;
  serviceColor?: string;
}) {
  const bgColor = serviceColor ?? getColorForAddress(participant.address);
  const initials = getInitials(participant.displayName);

  if (photo) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          border: border ? '1.5px solid var(--color-background, #fff)' : undefined,
        }}
      >
        <img
          src={photo}
          alt={participant.displayName}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: bgColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize,
        fontWeight: 600,
        color: '#fff',
        border: border ? '1.5px solid var(--color-background, #fff)' : undefined,
      }}
    >
      {initials}
    </div>
  );
}

/** Layout positions for inner circles */
type CirclePosition = { top: number; left: number };

function getLayout(count: number, containerSize: number): { positions: CirclePosition[]; circleSize: number } {
  if (count === 2) {
    const circleSize = Math.round(containerSize * 0.65);
    const offset = containerSize - circleSize;
    return {
      circleSize,
      positions: [
        { top: 0, left: 0 },
        { top: offset, left: offset },
      ],
    };
  }

  if (count === 3) {
    const circleSize = Math.round(containerSize * 0.54);
    const centerX = (containerSize - circleSize) / 2;
    const bottomY = containerSize - circleSize;
    return {
      circleSize,
      positions: [
        { top: 0, left: centerX },
        { top: bottomY, left: 0 },
        { top: bottomY, left: containerSize - circleSize },
      ],
    };
  }

  // 4+ uses 2x2 grid
  const gap = 2;
  const circleSize = Math.round((containerSize - gap) / 2);
  return {
    circleSize,
    positions: [
      { top: 0, left: 0 },
      { top: 0, left: circleSize + gap },
      { top: circleSize + gap, left: 0 },
      { top: circleSize + gap, left: circleSize + gap },
    ],
  };
}

export function ChatAvatar({ chat, contactPhotos, size = 40 }: ChatAvatarProps) {
  const participants = chat.participants ?? [];

  // Single / 1:1 chat
  if (!chat.isGroup || participants.length <= 1) {
    const participant = participants[0] ?? { address: '', displayName: chat.displayName };
    const photo = contactPhotos[participant.address] ?? null;
    const serviceColor = photo ? undefined : (chat.service === 'iMessage' ? '#3b82f6' : '#22c55e');

    return (
      <AvatarCircle
        participant={participant}
        photo={photo}
        size={size}
        fontSize={size * 0.3}
        serviceColor={serviceColor}
      />
    );
  }

  // Group chat: sort so participants with photos come first
  const sorted = [...participants].sort((a, b) => {
    const aHasPhoto = contactPhotos[a.address] ? 1 : 0;
    const bHasPhoto = contactPhotos[b.address] ? 1 : 0;
    if (bHasPhoto !== aHasPhoto) return bHasPhoto - aHasPhoto;
    return a.displayName.localeCompare(b.displayName);
  });

  const totalCount = sorted.length;
  const displayCount = Math.min(totalCount, 4);
  const showOverflow = totalCount > 4;
  const visibleParticipants = showOverflow ? sorted.slice(0, 3) : sorted.slice(0, displayCount);
  const layoutCount = showOverflow ? 4 : displayCount;

  const { positions, circleSize } = getLayout(layoutCount, size);
  const innerFontSize = Math.max(7, Math.round(circleSize * 0.38));

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {visibleParticipants.map((participant, i) => (
        <div
          key={participant.address}
          style={{
            position: 'absolute',
            top: positions[i].top,
            left: positions[i].left,
          }}
        >
          <AvatarCircle
            participant={participant}
            photo={contactPhotos[participant.address] ?? null}
            size={circleSize}
            fontSize={innerFontSize}
            border={layoutCount === 2 || layoutCount === 3}
          />
        </div>
      ))}

      {/* Overflow badge */}
      {showOverflow && (
        <div
          style={{
            position: 'absolute',
            top: positions[3].top,
            left: positions[3].left,
            width: circleSize,
            height: circleSize,
            borderRadius: '50%',
            backgroundColor: '#6b7280',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(7, Math.round(circleSize * 0.42)),
            fontWeight: 600,
            color: '#fff',
            border: '1.5px solid var(--color-background, #fff)',
          }}
        >
          +{totalCount - 3}
        </div>
      )}
    </div>
  );
}

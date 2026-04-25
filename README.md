# Kai Plugin — BlueBubbles

iMessage & SMS integration for [Kai](https://github.com/LegionIO/kai-desktop) via [BlueBubbles](https://bluebubbles.app) server. Includes AI-powered auto-reply, contact management, reactions, attachments, and full tool traceability.

## Features

- **Full chat UI** — Chat list, threaded conversations, message bubbles, reactions, and attachments
- **AI auto-reply** — Intelligent responses powered by Kai's LLM with full tool access
- **Contact book** — Save names for phone numbers/emails; names flow into AI context
- **Reactions / tapbacks** — Send and receive all 6 iMessage reaction types
- **Image / video sending** — Attach and send media with staging previews
- **Typing indicators** — Shows typing bubbles while AI generates; sends typing status to recipients
- **Message chunking** — Configurable splitting of long messages (sentence / word / newline / anywhere)
- **Per-thread settings** — Override model, profile, reasoning effort, and routing per conversation
- **Tool call tracing** — Toggle visibility of AI tool calls with args, results, and timing
- **Notifications** — Native and in-app notifications with click-to-navigate
- **Webhook receiver** — Local HTTP server receives real-time events from BlueBubbles

## Prerequisites

- [BlueBubbles Server](https://bluebubbles.app) running on a Mac with Private API enabled and REST API accessible

## Installation

Install from the Kai marketplace, or manually:

```bash
cd ~/.kai/plugins
git clone https://github.com/LegionIO/kai-plugin-bluebubbles.git bluebubbles
cd bluebubbles
npm install
npm run build
```

Restart Kai — the plugin is discovered automatically.

Then configure via **Settings → BlueBubbles**:
- Enter your BlueBubbles server URL and password
- Set the webhook port (default: 8742)
- Add a webhook in BlueBubbles Server pointing to `http://<your-machine-ip>:8742/webhook`

## Development

```bash
npm install
npm run dev   # builds to ~/.kai/plugins/bluebubbles/ and watches for changes
```

Restart Kai after each rebuild to reload the plugin.

```bash
npm run build  # production build → dist/
```

## Project Structure

```
src/
├── backend/
│   ├── index.ts              # activate / deactivate
│   ├── ai-reply.ts           # AI-powered reply engine
│   ├── bb-client.ts          # BlueBubbles REST API client
│   ├── chat-history.ts       # Per-chat conversation history
│   ├── chunker.ts            # Message splitting
│   ├── contacts.ts           # Contact name book
│   ├── message-normalizer.ts # BB API → normalized types
│   ├── reaction-utils.ts     # Tapback helpers
│   ├── state-manager.ts      # Plugin state management
│   ├── tools.ts              # AI tool definitions
│   └── webhook-handler.ts    # HTTP webhook receiver
├── frontend/
│   ├── index.ts              # Component registration
│   ├── hooks.ts              # Shared prop types
│   └── components/
│       ├── BlueBubblesPanel.tsx
│       ├── BlueBubblesSettings.tsx
│       ├── ChatList.tsx
│       ├── ComposeBar.tsx
│       ├── MessageBubble.tsx
│       ├── ModelProfileSelectors.tsx
│       ├── ReactionPicker.tsx
│       └── ThreadView.tsx
└── shared/
    ├── types.ts
    └── constants.ts
```

## Release

Releases are automated via GitHub Actions. Go to **Actions → Release Plugin → Run workflow**, choose a version bump, and the workflow will build and publish a release with the plugin tarball.

## License

MIT

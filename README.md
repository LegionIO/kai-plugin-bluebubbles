# BlueBubbles Plugin for Kai Desktop

iMessage & SMS integration for [Kai Desktop](https://github.com/kai-systems/kai-desktop) via [BlueBubbles](https://bluebubbles.app) server, with AI-powered auto-reply, contact management, reactions, and full tool traceability.

## Features

- **iMessage/SMS Chat UI** — Full messaging interface with chat list, threaded conversations, message bubbles, reactions, and attachments
- **AI Auto-Reply** — Intelligent responses powered by Kai's configured LLM with full tool access (image generation, web search, etc.)
- **Contact Book** — Save names for phone numbers/emails; names flow into AI context for natural conversations
- **Reactions/Tapbacks** — Send and receive all 6 iMessage reaction types with hover quick-react bar
- **Image/Video Sending** — Attach and send media from the UI with staging previews
- **Typing Indicators** — Shows typing bubbles while AI generates, sends typing status to recipients
- **Read Receipts** — Automatically marks messages as read
- **Message Chunking** — Configurable splitting of long messages (sentence/word/newline/anywhere)
- **Per-Thread Settings** — Override model, profile, thinking level, and auto-routing per conversation
- **Tool Call Tracing** — Toggle visibility of AI tool calls with args, results, and timing
- **Notifications** — Native macOS and in-app notifications with click-to-navigate
- **Webhook Receiver** — Local HTTP server receives real-time events from BlueBubbles

## Prerequisites

- [Kai Desktop](https://github.com/kai-systems/kai-desktop) installed and running
- [BlueBubbles Server](https://bluebubbles.app) running on a Mac with:
  - Private API enabled and helper connected (for reactions, typing indicators, edit, unsend)
  - REST API accessible from the machine running Kai

## Installation

1. **Clone this repo** into your plugins directory:

   ```bash
   cd ~/.kai/plugins
   git clone https://github.com/kai-systems/kai-plugin-bluebubbles.git bluebubbles
   ```

   Or clone elsewhere and symlink:

   ```bash
   git clone https://github.com/kai-systems/kai-plugin-bluebubbles.git ~/git/kai-plugin-bluebubbles
   ln -sf ~/git/kai-plugin-bluebubbles ~/.kai/plugins/bluebubbles
   ```

2. **Install dependencies and build:**

   ```bash
   cd ~/.kai/plugins/bluebubbles
   npm install
   npm run build
   ```

3. **Restart Kai Desktop** — The plugin will be discovered automatically. Approve it when prompted.

4. **Configure** — Click the message bubble icon in the dock, then go to Settings > BlueBubbles:
   - Enter your BlueBubbles server URL (e.g. `http://192.168.1.100:1234`)
   - Enter your server password
   - Click "Test Connection"
   - Configure the webhook port (default: 8742)

5. **Set up webhooks** in BlueBubbles Server:
   - Go to your BlueBubbles Server settings > Webhooks
   - Add a new webhook URL: `http://<kai-machine-ip>:8742/webhook`
   - If you set a webhook secret, append `?secret=<your-secret>` to the URL

## Configuration

### Connection
| Setting | Description | Default |
|---------|-------------|---------|
| Server URL | BlueBubbles server address | — |
| Password | Server API password | — |
| Webhook Port | Local port for receiving events | 8742 |
| Webhook Host | Bind address | 0.0.0.0 |
| Webhook Secret | Optional authentication for webhooks | — |

### AI Auto-Reply
| Setting | Description | Default |
|---------|-------------|---------|
| Enabled | Toggle AI responses | Off |
| DM Behavior | smart / always / never | smart |
| Group Behavior | smart / always / never / mentioned | smart |
| System Prompt | Custom AI personality | Built-in iMessage prompt |
| Model / Profile | Override Kai's default model | Default |
| Thinking Level | Reasoning effort (low/medium/high/xhigh) | Default |
| Fallback Models | Auto-route on failure | Off |
| Max History | Messages kept per chat for context | 50 |

### Message Chunking
| Setting | Description | Default |
|---------|-------------|---------|
| Max Length | Characters per message before splitting | 4000 |
| Split Mode | sentence / word / newline / anywhere | sentence |

### Per-Thread Overrides
Click the ⚙ gear icon in any thread header to override model, profile, thinking level, and auto-routing for that specific conversation.

## Development

```bash
# Watch for changes and rebuild
npm run watch

# After changes, restart Kai Desktop to reload the plugin
# The renderer cache may need clearing:
rm -rf ~/.kai/plugin-renderers/bluebubbles
```

### Project Structure

```
plugin.json              # Plugin manifest
main.ts                  # Main process entry point
renderer.js              # Renderer entry (bundled by Kai's esbuild)
src/
  shared/
    types.ts             # All TypeScript types
    constants.ts         # Constants, default prompts, API paths
  main/
    ai-reply.ts          # AI-powered reply engine
    bb-client.ts         # BlueBubbles REST API client
    chat-history.ts      # Per-chat conversation history
    chunker.ts           # Message splitting (4 modes)
    contacts.ts          # Contact name book
    message-normalizer.ts # BB API → normalized types
    state-manager.ts     # Plugin state management
    webhook-handler.ts   # HTTP webhook receiver
  renderer/
    hooks.ts             # React hooks (from host)
    icons.tsx            # Inline SVG icons
    BlueBubblesSettings.tsx
    components/
      BlueBubblesPanel.tsx
      ChatList.tsx
      ComposeBar.tsx
      ConnectionStatus.tsx
      EmptyState.tsx
      MessageBubble.tsx
      ModelProfileSelectors.tsx
      ReactionPicker.tsx
      ThreadView.tsx
      AttachmentPreview.tsx
```

## Kai Desktop Framework Changes

This plugin requires a few additions to the Kai Desktop plugin framework (included in Kai Desktop v1.0.27+):

- `agent.generate()` API for plugins to invoke the LLM with tools
- Custom SVG icons in navigation items
- Configurable HTTP bind address for webhooks
- `realpathSync` fix for symlinked plugins
- Navigation request handling for notification click-through

## License

MIT

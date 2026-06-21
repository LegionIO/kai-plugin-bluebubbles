import type { BlueBubblesClient } from './bb-client.js';
import type { ContactBook } from './contacts.js';
import type { ChatHistoryManager } from './chat-history.js';
import { chunkText } from './chunker.js';
import type {
  BBMessage,
  AIReplyConfig,
  ChunkConfig,
  NormalizedChat,
  ThreadSettings,
} from '../shared/types.js';
import { DEFAULT_AI_SYSTEM_PROMPT, DEFAULT_MAX_CHUNK_LENGTH } from '../shared/constants.js';

type AgentGenerateOptions = {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string | unknown[] }>;
  modelKey?: string;
  profileKey?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  fallbackEnabled?: boolean;
  systemPrompt?: string;
  tools?: boolean;
};

type AgentStreamEvent = {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  modelKey?: string;
};

type AgentResult = {
  text: string;
  modelKey: string;
  toolCalls?: any[];
  historyText?: string;
};

type AgentAPI = {
  generate: (options: AgentGenerateOptions) => Promise<AgentResult>;
  stream?: (options: AgentGenerateOptions) => AsyncGenerator<AgentStreamEvent>;
};

type LogAPI = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type StateCallback = {
  setAIReplyProcessing: (chatGuid: string, processing: boolean) => void;
  onMessageSent?: (chatGuid: string, bbMessage: any, toolCalls?: any[]) => void;
};

export class AIReplyEngine {
  private agent: AgentAPI;
  private client: BlueBubblesClient;
  private contacts: ContactBook;
  private history: ChatHistoryManager;
  private config: AIReplyConfig;
  private chunkConfig: ChunkConfig;
  private log: LogAPI;
  private stateCallback: StateCallback;
  private getThreadSettings: (chatGuid: string) => ThreadSettings | undefined;
  private recentReplies = new Map<string, number>();
  private debounceMs = 10_000;

  constructor(options: {
    agent: AgentAPI;
    client: BlueBubblesClient;
    contacts: ContactBook;
    history: ChatHistoryManager;
    config: AIReplyConfig;
    chunkConfig: ChunkConfig;
    log: LogAPI;
    stateCallback: StateCallback;
    getThreadSettings?: (chatGuid: string) => ThreadSettings | undefined;
  }) {
    this.agent = options.agent;
    this.client = options.client;
    this.contacts = options.contacts;
    this.history = options.history;
    this.config = options.config;
    this.chunkConfig = options.chunkConfig;
    this.log = options.log;
    this.stateCallback = options.stateCallback;
    this.getThreadSettings = options.getThreadSettings ?? (() => undefined);
  }

  updateConfig(config: AIReplyConfig): void {
    this.config = config;
  }

  updateChunkConfig(config: ChunkConfig): void {
    this.chunkConfig = config;
  }

  private async sendTextChunks(chatGuid: string, text: string, toolCalls?: any[]): Promise<void> {
    const chunks = chunkText(text, this.chunkConfig);
    if (chunks.length === 0) return;

    this.recentReplies.set(chatGuid, Date.now());

    for (let i = 0; i < chunks.length; i++) {
      const sentMsg = await this.client.sendText(chatGuid, chunks[i]);
      this.stateCallback.onMessageSent?.(chatGuid, sentMsg, i === 0 ? toolCalls : undefined);
    }
  }

  private async generateReply(chatGuid: string, options: AgentGenerateOptions): Promise<AgentResult> {
    if (!this.agent.stream) {
      return this.agent.generate(options);
    }

    return this.generateReplyFromStream(chatGuid, options);
  }

  private async generateReplyFromStream(chatGuid: string, options: AgentGenerateOptions): Promise<AgentResult> {
    let pendingText = '';
    let historyText = '';
    let modelKey = '';
    let error: string | null = null;
    let lastEventWasToolResult = false;
    const toolCalls: any[] = [];
    const pendingToolCalls = new Map<string, { toolName: string; args: unknown; startedAt: number }>();
    const setBlockedText = (message: string) => {
      pendingText = message;
      if (historyText.trim()) {
        historyText += `\n\n${message}`;
      } else {
        historyText = message;
      }
    };

    for await (const event of this.agent.stream!(options)) {
      if (event.type === 'text-delta' && event.text) {
        if (lastEventWasToolResult && historyText.length > 0 && !historyText.endsWith('\n')) {
          historyText += '\n\n';
        }
        pendingText += event.text;
        historyText += event.text;
        lastEventWasToolResult = false;
      } else if (event.type === 'tool-call' && event.toolCallId) {
        pendingToolCalls.set(event.toolCallId, {
          toolName: event.toolName ?? 'unknown',
          args: event.args,
          startedAt: Date.now(),
        });
      } else if (event.type === 'tool-result' && event.toolCallId) {
        lastEventWasToolResult = true;
        const pending = pendingToolCalls.get(event.toolCallId);
        toolCalls.push({
          toolName: pending?.toolName ?? event.toolName ?? 'unknown',
          args: pending?.args ?? {},
          result: event.result,
          durationMs: pending ? Date.now() - pending.startedAt : undefined,
        });
        pendingToolCalls.delete(event.toolCallId);
      } else if (event.type === 'tool-error' && event.toolCallId) {
        const pending = pendingToolCalls.get(event.toolCallId);
        toolCalls.push({
          toolName: pending?.toolName ?? event.toolName ?? 'unknown',
          args: pending?.args ?? {},
          result: null,
          error: event.error ?? 'Tool execution failed',
          durationMs: pending ? Date.now() - pending.startedAt : undefined,
        });
        pendingToolCalls.delete(event.toolCallId);
      } else if (event.type === 'max-steps-reached') {
        setBlockedText("I hit my tool-step limit before I could finish that, so I can't confirm it completed.");
      } else if (event.type === 'error') {
        error = event.error ?? 'Unknown error';
      } else if (event.type === 'done' && event.modelKey) {
        modelKey = event.modelKey;
      }
    }

    for (const [toolCallId, pending] of pendingToolCalls.entries()) {
      toolCalls.push({
        toolName: pending.toolName,
        args: pending.args ?? {},
        result: null,
        error: 'Tool call ended without a result.',
        durationMs: Date.now() - pending.startedAt,
      });
      pendingToolCalls.delete(toolCallId);
    }
    if (toolCalls.some((toolCall) => toolCall.error === 'Tool call ended without a result.')) {
      setBlockedText("A tool call ended before returning a result, so I can't confirm it completed.");
    }

    if (error && !historyText.trim()) {
      throw new Error(error);
    }

    return {
      text: pendingText.trim(),
      modelKey,
      toolCalls,
      historyText: historyText.trim(),
    };
  }

  async handleMessage(msg: BBMessage, chat?: NormalizedChat): Promise<void> {
    if (!this.config.enabled) return;
    if (msg.isFromMe) return;

    const chatGuid = msg.chats?.[0]?.guid ?? '';
    if (!chatGuid) return;

    const isGroup = chatGuid.includes(';+;');
    const senderAddress = msg.handle?.address ?? '';
    if (!senderAddress) return;

    const senderName = this.contacts.resolve(senderAddress);
    const messageText = msg.text ?? '';

    const imageAttachments = (msg.attachments ?? [])
      .filter((a) => a.guid && a.mimeType?.startsWith('image/'));

    if (!messageText.trim() && imageAttachments.length === 0) return;

    // Check behavior config
    const behavior = isGroup ? this.config.groupBehavior : this.config.dmBehavior;
    if (behavior === 'never') return;

    // Append incoming message to history regardless of debounce.
    // Store only guid+mimeType — getAttachmentUrl() embeds ?password= and
    // ChatHistoryManager persists this map to plugin config.
    const attachmentMeta = imageAttachments.map((a) => ({
      guid: a.guid!,
      mimeType: a.mimeType!,
    }));
    this.history.appendMessage(chatGuid, {
      role: 'user',
      content: messageText || (imageAttachments.length > 0 ? '[Image]' : ''),
      senderName,
      ...(attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
    });

    // Debounce per chat — skip AI generation but message is still in history
    const lastReply = this.recentReplies.get(chatGuid) ?? 0;
    if (Date.now() - lastReply < this.debounceMs) {
      this.log.info(`Debounced AI reply for ${chatGuid} (${Date.now() - lastReply}ms since last)`);
      return;
    }

    // For 'mentioned' mode, check if our name/keyword is in the message
    if (behavior === 'mentioned') {
      // TODO: allow configurable trigger words
      const lowerText = messageText.toLowerCase();
      const mentioned = lowerText.includes('ai') || lowerText.includes('assistant') || lowerText.includes('kai');
      if (!mentioned) return;
    }

    this.stateCallback.setAIReplyProcessing(chatGuid, true);

    // Send typing indicator while AI is thinking
    let typingInterval: ReturnType<typeof setInterval> | null = null;
    const startTyping = () => {
      this.client.sendTypingIndicator(chatGuid).catch(() => {});
      typingInterval = setInterval(() => {
        this.client.sendTypingIndicator(chatGuid).catch(() => {});
      }, 10_000);
    };

    try {
      // Mark chat as read
      this.client.markChatRead(chatGuid).catch(() => {});

      startTyping();

      const threadSettings = this.getThreadSettings(chatGuid);
      const systemPrompt = threadSettings?.systemPrompt || this.buildSystemPrompt(isGroup, chat);
      const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string | unknown[] }> =
        this.history.toAgentMessages(chatGuid);

      // For the current message, fetch image data and inject as multimodal content
      if (imageAttachments.length > 0 && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        const parts: unknown[] = [];
        const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
        if (textContent) {
          parts.push({ type: 'text', text: textContent });
        }
        for (const att of imageAttachments) {
          try {
            const imageData = await this.client.fetchAttachmentAsBase64(att.guid!);
            if (imageData) {
              parts.push({
                type: 'image',
                image: Buffer.from(imageData.base64, 'base64'),
                mimeType: imageData.mimeType,
              });
            }
          } catch (err) {
            this.log.warn(`Failed to fetch attachment ${att.guid}:`, err);
          }
        }
        if (parts.length > 0) {
          messages[messages.length - 1] = { ...lastMsg, content: parts };
        }
      }

      this.log.info(`AI generating reply for ${chatGuid} (${messages.length} messages in context)`);

      const result = await this.generateReply(chatGuid, {
        messages,
        systemPrompt,
        modelKey: threadSettings?.modelOverride ?? this.config.modelOverride,
        profileKey: threadSettings?.profileOverride ?? this.config.profileOverride,
        reasoningEffort: threadSettings?.reasoningEffort ?? this.config.reasoningEffort,
        fallbackEnabled: threadSettings?.fallbackEnabled ?? this.config.fallbackEnabled,
        tools: true,
      });

      let responseText = result.text.trim();
      const historyText = (result.historyText ?? result.text).trim();

      if (!responseText || responseText === '[NO_REPLY]' || responseText.includes('[NO_REPLY]')) {
        if (historyText && !historyText.includes('[NO_REPLY]')) {
          this.history.appendMessage(chatGuid, {
            role: 'assistant',
            content: historyText,
          });
        }
        this.log.info(`AI decided not to reply in ${chatGuid}`);
        return;
      }

      // Extract and handle reaction instructions [REACT:type]
      const reactPattern = /\[REACT:(\w+)\]/gi;
      const reactions: string[] = [];
      let reactMatch: RegExpExecArray | null;
      while ((reactMatch = reactPattern.exec(responseText)) !== null) {
        reactions.push(reactMatch[1].toLowerCase());
      }
      responseText = responseText.replace(reactPattern, '').trim();

      // Send reactions to the last received message
      if (reactions.length > 0 && msg.guid) {
        for (const reactionType of reactions) {
          const validTypes = ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'];
          if (validTypes.includes(reactionType)) {
            try {
              await this.client.sendReaction(chatGuid, msg.guid, reactionType);
              this.log.info(`AI reacted with ${reactionType} to ${msg.guid}`);
            } catch (err) {
              this.log.warn(`AI reaction failed:`, err);
            }
          }
        }
      }

      // If only reactions and no text remaining, we're done
      if (!responseText || responseText === '[NO_REPLY]') {
        if (historyText) {
          this.history.appendMessage(chatGuid, {
            role: 'assistant',
            content: historyText,
          });
        }
        return;
      }

      // Extract and send media attachments (kai-media:// URLs in markdown image syntax)
      const mediaPattern = /!\[([^\]]*)\]\((kai-media:\/\/[^)]+)\)/g;
      const mediaMatches: Array<{ full: string; alt: string; url: string }> = [];
      let mediaMatch: RegExpExecArray | null;
      while ((mediaMatch = mediaPattern.exec(responseText)) !== null) {
        mediaMatches.push({ full: mediaMatch[0], alt: mediaMatch[1], url: mediaMatch[2] });
      }

      if (mediaMatches.length > 0) {
        const { existsSync } = await import('fs');
        const { resolve, sep, basename, extname } = await import('path');
        const { homedir } = await import('os');

        const mediaRoot = resolve(homedir(), '.kai', 'media');

        for (const media of mediaMatches) {
          try {
            const relativePath = media.url.replace(/^kai-media:\/\//, '');
            // Containment: reject traversal/absolute/control chars, then verify the
            // resolved path stays under ~/.kai/media so LLM output can't exfiltrate
            // arbitrary files via sendAttachment.
            if (
              relativePath.includes('..') ||
              relativePath.startsWith('/') ||
              relativePath.startsWith('\\') ||
              relativePath.includes('\0')
            ) {
              this.log.warn(`Rejected kai-media path (unsafe segment): ${relativePath}`);
              continue;
            }
            const filePath = resolve(mediaRoot, relativePath);
            if (filePath !== mediaRoot && !filePath.startsWith(mediaRoot + sep)) {
              this.log.warn(`Rejected kai-media path (escapes media root): ${filePath}`);
              continue;
            }

            if (existsSync(filePath)) {
              const filename = basename(filePath);
              const ext = extname(filename).toLowerCase();
              const mimeMap: Record<string, string> = {
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
              };
              const mimeType = mimeMap[ext] ?? 'application/octet-stream';
              const result = await this.client.sendAttachment(chatGuid, filePath, filename, mimeType);
              this.log.info(`Sent attachment: ${filename} to ${chatGuid}`);

              // Push a synthetic message to the UI so the image shows immediately
              if (this.stateCallback.onMessageSent && result) {
                const bbMsg = (result as any).data ?? result;
                if (bbMsg?.guid) {
                  this.stateCallback.onMessageSent(chatGuid, bbMsg);
                }
              }
            } else {
              this.log.warn(`Media file not found: ${filePath}`);
            }
          } catch (err) {
            this.log.error(`Failed to send attachment:`, err);
          }
        }

        // Strip markdown image syntax from text
        responseText = responseText.replace(mediaPattern, '').trim();
      }

      // If only media was sent and no text remains, we're done
      if (!responseText || responseText === '[NO_REPLY]') {
        this.recentReplies.set(chatGuid, Date.now());
        this.history.appendMessage(chatGuid, {
          role: 'assistant',
          content: historyText || result.text.trim(),
        });
        return;
      }

      // Chunk and send text
      await this.sendTextChunks(chatGuid, responseText, result.toolCalls);

      // Record in history
      this.history.appendMessage(chatGuid, {
        role: 'assistant',
        content: historyText || responseText,
      });

      this.log.info(`AI replied in ${chatGuid}: ${responseText.slice(0, 100)}...`);
    } catch (err) {
      this.log.error(`AI reply failed for ${chatGuid}:`, err);
    } finally {
      if (typingInterval) { clearInterval(typingInterval); typingInterval = null; }
      this.stateCallback.setAIReplyProcessing(chatGuid, false);
    }
  }

  private buildSystemPrompt(isGroup: boolean, chat?: NormalizedChat): string {
    const base = this.config.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT;
    const parts = [base];

    if (chat) {
      parts.push('');
      parts.push(`Chat: ${chat.displayName}`);
      parts.push(`Service: ${chat.service}`);
      parts.push(`Type: ${isGroup ? 'Group chat' : 'Direct message'}`);

      if (chat.participants.length > 0) {
        const names = chat.participants.map((p) => {
          const saved = this.contacts.get(p.address);
          return saved ? `${saved} (${p.address})` : p.displayName || p.address;
        });
        parts.push(`Participants: ${names.join(', ')}`);
      }
    }

    if (isGroup && this.config.groupBehavior === 'smart') {
      parts.push('');
      parts.push('IMPORTANT: You are in a group chat. Only reply if directly addressed, asked a question, or your input is genuinely valuable. Otherwise respond with [NO_REPLY].');
    }

    if (!isGroup && this.config.dmBehavior === 'always') {
      parts.push('');
      parts.push('This is a direct message. Always provide a helpful response. Do NOT use [NO_REPLY] in DMs.');
    }

    return parts.join('\n');
  }
}

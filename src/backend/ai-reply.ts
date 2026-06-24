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
import type { AdvancedDebugLogAPI } from './debug-logger.js';

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
  onAIReplyFailed?: (chatGuid: string, failure: {
    text: string;
    error: string;
    stage: string;
    runId: string;
    toolCalls?: any[];
  }) => void;
};

class AIReplyGenerationError extends Error {
  stage: string;
  partialText: string;
  historyText: string;
  modelKey: string;
  toolCalls: any[];
  cause?: unknown;

  constructor(
    message: string,
    options: {
      stage?: string;
      partialText?: string;
      historyText?: string;
      modelKey?: string;
      toolCalls?: any[];
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'AIReplyGenerationError';
    this.stage = options.stage ?? 'generating reply';
    this.partialText = options.partialText ?? '';
    this.historyText = options.historyText ?? '';
    this.modelKey = options.modelKey ?? '';
    this.toolCalls = options.toolCalls ?? [];
    this.cause = options.cause;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorToString(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateText(value: string, maxLength = 3000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function stringifyToolError(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value instanceof Error) return value.message;
  if (isRecord(value)) {
    const message = value.message ?? value.error ?? value.stderr;
    if (typeof message === 'string' && message.trim()) return message.trim();
    try {
      return JSON.stringify(value);
    } catch {
      return 'Tool execution failed';
    }
  }
  return undefined;
}

function inferToolResultError(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;

  const explicitError = stringifyToolError(result.error);
  if (result.isError === true) {
    return explicitError ?? stringifyToolError(result.message) ?? 'Tool returned isError: true';
  }
  if (result.success === false || result.ok === false) {
    return explicitError ?? stringifyToolError(result.message) ?? 'Tool returned an unsuccessful result';
  }
  if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
    return (
      explicitError ??
      stringifyToolError(result.stderr) ??
      stringifyToolError(result.stdout) ??
      `Tool exited with code ${result.exitCode}`
    );
  }
  return explicitError;
}

function normalizeToolCalls(toolCalls?: any[]): any[] | undefined {
  if (!toolCalls) return undefined;
  return toolCalls.map((toolCall) => {
    if (!isRecord(toolCall) || toolCall.error) return toolCall;
    const inferredError = inferToolResultError(toolCall.result);
    return inferredError ? { ...toolCall, error: inferredError } : toolCall;
  });
}

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
  private debugLog?: AdvancedDebugLogAPI;
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
    debugLog?: AdvancedDebugLogAPI;
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
    this.debugLog = options.debugLog;
  }

  updateConfig(config: AIReplyConfig): void {
    this.config = config;
  }

  updateChunkConfig(config: ChunkConfig): void {
    this.chunkConfig = config;
  }

  private debugEvent(
    runId: string,
    event: string,
    data: Record<string, unknown> = {},
    level: 'debug' | 'info' | 'warn' | 'error' = 'debug',
  ): void {
    this.debugLog?.event(event, { runId, ...data }, level);
  }

  private makeRunId(chatGuid: string, messageGuid: string): string {
    const suffix = Math.random().toString(36).slice(2, 8);
    return `ai-reply-${Date.now()}-${suffix}-${chatGuid}-${messageGuid}`;
  }

  private formatFailureText(options: {
    stage: string;
    error: string;
    partialText?: string;
    generatedText?: string;
  }): string {
    const lines: string[] = [];
    const lowerStage = options.stage.toLowerCase();
    const failedSending = lowerStage.includes('send');

    lines.push(
      failedSending
        ? 'Kai generated a reply, but BlueBubbles failed while sending it. Some chunks may already have been sent.'
        : "Kai couldn't finish generating a reply.",
    );
    lines.push('');
    lines.push(`Stage: ${options.stage}`);
    lines.push(`Error: ${options.error}`);

    const generatedText = options.generatedText?.trim();
    const partialText = options.partialText?.trim();
    if (generatedText) {
      lines.push('');
      lines.push('Generated reply:');
      lines.push(truncateText(generatedText));
    } else if (partialText) {
      lines.push('');
      lines.push('Partial draft:');
      lines.push(truncateText(partialText));
    }

    return lines.join('\n');
  }

  private publishFailureMessage(chatGuid: string, failure: {
    stage: string;
    error: string;
    runId: string;
    toolCalls?: any[];
    partialText?: string;
    generatedText?: string;
  }): void {
    const text = this.formatFailureText(failure);
    this.stateCallback.onAIReplyFailed?.(chatGuid, {
      text,
      error: failure.error,
      stage: failure.stage,
      runId: failure.runId,
      toolCalls: failure.toolCalls,
    });
  }

  private isLikelyContinuationCommand(text: string): boolean {
    const normalized = text
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/g, '')
      .replace(/\s+/g, ' ');

    if (!normalized) return false;

    return (
      /^(y|yes|yeah|yep|yup|sure|ok|okay|correct|confirmed|confirm)$/.test(normalized) ||
      /^(do it|do that|do this|go ahead|please do|yes please|yep do it|yeah do it|ok do it|okay do it)$/.test(normalized) ||
      /^(add it|run it|send it|make it|delete it|remove it|change it|fix it)$/.test(normalized) ||
      /^(do it for real|for real|actually do it|really do it)$/.test(normalized) ||
      /^(run|add|send|delete|remove|change|fix)\b/.test(normalized)
    );
  }

  private async sendTextChunks(chatGuid: string, text: string, toolCalls?: any[], runId?: string): Promise<void> {
    const chunks = chunkText(text, this.chunkConfig);
    if (chunks.length === 0) {
      if (runId) this.debugEvent(runId, 'ai_reply.send.skipped_empty_chunks', { chatGuid });
      return;
    }

    this.recentReplies.set(chatGuid, Date.now());
    if (runId) {
      this.debugEvent(runId, 'ai_reply.send.started', {
        chatGuid,
        chunkCount: chunks.length,
        totalLength: text.length,
        firstChunkHasToolCalls: Boolean(toolCalls?.length),
      }, 'info');
    }

    for (let i = 0; i < chunks.length; i++) {
      const sentMsg = await this.client.sendText(chatGuid, chunks[i]);
      if (runId) {
        this.debugEvent(runId, 'ai_reply.send.chunk_sent', {
          chatGuid,
          chunkIndex: i,
          chunkCount: chunks.length,
          chunkLength: chunks[i].length,
          messageGuid: sentMsg.guid,
        }, 'info');
      }
      this.stateCallback.onMessageSent?.(chatGuid, sentMsg, i === 0 ? toolCalls : undefined);
    }
  }

  private async generateReply(chatGuid: string, options: AgentGenerateOptions, runId: string): Promise<AgentResult> {
    if (!this.agent.stream) {
      try {
        const result = await this.agent.generate(options);
        const normalizedToolCalls = normalizeToolCalls(result.toolCalls);
        this.debugEvent(runId, 'ai_reply.generate.completed', {
          chatGuid,
          modelKey: result.modelKey,
          textLength: result.text.length,
          toolCallCount: normalizedToolCalls?.length ?? 0,
          toolCalls: normalizedToolCalls,
        }, 'info');
        return { ...result, toolCalls: normalizedToolCalls };
      } catch (err) {
        throw new AIReplyGenerationError(errorToString(err), { cause: err });
      }
    }

    const result = await this.generateReplyFromStream(chatGuid, options, runId);
    return { ...result, toolCalls: normalizeToolCalls(result.toolCalls) };
  }

  private async generateReplyFromStream(chatGuid: string, options: AgentGenerateOptions, runId: string): Promise<AgentResult> {
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

    try {
      for await (const event of this.agent.stream!(options)) {
        if (event.type === 'text-delta' && event.text) {
          if (lastEventWasToolResult && historyText.length > 0 && !historyText.endsWith('\n')) {
            historyText += '\n\n';
          }
          pendingText += event.text;
          historyText += event.text;
          lastEventWasToolResult = false;
          this.debugEvent(runId, 'ai_reply.stream.text_delta', {
            chatGuid,
            length: event.text.length,
            text: event.text,
          });
        } else if (event.type === 'tool-call' && event.toolCallId) {
          pendingToolCalls.set(event.toolCallId, {
            toolName: event.toolName ?? 'unknown',
            args: event.args,
            startedAt: Date.now(),
          });
          this.debugEvent(runId, 'ai_reply.stream.tool_call', {
            chatGuid,
            toolCallId: event.toolCallId,
            toolName: event.toolName ?? 'unknown',
            args: event.args,
          }, 'info');
        } else if (event.type === 'tool-result' && event.toolCallId) {
          lastEventWasToolResult = true;
          const pending = pendingToolCalls.get(event.toolCallId);
          const inferredError = inferToolResultError(event.result);
          const toolCall = {
            toolName: pending?.toolName ?? event.toolName ?? 'unknown',
            args: pending?.args ?? {},
            result: event.result,
            ...(inferredError ? { error: inferredError } : {}),
            durationMs: pending ? Date.now() - pending.startedAt : undefined,
          };
          toolCalls.push(toolCall);
          pendingToolCalls.delete(event.toolCallId);
          this.debugEvent(runId, 'ai_reply.stream.tool_result', {
            chatGuid,
            toolCallId: event.toolCallId,
            ...toolCall,
          }, inferredError ? 'warn' : 'info');
        } else if (event.type === 'tool-error' && event.toolCallId) {
          const pending = pendingToolCalls.get(event.toolCallId);
          const toolCall = {
            toolName: pending?.toolName ?? event.toolName ?? 'unknown',
            args: pending?.args ?? {},
            result: null,
            error: event.error ?? 'Tool execution failed',
            durationMs: pending ? Date.now() - pending.startedAt : undefined,
          };
          toolCalls.push(toolCall);
          pendingToolCalls.delete(event.toolCallId);
          this.debugEvent(runId, 'ai_reply.stream.tool_error', {
            chatGuid,
            toolCallId: event.toolCallId,
            ...toolCall,
          }, 'warn');
        } else if (event.type === 'max-steps-reached') {
          setBlockedText("I hit my tool-step limit before I could finish that, so I can't confirm it completed.");
          this.debugEvent(runId, 'ai_reply.stream.max_steps_reached', { chatGuid }, 'warn');
        } else if (event.type === 'error') {
          error = event.error ?? 'Unknown error';
          this.debugEvent(runId, 'ai_reply.stream.error_event', {
            chatGuid,
            error,
          }, 'error');
        } else if (event.type === 'done' && event.modelKey) {
          modelKey = event.modelKey;
          this.debugEvent(runId, 'ai_reply.stream.done', {
            chatGuid,
            modelKey,
          }, 'info');
        } else {
          this.debugEvent(runId, 'ai_reply.stream.event', {
            chatGuid,
            type: event.type,
            event,
          });
        }
      }
    } catch (err) {
      this.debugEvent(runId, 'ai_reply.stream.exception', {
        chatGuid,
        error: err,
        partialText: pendingText,
        historyText,
        toolCalls,
        pendingToolCalls: [...pendingToolCalls.entries()].map(([toolCallId, pending]) => ({
          toolCallId,
          toolName: pending.toolName,
          args: pending.args,
          durationMs: Date.now() - pending.startedAt,
        })),
      }, 'error');
      throw new AIReplyGenerationError(errorToString(err), {
        partialText: pendingText.trim(),
        historyText: historyText.trim(),
        modelKey,
        toolCalls: normalizeToolCalls(toolCalls) ?? [],
        cause: err,
      });
    }

    for (const [toolCallId, pending] of pendingToolCalls.entries()) {
      toolCalls.push({
        toolName: pending.toolName,
        args: pending.args ?? {},
        result: null,
        error: 'Tool call ended without a result.',
        durationMs: Date.now() - pending.startedAt,
      });
      this.debugEvent(runId, 'ai_reply.stream.tool_missing_result', {
        chatGuid,
        toolCallId,
        toolName: pending.toolName,
        args: pending.args,
        durationMs: Date.now() - pending.startedAt,
      }, 'warn');
      pendingToolCalls.delete(toolCallId);
    }
    if (toolCalls.some((toolCall) => toolCall.error === 'Tool call ended without a result.')) {
      setBlockedText("A tool call ended before returning a result, so I can't confirm it completed.");
    }

    if (error && !historyText.trim()) {
      throw new AIReplyGenerationError(error, {
        partialText: pendingText.trim(),
        historyText: historyText.trim(),
        modelKey,
        toolCalls: normalizeToolCalls(toolCalls) ?? [],
      });
    }

    const result = {
      text: pendingText.trim(),
      modelKey,
      toolCalls,
      historyText: historyText.trim(),
    };
    this.debugEvent(runId, 'ai_reply.stream.completed', {
      chatGuid,
      modelKey,
      textLength: result.text.length,
      historyTextLength: result.historyText.length,
      toolCallCount: toolCalls.length,
      toolCalls,
    }, 'info');
    return result;
  }

  async handleMessage(msg: BBMessage, chat?: NormalizedChat): Promise<void> {
    if (!this.config.enabled) {
      this.debugLog?.event('ai_reply.skipped', {
        reason: 'auto_reply_disabled',
        messageGuid: msg.guid,
        isFromMe: msg.isFromMe,
      });
      return;
    }
    if (msg.isFromMe) {
      this.debugLog?.event('ai_reply.skipped', {
        reason: 'message_from_me',
        messageGuid: msg.guid,
      });
      return;
    }

    const chatGuid = msg.chats?.[0]?.guid ?? '';
    if (!chatGuid) {
      this.debugLog?.event('ai_reply.skipped', {
        reason: 'missing_chat_guid',
        messageGuid: msg.guid,
      }, 'warn');
      return;
    }

    const runId = this.makeRunId(chatGuid, msg.guid);

    const isGroup = chatGuid.includes(';+;');
    const senderAddress = msg.handle?.address ?? '';
    if (!senderAddress) {
      this.debugEvent(runId, 'ai_reply.skipped', {
        reason: 'missing_sender_address',
        chatGuid,
        messageGuid: msg.guid,
      }, 'warn');
      return;
    }

    const senderName = this.contacts.resolve(senderAddress);
    const messageText = msg.text ?? '';

    const imageAttachments = (msg.attachments ?? [])
      .filter((a) => a.guid && a.mimeType?.startsWith('image/'));

    this.debugEvent(runId, 'ai_reply.received_message', {
      chatGuid,
      messageGuid: msg.guid,
      senderAddress,
      senderName,
      isGroup,
      text: messageText,
      attachmentCount: msg.attachments?.length ?? 0,
      imageAttachmentCount: imageAttachments.length,
      chat: chat ? {
        displayName: chat.displayName,
        participantCount: chat.participants.length,
        service: chat.service,
      } : undefined,
    }, 'info');

    if (!messageText.trim() && imageAttachments.length === 0) {
      this.debugEvent(runId, 'ai_reply.skipped', {
        reason: 'no_text_or_image_content',
        chatGuid,
        messageGuid: msg.guid,
      });
      return;
    }

    // Check behavior config
    const behavior = isGroup ? this.config.groupBehavior : this.config.dmBehavior;
    if (behavior === 'never') {
      this.debugEvent(runId, 'ai_reply.skipped', {
        reason: 'behavior_never',
        chatGuid,
        messageGuid: msg.guid,
        behavior,
      });
      return;
    }

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
    this.debugEvent(runId, 'ai_reply.history_appended_user', {
      chatGuid,
      messageGuid: msg.guid,
      attachmentMeta,
    });

    // Debounce per chat — skip AI generation but message is still in history
    const lastReply = this.recentReplies.get(chatGuid) ?? 0;
    const bypassDebounce = this.isLikelyContinuationCommand(messageText);
    if (Date.now() - lastReply < this.debounceMs && !bypassDebounce) {
      this.log.info(`Debounced AI reply for ${chatGuid} (${Date.now() - lastReply}ms since last)`);
      this.debugEvent(runId, 'ai_reply.skipped', {
        reason: 'debounced',
        chatGuid,
        messageGuid: msg.guid,
        elapsedMs: Date.now() - lastReply,
        debounceMs: this.debounceMs,
      });
      return;
    }

    // For 'mentioned' mode, check if our name/keyword is in the message
    if (behavior === 'mentioned') {
      // TODO: allow configurable trigger words
      const lowerText = messageText.toLowerCase();
      const mentioned = lowerText.includes('ai') || lowerText.includes('assistant') || lowerText.includes('kai');
      if (!mentioned) {
        this.debugEvent(runId, 'ai_reply.skipped', {
          reason: 'not_mentioned',
          chatGuid,
          messageGuid: msg.guid,
          behavior,
        });
        return;
      }
    }

    this.stateCallback.setAIReplyProcessing(chatGuid, true);
    this.debugEvent(runId, 'ai_reply.processing_started', {
      chatGuid,
      messageGuid: msg.guid,
      behavior,
    }, 'info');

    // Send typing indicator while AI is thinking
    let typingInterval: ReturnType<typeof setInterval> | null = null;
    const startTyping = () => {
      this.client.sendTypingIndicator(chatGuid).catch((err) => {
        this.debugEvent(runId, 'ai_reply.typing_indicator_failed', { chatGuid, error: err }, 'warn');
      });
      typingInterval = setInterval(() => {
        this.client.sendTypingIndicator(chatGuid).catch((err) => {
          this.debugEvent(runId, 'ai_reply.typing_indicator_failed', { chatGuid, error: err }, 'warn');
        });
      }, 10_000);
    };

    let failureStage = 'preparing reply';
    let result: AgentResult | null = null;
    let responseTextForFailure = '';
    let historyTextForFailure = '';

    try {
      // Mark chat as read
      this.client.markChatRead(chatGuid).catch((err) => {
        this.debugEvent(runId, 'ai_reply.mark_read_failed', { chatGuid, error: err }, 'warn');
      });

      startTyping();

      failureStage = 'building reply context';
      const threadSettings = this.getThreadSettings(chatGuid);
      const systemPrompt = this.buildSystemPrompt(isGroup, chat, chatGuid, threadSettings?.systemPrompt);
      const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string | unknown[] }> =
        this.history.toAgentMessages(chatGuid);
      this.debugEvent(runId, 'ai_reply.context_built', {
        chatGuid,
        messageGuid: msg.guid,
        messageCount: messages.length,
        systemPrompt,
        modelKey: threadSettings?.modelOverride ?? this.config.modelOverride,
        profileKey: threadSettings?.profileOverride ?? this.config.profileOverride,
        reasoningEffort: threadSettings?.reasoningEffort ?? this.config.reasoningEffort,
        fallbackEnabled: threadSettings?.fallbackEnabled ?? this.config.fallbackEnabled,
        threadSettings,
      });

      // For the current message, fetch image data and inject as multimodal content
      if (imageAttachments.length > 0 && messages.length > 0) {
        failureStage = 'fetching image attachments';
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
              this.debugEvent(runId, 'ai_reply.image_attachment_fetched', {
                chatGuid,
                attachmentGuid: att.guid,
                mimeType: imageData.mimeType,
                byteLength: Buffer.byteLength(imageData.base64, 'base64'),
              });
            } else {
              this.debugEvent(runId, 'ai_reply.image_attachment_empty', {
                chatGuid,
                attachmentGuid: att.guid,
              }, 'warn');
            }
          } catch (err) {
            this.log.warn(`Failed to fetch attachment ${att.guid}:`, err);
            this.debugEvent(runId, 'ai_reply.image_attachment_failed', {
              chatGuid,
              attachmentGuid: att.guid,
              error: err,
            }, 'warn');
          }
        }
        if (parts.length > 0) {
          messages[messages.length - 1] = { ...lastMsg, content: parts };
        }
      }

      this.log.info(`AI generating reply for ${chatGuid} (${messages.length} messages in context)`);
      this.debugEvent(runId, 'ai_reply.generate.started', {
        chatGuid,
        messageGuid: msg.guid,
        messageCount: messages.length,
      }, 'info');

      failureStage = 'generating reply';
      result = await this.generateReply(chatGuid, {
        messages,
        systemPrompt,
        modelKey: threadSettings?.modelOverride ?? this.config.modelOverride,
        profileKey: threadSettings?.profileOverride ?? this.config.profileOverride,
        reasoningEffort: threadSettings?.reasoningEffort ?? this.config.reasoningEffort,
        fallbackEnabled: threadSettings?.fallbackEnabled ?? this.config.fallbackEnabled,
        tools: true,
      }, runId);

      let responseText = result.text.trim();
      const historyText = (result.historyText ?? result.text).trim();
      historyTextForFailure = historyText;
      responseTextForFailure = responseText;

      if (!responseText || responseText === '[NO_REPLY]' || responseText.includes('[NO_REPLY]')) {
        if (historyText && !historyText.includes('[NO_REPLY]')) {
          this.history.appendMessage(chatGuid, {
            role: 'assistant',
            content: historyText,
          });
        }
        this.log.info(`AI decided not to reply in ${chatGuid}`);
        this.debugEvent(runId, 'ai_reply.no_reply', {
          chatGuid,
          messageGuid: msg.guid,
          responseText,
          historyText,
          toolCalls: result.toolCalls,
        }, 'info');
        return;
      }

      // Extract and handle reaction instructions [REACT:type]
      failureStage = 'handling reactions';
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
              this.debugEvent(runId, 'ai_reply.reaction_sent', {
                chatGuid,
                messageGuid: msg.guid,
                reactionType,
              }, 'info');
            } catch (err) {
              this.log.warn(`AI reaction failed:`, err);
              this.debugEvent(runId, 'ai_reply.reaction_failed', {
                chatGuid,
                messageGuid: msg.guid,
                reactionType,
                error: err,
              }, 'warn');
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
        this.debugEvent(runId, 'ai_reply.completed_reaction_only', {
          chatGuid,
          messageGuid: msg.guid,
          reactions,
          historyText,
        }, 'info');
        return;
      }

      // Extract and send media attachments (kai-media:// URLs in markdown image syntax)
      failureStage = 'sending media attachments';
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
              this.debugEvent(runId, 'ai_reply.media_rejected', {
                chatGuid,
                reason: 'unsafe_segment',
                relativePath,
              }, 'warn');
              continue;
            }
            const filePath = resolve(mediaRoot, relativePath);
            if (filePath !== mediaRoot && !filePath.startsWith(mediaRoot + sep)) {
              this.log.warn(`Rejected kai-media path (escapes media root): ${filePath}`);
              this.debugEvent(runId, 'ai_reply.media_rejected', {
                chatGuid,
                reason: 'escapes_media_root',
                filePath,
              }, 'warn');
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
              this.debugEvent(runId, 'ai_reply.media_sent', {
                chatGuid,
                filename,
                mimeType,
                result,
              }, 'info');

              // Push a synthetic message to the UI so the image shows immediately
              if (this.stateCallback.onMessageSent && result) {
                const bbMsg = (result as any).data ?? result;
                if (bbMsg?.guid) {
                  this.stateCallback.onMessageSent(chatGuid, bbMsg);
                }
              }
            } else {
              this.log.warn(`Media file not found: ${filePath}`);
              this.debugEvent(runId, 'ai_reply.media_missing', {
                chatGuid,
                filePath,
              }, 'warn');
            }
          } catch (err) {
            this.log.error(`Failed to send attachment:`, err);
            this.debugEvent(runId, 'ai_reply.media_failed', {
              chatGuid,
              media,
              error: err,
            }, 'error');
          }
        }

        // Strip markdown image syntax from text
        responseText = responseText.replace(mediaPattern, '').trim();
        responseTextForFailure = responseText;
      }

      // If only media was sent and no text remains, we're done
      if (!responseText || responseText === '[NO_REPLY]') {
        this.recentReplies.set(chatGuid, Date.now());
        this.history.appendMessage(chatGuid, {
          role: 'assistant',
          content: historyText || result.text.trim(),
        });
        this.debugEvent(runId, 'ai_reply.completed_media_only', {
          chatGuid,
          messageGuid: msg.guid,
          mediaCount: mediaMatches.length,
          historyText,
        }, 'info');
        return;
      }

      // Chunk and send text
      failureStage = 'sending final reply';
      responseTextForFailure = responseText;
      await this.sendTextChunks(chatGuid, responseText, result.toolCalls, runId);

      // Record in history
      this.history.appendMessage(chatGuid, {
        role: 'assistant',
        content: historyText || responseText,
      });

      this.log.info(`AI replied in ${chatGuid}: ${responseText.slice(0, 100)}...`);
      this.debugEvent(runId, 'ai_reply.completed', {
        chatGuid,
        messageGuid: msg.guid,
        responseText,
        historyText,
        toolCalls: result.toolCalls,
      }, 'info');
    } catch (err) {
      this.log.error(`AI reply failed for ${chatGuid}:`, err);
      const generationError = err instanceof AIReplyGenerationError ? err : null;
      const stage = generationError?.stage ?? failureStage;
      const error = errorToString(err);
      const toolCalls = generationError?.toolCalls?.length
        ? generationError.toolCalls
        : result?.toolCalls;
      const partialText = generationError?.partialText || generationError?.historyText || historyTextForFailure;
      const generatedText = stage.toLowerCase().includes('send') ? responseTextForFailure : undefined;

      this.debugEvent(runId, 'ai_reply.failed', {
        chatGuid,
        messageGuid: msg.guid,
        stage,
        error: err,
        partialText,
        generatedText,
        result,
        toolCalls,
      }, 'error');
      this.publishFailureMessage(chatGuid, {
        stage,
        error,
        runId,
        toolCalls,
        partialText,
        generatedText,
      });
    } finally {
      if (typingInterval) { clearInterval(typingInterval); typingInterval = null; }
      this.stateCallback.setAIReplyProcessing(chatGuid, false);
      this.debugEvent(runId, 'ai_reply.processing_stopped', {
        chatGuid,
        messageGuid: msg.guid,
      }, 'info');
    }
  }

  private buildSystemPrompt(
    isGroup: boolean,
    chat: NormalizedChat | undefined,
    chatGuid: string,
    overridePrompt?: string,
  ): string {
    const base = overridePrompt || this.config.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT;
    const parts = [base];
    const currentChatGuid = chat?.guid || chatGuid;

    if (chat) {
      parts.push('');
      parts.push(`Chat: ${chat.displayName}`);
      parts.push(`BlueBubbles chat GUID: ${currentChatGuid}`);
      parts.push(`Service: ${chat.service}`);
      parts.push(`Type: ${isGroup ? 'Group chat' : 'Direct message'}`);

      if (chat.participants.length > 0) {
        const names = chat.participants.map((p) => {
          const saved = this.contacts.get(p.address);
          return saved ? `${saved} (${p.address})` : p.displayName || p.address;
        });
        parts.push(`Participants: ${names.join(', ')}`);
      }
    } else {
      parts.push('');
      parts.push(`BlueBubbles chat GUID: ${currentChatGuid}`);
    }

    parts.push('');
    parts.push('Tool progress updates:');
    parts.push(`- Your ordinary final response is buffered and sent automatically after the tool loop finishes.`);
    parts.push(`- For long-running work, you may call send-message with chatGuid "${currentChatGuid}" to send a brief progress/status update before continuing.`);
    parts.push('- Do not use send-message for the final answer to this same incoming message; return final text normally after the needed tools succeed or fail.');
    parts.push('- After any progress update, keep working until you can provide a final completion or blocked message.');
    parts.push('- Treat tool outputs with isError: true, an error field, success/ok false, or a nonzero exitCode as failures; retry with a valid alternate call when possible.');

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

export type PluginComponentProps<
  TState = Record<string, unknown>,
  TConfig = Record<string, unknown>,
> = {
  pluginName: string;
  pluginState?: TState;
  pluginConfig?: TConfig;
  setPluginConfig?: (path: string, value: unknown) => Promise<void>;
  onAction: (action: string, data?: unknown) => void;
  onClose?: () => void;
  props?: Record<string, unknown>;
};

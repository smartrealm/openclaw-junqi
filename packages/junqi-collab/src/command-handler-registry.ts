import { COMMAND_KINDS, type CommandKind, type CommandRecord } from "./types.js";

export type CommandHandler = (command: CommandRecord) => boolean | Promise<boolean>;

export class CommandHandlerRegistry {
  readonly #handlers: ReadonlyMap<CommandKind, CommandHandler>;

  constructor(
    entries: ReadonlyArray<readonly [CommandKind, CommandHandler]>,
    options: { allowPartial?: boolean } = {},
  ) {
    const handlers = new Map<CommandKind, CommandHandler>();
    const knownKinds = new Set<string>(COMMAND_KINDS);
    for (const [kind, handler] of entries) {
      if (!knownKinds.has(kind)) {
        throw new TypeError(`Unsupported collaboration command kind: ${String(kind)}`);
      }
      if (typeof handler !== "function") {
        throw new TypeError(`Command handler for ${kind} must be a function`);
      }
      if (handlers.has(kind)) {
        throw new TypeError(`Duplicate collaboration command handler: ${kind}`);
      }
      handlers.set(kind, handler);
    }
    if (options.allowPartial !== true) {
      const missing = COMMAND_KINDS.filter((kind) => !handlers.has(kind));
      if (missing.length > 0) {
        throw new TypeError(`Missing collaboration command handlers: ${missing.join(", ")}`);
      }
    }
    this.#handlers = handlers;
  }

  static partial(entries: ReadonlyArray<readonly [CommandKind, CommandHandler]>): CommandHandlerRegistry {
    return new CommandHandlerRegistry(entries, { allowPartial: true });
  }

  has(kind: CommandKind): boolean {
    return this.#handlers.has(kind);
  }

  async execute(command: CommandRecord): Promise<boolean> {
    const handler = this.#handlers.get(command.kind);
    if (!handler) {
      throw new Error(`No collaboration command handler registered for ${command.kind}`);
    }
    const skipSettle = await handler(command);
    if (typeof skipSettle !== "boolean") {
      throw new Error(`Command handler ${command.kind} returned a non-boolean settle decision`);
    }
    return skipSettle;
  }
}

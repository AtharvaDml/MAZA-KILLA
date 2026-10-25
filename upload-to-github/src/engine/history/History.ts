export interface Command {
  label: string;
  undo(): void;
  redo(): void;
  /** Approximate retained memory, for the history budget. */
  bytes?: number;
  /** Consecutive commands with the same key (within a short window) merge into one entry. */
  coalesceKey?: string;
  /** Absorb `next` into this command (keep my "before", take its "after"). */
  merge?(next: Command): boolean;
}

interface Entry { cmd: Command; at: number }

/** Linear undo/redo stack with coalescing and a memory budget. Commands are pushed after they ran. */
export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private bytes = 0;
  onChange: () => void = () => {};

  constructor(private readonly maxEntries = 200, private readonly maxBytes = 96 * 1024 * 1024) {}

  push(cmd: Command) {
    const now = performance.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && cmd.coalesceKey && top.cmd.coalesceKey === cmd.coalesceKey && now - top.at < 900 && top.cmd.merge?.(cmd)) {
      top.at = now;
    } else {
      this.undoStack.push({ cmd, at: now });
      this.bytes += cmd.bytes ?? 256;
    }
    for (const e of this.redoStack) this.bytes -= e.cmd.bytes ?? 256;
    this.redoStack = [];
    while (this.undoStack.length > this.maxEntries || (this.bytes > this.maxBytes && this.undoStack.length > 1)) {
      const old = this.undoStack.shift()!;
      this.bytes -= old.cmd.bytes ?? 256;
    }
    this.onChange();
  }

  undo(): Command | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    e.cmd.undo();
    this.redoStack.push(e);
    this.onChange();
    return e.cmd;
  }

  redo(): Command | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    e.cmd.redo();
    this.undoStack.push(e);
    this.onChange();
    return e.cmd;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
    this.onChange();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.cmd.label ?? ''; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.cmd.label ?? ''; }
}

export class CompositeCommand implements Command {
  bytes: number;
  constructor(public label: string, private readonly cmds: Command[]) {
    this.bytes = cmds.reduce((a, c) => a + (c.bytes ?? 256), 0);
  }
  undo() { for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i].undo(); }
  redo() { for (const c of this.cmds) c.redo(); }
}

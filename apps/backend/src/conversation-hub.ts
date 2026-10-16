import type { TenantContext } from "@momo/workspace";

type Listener = () => void;

/** Carries no event data, so each stream re-reads the log with its own TenantContext and a wake-up cannot leak events. */
export class ConversationHub {
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #closers = new Set<Listener>();

  subscribe(
    tenant: TenantContext,
    conversationId: string,
    listener: Listener,
    onClose: Listener,
  ): () => void {
    const key = `${tenant.workspaceId}/${conversationId}`;
    const set = this.#listeners.get(key) ?? new Set();
    set.add(listener);
    this.#listeners.set(key, set);
    this.#closers.add(onClose);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.#listeners.delete(key);
      this.#closers.delete(onClose);
    };
  }

  notify(workspaceId: string, conversationId: string): void {
    for (const listener of this.#listeners.get(`${workspaceId}/${conversationId}`) ?? []) listener();
  }

  closeAll(): void {
    const closers = Array.from(this.#closers);
    for (const close of closers) close();
  }
}

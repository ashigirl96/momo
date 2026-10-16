import type { RunnerInbound } from "@momo/contracts";

type Listener = (message: unknown) => void;

/** Each side receives `unknown` and validates it against the contract, because the mailbox crosses a trust boundary (ADR-0009). */
export class SessionMailbox {
  #inbound: Listener[] = [];
  #outbound: Listener[] = [];

  postInbound(message: RunnerInbound): void {
    this.#deliver(this.#inbound, message);
  }

  onInbound(listener: Listener): void {
    this.#inbound.push(listener);
  }

  postOutbound(message: unknown): void {
    this.#deliver(this.#outbound, message);
  }

  onOutbound(listener: Listener): void {
    this.#outbound.push(listener);
  }

  #deliver(listeners: Listener[], message: unknown): void {
    const copy = structuredClone(message);
    queueMicrotask(() => {
      for (const listener of listeners) listener(copy);
    });
  }
}

export type Runner = {
  attach(mailbox: SessionMailbox): void;
  stop(): void;
};

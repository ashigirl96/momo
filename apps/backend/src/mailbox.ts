import type { RunnerInbound } from "@momo/contracts";

type Listener = (message: unknown) => void;

/**
 * One Session's mailbox in the backend's process (ADR-0009). The backend posts only inbound and
 * the runner only outbound; each side receives `unknown` and validates it against the contract,
 * as it will when P3 puts the mailbox in the Session dir. Delivery is asynchronous like a file.
 */
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

/** Something that answers Runs through Session mailboxes: the fake runner in P2, the sandbox in P3. */
export type Runner = {
  attach(mailbox: SessionMailbox): void;
  stop(): void;
};

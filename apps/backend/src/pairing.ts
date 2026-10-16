import { createHash, randomBytes } from "node:crypto";

export const PAIRING_TTL_MS = 60_000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** One-time tokens handed to `momo open`; they live only in this process. */
export class PairingTokens {
  private readonly expiries = new Map<string, number>();

  constructor(private readonly now: () => Date) {}

  issue(): { token: string; expiresAt: Date } {
    this.prune();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + PAIRING_TTL_MS);
    this.expiries.set(hash(token), expiresAt.getTime());
    return { token, expiresAt };
  }

  consume(token: string): boolean {
    const key = hash(token);
    const expiresAt = this.expiries.get(key);
    this.expiries.delete(key);
    return expiresAt !== undefined && this.now().getTime() < expiresAt;
  }

  private prune() {
    const now = this.now().getTime();
    for (const [key, expiresAt] of this.expiries) if (expiresAt <= now) this.expiries.delete(key);
  }
}

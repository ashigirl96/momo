/** The fixed port; moving it changes the origin and drops every Login cookie. */
export const DEFAULT_PORT = 47317;

export const HOSTNAME = "momo.localhost";

export function defaultDataDir(home: string): string {
  return `${home}/.momo`;
}

export function pairingSocketPath(dataDir: string): string {
  return `${dataDir}/momo.sock`;
}

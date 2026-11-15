import type { NextConfig } from 'next';
export type WithJellyfinOptions = {
    /** Jellyfin server; default: env JELLYFIN_SERVER_URL. Without it, proxy mode is off. */
    serverUrl?: string;
    /** Same as the component's `basePath` (default: `/jellyfin`). */
    basePath?: string;
};
/**
 * Enables "proxy" mode: `/jellyfin/*` is served from `<serverUrl>/web/*`, so the web client always matches
 * your server version and server-side web plugins (JavaScript Injector, File Transformation, ...) work.
 *
 * It is a `fallback` rewrite: a copy installed in `public/jellyfin` (`npx next-jellyfin sync`) always wins.
 *
 *   // next.config.ts
 *   import { withJellyfin } from 'next-jellyfin/config';
 *   export default withJellyfin({ ...yourConfig });
 */
export declare function withJellyfin(config?: NextConfig, options?: WithJellyfinOptions): NextConfig;
export default withJellyfin;

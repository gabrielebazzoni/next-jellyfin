/**
 * Resolves the real API root of a Jellyfin server.
 *
 * Jellyfin can run under a "Base URL" (Dashboard → Networking), e.g. `https://host/media-server`. If the user passes
 * only `https://host`, `/System/Info/Public` is redirected to the web UI (`<base>/web/`) instead of returning JSON,
 * and the browser fails with CORS errors. This follows that redirect and returns `https://host/media-server`.
 */
export type PublicSystemInfo = {
    Id: string;
    ServerName?: string;
    Version?: string;
};
export declare class JellyfinServerError extends Error {
}
export declare function resolveServerUrl(serverUrl: string): Promise<{
    url: string;
    info: PublicSystemInfo;
}>;

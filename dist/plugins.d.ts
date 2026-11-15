/**
 * Server plugins such as InPlayerEpisodePreview, JavaScript Injector or File Transformation add <script>, <link>
 * and <style> tags to the index.html served by Jellyfin (`<server>/web/index.html`). The copy in
 * `public/jellyfin` doesn't have them, and in proxy mode their URLs point to the Next.js site instead of Jellyfin.
 *
 * This reads the server's index.html, keeps only what plugins added, and makes every URL absolute to the server,
 * so the tags can be injected into the client by <JellyfinFrame>.
 */
export type InjectedTag = {
    tag: 'script' | 'link' | 'style';
    attrs: Record<string, string>;
    text?: string;
};
export declare function extractPluginTags(html: string, webIndexUrl: string): InjectedTag[];
/** Plugin tags of a (resolved) Jellyfin server. Never throws: on errors it returns no tags. */
export declare function getPluginTags(serverUrl: string): Promise<InjectedTag[]>;

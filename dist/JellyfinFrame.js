'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
/** Adds the server plugins' tags to the client document, skipping anything it already has. */
function injectTags(doc, tags) {
    const has = (selector, value) => [...doc.querySelectorAll(selector)].some(el => selector === 'script[src]' ? el.src === value
        : selector === 'link[href]' ? el.href === value
            : el.textContent?.trim() === value.trim());
    for (const { tag, attrs, text } of tags) {
        if (tag === 'script' && attrs.src && has('script[src]', attrs.src))
            continue;
        if (tag === 'link' && has('link[href]', attrs.href))
            continue;
        if (text !== undefined && has(tag === 'style' ? 'style' : 'script:not([src])', text))
            continue;
        const el = doc.createElement(tag);
        for (const [name, value] of Object.entries(attrs)) {
            if (name !== 'defer' && name !== 'async')
                el.setAttribute(name, value);
        }
        if (tag === 'script')
            el.async = false; // keep the server's order
        if (text !== undefined)
            el.textContent = text;
        el.setAttribute('data-next-jellyfin', '');
        (tag === 'script' ? doc.body : doc.head).appendChild(el);
    }
}
export default function JellyfinFrame({ src, srcDoc, inject, className, style, title }) {
    const ref = useRef(null);
    useEffect(() => {
        const frame = ref.current;
        if (!frame || inject.length === 0)
            return;
        const onLoad = () => {
            try {
                const win = frame.contentWindow;
                const doc = frame.contentDocument;
                // Skip the srcDoc bootstrap page: it navigates to the client right away.
                if (!win || !doc || win.location.href === 'about:srcdoc' || !doc.querySelector('#reactRoot'))
                    return;
                injectTags(doc, inject);
            }
            catch {
                // cross-origin client: nothing to do
            }
        };
        frame.addEventListener('load', onLoad);
        if (frame.contentDocument?.readyState === 'complete')
            onLoad();
        return () => frame.removeEventListener('load', onLoad);
    }, [inject]);
    return (_jsx("iframe", { ref: ref, src: src, srcDoc: srcDoc, title: title, className: className, style: { border: 0, width: '100%', height: '100%', display: 'block', ...style }, allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media', allowFullScreen: true }));
}

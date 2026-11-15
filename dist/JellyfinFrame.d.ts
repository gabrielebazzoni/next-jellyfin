import { type CSSProperties } from 'react';
import type { InjectedTag } from './plugins.js';
export type JellyfinFrameProps = {
    src?: string;
    srcDoc?: string;
    inject: InjectedTag[];
    className?: string;
    style?: CSSProperties;
    title: string;
};
export default function JellyfinFrame({ src, srcDoc, inject, className, style, title }: JellyfinFrameProps): import("react").JSX.Element;

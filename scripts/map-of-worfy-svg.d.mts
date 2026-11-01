// Types of scripts/map-of-worfy-svg.mjs for its unit test.
export type Scheme = 'light' | 'dark'
export declare const SCHEMES: readonly Scheme[]
export declare function svgPath(scheme: Scheme): string
export declare function mix(colour: string, share: number, ground: string): string
/** A text of the SVG: its content, its colour and the colour of the ground it is drawn on, as #rrggbb. */
export interface DrawnText {
  text: string
  fill: string
  ground: string
}
export declare function renderMapSvg(scheme: Scheme): { svg: string; texts: DrawnText[] }

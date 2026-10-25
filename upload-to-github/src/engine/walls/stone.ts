import type { StoneStyle } from '../../state/store';

/** Multipliers applied over the neutral masonry texture. */
export const STONE_TINTS: Record<StoneStyle, number> = {
  laterite: 0xf2b494,
  basalt: 0xc4c0b8,
  weathered: 0xf4ead2,
};
export const STONE_NAMES: Record<StoneStyle, string> = {
  laterite: 'Laterite',
  basalt: 'Basalt',
  weathered: 'Weathered',
};
/** World units per masonry texture tile. */
export const STONE_TILE = 6;

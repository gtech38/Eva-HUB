import type { ThemeKey } from "@hub/db";
import type { Theme } from "./types";
import { luxury } from "./luxury";
import { romantic } from "./romantic";
import { hinduTraditional } from "./hindu-traditional";
import { nurserySage } from "./nursery-sage";
import { teluguTraditional } from "./telugu-traditional";
import { midnightGala } from "./midnight-gala";

export const THEMES: Record<ThemeKey, Theme> = {
  LUXURY: luxury,
  ROMANTIC: romantic,
  HINDU_TRADITIONAL: hinduTraditional,
  NURSERY_SAGE: nurserySage,
  TELUGU_TRADITIONAL: teluguTraditional,
  MIDNIGHT_GALA: midnightGala,
};

export function themeFor(key: ThemeKey): Theme {
  return THEMES[key] ?? luxury;
}

export type { Theme, ShellProps, HeroProps, NavItem } from "./types";

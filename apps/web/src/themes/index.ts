import type { ThemeKey } from "@hub/db";
import type { Theme } from "./types";
import { luxury } from "./luxury";
import { romantic } from "./romantic";
import { hinduTraditional } from "./hindu-traditional";

export const THEMES: Record<ThemeKey, Theme> = {
  LUXURY: luxury,
  ROMANTIC: romantic,
  HINDU_TRADITIONAL: hinduTraditional,
};

export function themeFor(key: ThemeKey): Theme {
  return THEMES[key] ?? luxury;
}

export type { Theme, ShellProps, HeroProps, NavItem } from "./types";

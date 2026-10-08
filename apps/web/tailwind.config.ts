import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        fg: "var(--fg)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        "accent-fg": "var(--accent-fg)",
        line: "var(--line)",
      },
      fontFamily: {
        display: ["var(--font-display)", "var(--font-telugu)", "var(--font-devanagari)", "serif"],
        body: ["var(--font-body)", "var(--font-telugu)", "var(--font-devanagari)", "sans-serif"],
        script: ["var(--font-script)", "cursive"],
      },
      borderRadius: { theme: "var(--radius)" },
    },
  },
  plugins: [],
} satisfies Config;

// tdd-exempt: ambient type for `?raw` imports (Vite/vitest natively, Next via the asset/source rule in next.config.ts).
declare module "*?raw" {
  const content: string;
  export default content;
}

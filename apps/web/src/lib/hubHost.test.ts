import { describe, expect, it } from "vitest";
import { HUB_HOST_HEADER, hostOf } from "./hubHost.ts";

describe("hostOf (the Host header as the router sees it)", () => {
  it("lowercases and drops the port", () => {
    expect(hostOf("Priya-Arjun.LOCALHOST:3000")).toBe("priya-arjun.localhost");
    expect(hostOf("priyaandarjun.com")).toBe("priyaandarjun.com");
  });
  it("is empty for a missing header", () => {
    expect(hostOf(null)).toBe("");
  });
  it("names the trusted header", () => {
    expect(HUB_HOST_HEADER).toBe("x-hub-host");
  });
});

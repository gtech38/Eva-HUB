import { describe, expect, it } from "vitest";
import { csvRecords } from "@/lib/csv";
import { GET } from "./route";

describe("guest import template", () => {
  it("is pinned: phones are plain E.164 (no formula apostrophe) and the header matches the importer", async () => {
    const res = await GET();
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const text = await res.text();
    expect(text).not.toContain("'+");
    const { headers, records } = csvRecords(text);
    expect(headers).toEqual(["household", "first_name", "last_name", "email", "phone", "is_child", "plus_ones", "sub_events"]);
    expect(records.map((r) => r.phone)).toEqual(["+15125550101", "+15125550102", "", ""]);
    expect(text).toContain("Lakshmi,Rao,lakshmi@example.com,+15125550101,");
  });
});

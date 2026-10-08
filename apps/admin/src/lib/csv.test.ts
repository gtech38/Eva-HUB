import { describe, expect, it } from "vitest";
import { csvFile, parseCsv, toCsv } from "./csv";

describe("toCsv()", () => {
  it("quotes commas, quotes and newlines (RFC 4180) with CRLF rows", () => {
    expect(toCsv([["a,b", 'say "hi"', "x\ny"], [1, null, undefined]])).toBe('"a,b","say ""hi""","x\ny"\r\n1,,\r\n');
  });

  it("neutralises spreadsheet formulas: cells starting with = + - @ get a leading apostrophe", () => {
    const out = parseCsv(toCsv([["=HYPERLINK(\"http://evil\",\"x\")", "+SUM(1)", "-2+3", "@SUM(A1)", "Rao", "a=b"]]))[0];
    expect(out).toEqual(["'=HYPERLINK(\"http://evil\",\"x\")", "'+SUM(1)", "'-2+3", "'@SUM(A1)", "Rao", "a=b"]);
  });

  it("also neutralises tab and carriage-return prefixes (OWASP CSV injection list)", () => {
    const out = parseCsv(toCsv([["\t=1", "\r=1"]]))[0];
    expect(out).toEqual(["'\t=1", "'\r=1"]);
  });

  it("leaves strictly phone-shaped strings alone so phones stay importable and dialable", () => {
    const out = parseCsv(toCsv([["+15125550101", "+1 (512) 555-0101", "+91 98765 43210", "+44.20.7946.0958"]]))[0];
    expect(out).toEqual(["+15125550101", "+1 (512) 555-0101", "+91 98765 43210", "+44.20.7946.0958"]);
  });

  it("still prefixes formulas that merely begin like a phone number or contain operators", () => {
    const out = parseCsv(toCsv([["=HYPERLINK(\"http://evil\",\"x\")", "@SUM(A1)", "+1+cmd|' /C calc'!A0", "+1 555;=1+1", "-15125550101", "+"]]))[0];
    expect(out).toEqual(["'=HYPERLINK(\"http://evil\",\"x\")", "'@SUM(A1)", "'+1+cmd|' /C calc'!A0", "'+1 555;=1+1", "'-15125550101", "'+"]);
  });

  it("leaves numbers alone, including negative ones", () => {
    expect(toCsv([[-3, 0, 12]])).toBe("-3,0,12\r\n");
  });
});

describe("csvFile()", () => {
  it("prefixes a UTF-8 BOM so Excel reads Telugu and Hindi names", () => {
    const body = csvFile([["name"], ["రావు కుటుంబం"], ["शर्मा परिवार"]]);
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.slice(1)).toBe("name\r\nరావు కుటుంబం\r\nशर्मा परिवार\r\n");
    const bytes = new TextEncoder().encode(body);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("round-trips through parseCsv (which strips the BOM)", () => {
    expect(parseCsv(csvFile([["a", "b"], ["1", "2"]]))).toEqual([["a", "b"], ["1", "2"]]);
  });
});

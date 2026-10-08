import { describe, expect, it } from "vitest";
import { splitCoupleNames, monogramFor } from "./names.ts";

describe("names", () => {
  it("splits on ampersand, plus and the word 'and' as a separate word", () => {
    expect(splitCoupleNames("Priya & Arjun")).toStrictEqual(["Priya", "Arjun"]);
    expect(splitCoupleNames("Sandra and Tom")).toStrictEqual(["Sandra", "Tom"]);
    expect(splitCoupleNames("Brandon + Amanda")).toStrictEqual(["Brandon", "Amanda"]);
    expect(splitCoupleNames("Emma  &  Liam")).toStrictEqual(["Emma", "Liam"]);
  });

  it("never splits inside a name that contains 'and'", () => {
    expect(splitCoupleNames("Anand & Priya")).toStrictEqual(["Anand", "Priya"]);
    expect(splitCoupleNames("Chandra and Nandini")).toStrictEqual(["Chandra", "Nandini"]);
    expect(splitCoupleNames("Anand")).toBe(null);
    expect(splitCoupleNames("Brandon")).toBe(null);
  });

  it("returns null for single-subject titles and Indic titles without a separator", () => {
    expect(splitCoupleNames("Ravi at Fifty")).toBe(null);
    expect(splitCoupleNames("Gruhapravesam · The Reddy Home")).toBe(null);
    expect(splitCoupleNames("ప్రియ & అర్జున్")).toStrictEqual(["ప్రియ", "అర్జున్"]);
  });

  it("monogram takes the first letter of each side, or the first letter of the title", () => {
    expect(monogramFor("Sandra and Tom")).toBe("S&T");
    expect(monogramFor("Anand & Priya")).toBe("A&P");
    expect(monogramFor("Ravi at Fifty")).toBe("R");
    expect(monogramFor("")).toBe("");
  });
});

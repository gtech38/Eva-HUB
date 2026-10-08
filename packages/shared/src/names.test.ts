import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCoupleNames, monogramFor } from "./names.ts";

test("splits on ampersand, plus and the word 'and' as a separate word", () => {
  assert.deepEqual(splitCoupleNames("Priya & Arjun"), ["Priya", "Arjun"]);
  assert.deepEqual(splitCoupleNames("Sandra and Tom"), ["Sandra", "Tom"]);
  assert.deepEqual(splitCoupleNames("Brandon + Amanda"), ["Brandon", "Amanda"]);
  assert.deepEqual(splitCoupleNames("Emma  &  Liam"), ["Emma", "Liam"]);
});

test("never splits inside a name that contains 'and'", () => {
  assert.deepEqual(splitCoupleNames("Anand & Priya"), ["Anand", "Priya"]);
  assert.deepEqual(splitCoupleNames("Chandra and Nandini"), ["Chandra", "Nandini"]);
  assert.equal(splitCoupleNames("Anand"), null);
  assert.equal(splitCoupleNames("Brandon"), null);
});

test("returns null for single-subject titles and Indic titles without a separator", () => {
  assert.equal(splitCoupleNames("Ravi at Fifty"), null);
  assert.equal(splitCoupleNames("Gruhapravesam · The Reddy Home"), null);
  assert.deepEqual(splitCoupleNames("ప్రియ & అర్జున్"), ["ప్రియ", "అర్జున్"]);
});

test("monogram takes the first letter of each side, or the first letter of the title", () => {
  assert.equal(monogramFor("Sandra and Tom"), "S&T");
  assert.equal(monogramFor("Anand & Priya"), "A&P");
  assert.equal(monogramFor("Ravi at Fifty"), "R");
  assert.equal(monogramFor(""), "");
});

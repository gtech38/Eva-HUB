/**
 * Server render of the guest sign-in form (ADM-005): after a dead invitation link
 * (`/?invite=expired`) the form explains the expiry; otherwise it is unchanged.
 * Playwright (#86) will cover the same page in a browser; this pins the markup until then.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let search = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search) }));
vi.mock("@/app/sites/[slug]/auth/actions", () => ({ requestSignIn: async () => null }));

const { SignIn } = await import("./SignIn");

function render(query: string, locale: "en" | "te" | "hi" = "en") {
  search = query;
  return renderToStaticMarkup(
    createElement(SignIn, {
      title: "Priya & Arjun",
      monogram: "P&A",
      locale,
      strings: { signIn: "Sign in", signInHelp: "Enter the email or phone your invitation was sent to.", sending: "…" },
      divider: null,
    }),
  );
}

const headings = (html: string) => [...html.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/g)].map((m) => m[1]);

describe("SignIn", () => {
  it("expired token page renders the sign-in form and the heading mentions expiry", () => {
    const html = render("invite=expired");
    expect(html).toContain('name="contact"');
    expect(html).toContain('type="submit"');
    expect(headings(html).some((h) => /expired/i.test(h!))).toBe(true);
    expect(html).toContain("Enter your email or phone and we&#x27;ll send you a new one.");
  });

  it("the expiry heading follows the site locale", () => {
    expect(headings(render("invite=expired", "te"))).toContain("ఈ లింక్ గడువు ముగిసింది");
  });

  it("an ordinary visit shows no expiry notice", () => {
    const html = render("");
    expect(html).toContain('name="contact"');
    expect(html).not.toMatch(/expired/i);
  });
});

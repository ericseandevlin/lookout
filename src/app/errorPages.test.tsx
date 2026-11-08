import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import NotFound from "./not-found";
import ErrorPage from "./error";
import GlobalError from "./global-error";

const noop = () => {};

describe("404 and error pages (#396)", () => {
  it("404 has the wordmark, says what happened, and links home", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("Lookout");
    expect(html).toContain("This page isn");
    expect(html).toContain('href="/"');
  });

  it("error page offers a retry and shows the digest, never the message", () => {
    const err = Object.assign(new Error("secret db detail"), { digest: "abc123" });
    const html = renderToStaticMarkup(<ErrorPage error={err} reset={noop} />);
    expect(html).toContain("Try again");
    expect(html).toContain("abc123");
    expect(html).not.toContain("secret db detail");
  });

  it("error page with no digest shows no reference line", () => {
    const html = renderToStaticMarkup(<ErrorPage error={new Error("x")} reset={noop} />);
    expect(html).not.toContain("Reference");
  });

  it("global error brings its own html and body", () => {
    const html = renderToStaticMarkup(<GlobalError error={Object.assign(new Error("boom"), { digest: "d1" })} reset={noop} />);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<body>");
    expect(html).toContain("d1");
    expect(html).not.toContain("boom");
  });
});

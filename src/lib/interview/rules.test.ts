import { describe, expect, it } from "vitest";
import { factKey, factsBlock, LOCK, lockReason, topicKey } from "./rules";

describe("lockReason", () => {
  it("leaves a plain fact shareable", () => {
    expect(lockReason("Grew event revenue 30% in two years.", "result")).toBeNull();
    expect(lockReason("Grew event revenue 30% in two years.", "result", {})).toBeNull();
  });

  it("always locks pay, whatever the flags say", () => {
    expect(lockReason("$140k base", "pay")).toBe(LOCK.pay);
    expect(lockReason("My boss was a nightmare about my $140k base", "pay", { complaint: true, namesPerson: true })).toBe(LOCK.pay);
  });

  it("locks a complaint the model flagged", () => {
    expect(lockReason("The team missed every deadline.", "background", { complaint: true })).toBe(LOCK.complaint);
  });

  it.each(["hate", "hated", "hates", "awful", "terrible", "toxic", "incompetent", "micromanaged", "micromanaging", "blamed", "unfair", "useless", "clueless", "jerk", "nightmare", "worst"])(
    "locks a complaint by its words when the model missed it: %s",
    (word) => {
      expect(lockReason(`It was ${word} there.`, "background")).toBe(LOCK.complaint);
      expect(lockReason(`It was ${word.toUpperCase()} there.`, "background")).toBe(LOCK.complaint);
    },
  );

  it("matches complaint words as whole words only", () => {
    expect(lockReason("Sold chateau wine and hatech sensors.", "skill")).toBeNull();
    expect(lockReason("Ran the Worstead office.", "background")).toBeNull();
  });

  it("gives one flag its own reason", () => {
    expect(lockReason("Reported to Dana.", "background", { namesPerson: true })).toBe(LOCK.person);
    expect(lockReason("The launch date is March.", "project", { confidential: true })).toBe(LOCK.confidential);
    expect(lockReason("Took a year off for family.", "background", { personal: true })).toBe(LOCK.personal);
  });

  it("picks complaint, then person, then confidential, then personal", () => {
    const all = { complaint: true, namesPerson: true, confidential: true, personal: true };
    expect(lockReason("x", "background", all)).toBe(LOCK.complaint);
    expect(lockReason("x", "background", { ...all, complaint: false })).toBe(LOCK.person);
    expect(lockReason("x", "background", { confidential: true, personal: true })).toBe(LOCK.confidential);
    expect(lockReason("Dana was useless.", "background", { namesPerson: true })).toBe(LOCK.complaint);
  });
});

describe("topicKey", () => {
  it("makes one key from the same topic typed two ways", () => {
    expect(topicKey("F&B programs")).toBe("f and b programs");
    expect(topicKey("f&b  programs")).toBe(topicKey("F&B programs"));
    expect(topicKey("  Event-Sales   Leadership!  ")).toBe("event sales leadership");
  });

  it("drops filler words", () => {
    expect(topicKey("The experience of a B2B SaaS skill")).toBe("b2b saas");
    expect(topicKey("Leadership skills")).toBe("leadership");
    expect(topicKey("An eye for detail")).toBe("eye detail");
  });

  it("drops filler as whole words only", () => {
    expect(topicKey("Theater and analytics")).toBe("theater and analytics");
    expect(topicKey("Experienced skillset")).toBe("experienced skillset");
  });

  it("returns an empty key when only filler is left", () => {
    expect(topicKey("The skills of experience")).toBe("");
    expect(topicKey("")).toBe("");
  });
});

describe("factKey", () => {
  it("makes one key from the same fact said two ways", () => {
    expect(factKey("Led a team of 12.")).toBe("led a team of 12");
    expect(factKey("  led a TEAM of 12!! ")).toBe(factKey("Led a team of 12."));
  });

  it("keeps $ and %, so two different numbers are two facts", () => {
    expect(factKey("Grew revenue 30%, to $2M")).toBe("grew revenue 30% to $2m");
    expect(factKey("Grew revenue 30%")).not.toBe(factKey("Grew revenue 30"));
    expect(factKey("Saved $40")).not.toBe(factKey("Saved 40"));
  });

  it("keeps filler words, unlike topicKey", () => {
    expect(factKey("The experience of a lifetime")).toBe("the experience of a lifetime");
  });
});

describe("factsBlock", () => {
  it("is empty when there is nothing to share", () => {
    expect(factsBlock([])).toBe("");
    expect(factsBlock([{ text: "My boss was toxic.", kind: "background", shareable: false }])).toBe("");
  });

  it("lists shareable facts in order, one per line", () => {
    const block = factsBlock([
      { text: "Led a team of 12.", kind: "result", shareable: true },
      { text: "Runs weddings and galas.", kind: "skill", shareable: true },
    ]);
    expect(block).toBe(
      "\n\n<interview_facts from the person, in their words; facts with the same standing as the resume>\n- Led a team of 12.\n- Runs weddings and galas.\n</interview_facts>",
    );
  });

  it("leaves out a private fact", () => {
    const block = factsBlock([
      { text: "Led a team of 12.", kind: "result", shareable: true },
      { text: "Dana blamed me for the budget.", kind: "background", shareable: false },
    ]);
    expect(block).toContain("- Led a team of 12.");
    expect(block).not.toContain("Dana");
  });

  it("leaves out pay even when a caller marks it shareable", () => {
    const block = factsBlock([
      { text: "Led a team of 12.", kind: "result", shareable: true },
      { text: "$140k base", kind: "pay", shareable: true },
    ]);
    expect(block).toContain("- Led a team of 12.");
    expect(block).not.toContain("140k");
    expect(factsBlock([{ text: "$140k base", kind: "pay", shareable: true }])).toBe("");
  });
});

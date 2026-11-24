import { describe, expect, it, vi } from "vitest";
import { menuEscape } from "./shared";

describe("menuEscape (#1662)", () => {
  it("closes the menu on Escape and keeps the drawer from closing too", () => {
    const close = vi.fn();
    const stopPropagation = vi.fn();
    menuEscape(close)({ key: "Escape", stopPropagation });
    expect(close).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });
  it("ignores other keys", () => {
    const close = vi.fn();
    const stopPropagation = vi.fn();
    menuEscape(close)({ key: "ArrowDown", stopPropagation });
    expect(close).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
  });
});

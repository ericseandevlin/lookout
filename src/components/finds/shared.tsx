"use client";

/** Shared by the board and its filter sheet: sort keys and the chip and segment styles. */

export type SortKey = "score" | "company" | "role" | "comp" | "listed" | "stage" | "location";

export const SORTS: [SortKey, string][] = [["score", "Match"], ["comp", "Comp"], ["listed", "Posted"], ["company", "Company"], ["role", "Role"], ["stage", "Stage"], ["location", "Location"]];
const ON = { bg: "#99220F", ink: "#fff", border: "#99220F" };
const OFF = { bg: "#fff", ink: "#1D1A0F", border: "#E0D9CF" };
export const chip = (on: boolean) => (on ? ON : OFF);
export const seg = (on: boolean) => (on ? { bg: "#fff", ink: "#1D1A0F", shadow: "0 1px 3px rgba(29,26,15,.12)" } : { bg: "transparent", ink: "#6B6358", shadow: "none" });

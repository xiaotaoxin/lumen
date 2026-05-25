"use client";

import * as React from "react";

/**
 * Tracks the spacebar held state. Used by the canvas editors to switch
 * the pan / select gesture (Figma-style):
 *   - space held → drag canvas to PAN
 *   - space released → drag canvas to LASSO-SELECT
 *
 * Skips when focus is in a text input / textarea / contenteditable, so the
 * user can still type spaces into prompts and titles.
 */
export function useSpaceToPan(): boolean {
  const [spaceDown, setSpaceDown] = React.useState(false);

  React.useEffect(() => {
    const isEditable = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (e.repeat) return;
      if (isEditable(e)) return;
      e.preventDefault(); // prevent page scroll
      setSpaceDown(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      setSpaceDown(false);
    };
    const onBlur = () => setSpaceDown(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return spaceDown;
}

"use client";

/**
 * Haptics — the small taps you feel when you send a text.
 *
 * There is no single API for this on the web, so this is two implementations
 * behind one function:
 *
 * ANDROID / CHROME use the Vibration API. Straightforward.
 *
 * iOS DOES NOT. Safari has never shipped `navigator.vibrate`, and on an iPhone
 * it is either missing or a no-op. What Safari *does* have, since 17.4, is the
 * native haptic that fires when you flip a `<input type="checkbox" switch>`. So
 * for iOS we keep one hidden switch in the DOM and click its label. That is the
 * whole trick, and it is the only way to get real haptics out of mobile Safari
 * without wrapping the app in a native shell.
 *
 * Two rules everywhere in here:
 * - Never throw. A missing buzz must never break a send.
 * - Respect prefers-reduced-motion. Some people turn this off for a reason.
 */

export type Haptic =
  /** A key press, a tab change, a toggle. The lightest thing there is. */
  | "tap"
  /** Sending a message, taking a photo. A definite, committed action. */
  | "send"
  /** A reply landed, an answer was right. */
  | "success"
  /** Wrong answer, failed request. */
  | "error";

/** Vibration API patterns, in milliseconds. Kept short — long buzzes feel cheap. */
const PATTERNS: Record<Haptic, number | number[]> = {
  tap: 8,
  send: 14,
  success: [12, 40, 18],
  error: [24, 60, 24],
};

let iosSwitch: HTMLLabelElement | null = null;

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/**
 * Build the hidden switch once, on first use.
 *
 * It has to be a real, rendered, interactive element — `display: none` or
 * `hidden` kills the haptic along with the element — so it is parked at 1px,
 * fully transparent, and out of the tab order and the accessibility tree.
 */
function iosTrigger(): HTMLLabelElement | null {
  if (typeof document === "undefined") return null;
  if (iosSwitch) return iosSwitch;

  try {
    const input = document.createElement("input");
    input.type = "checkbox";
    // The `switch` attribute is what makes Safari treat this as a toggle and
    // fire the haptic. Unknown attributes are ignored elsewhere, so this is
    // inert on every other browser.
    input.setAttribute("switch", "");
    input.id = "mint-haptic";
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");

    const label = document.createElement("label");
    label.htmlFor = "mint-haptic";
    label.setAttribute("aria-hidden", "true");

    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;" +
      "pointer-events:none;overflow:hidden;z-index:-1";
    host.setAttribute("aria-hidden", "true");
    host.append(input, label);
    document.body.appendChild(host);

    iosSwitch = label;
    return label;
  } catch {
    return null;
  }
}

/**
 * True on an iPhone or iPad, including an iPad reporting itself as a Mac —
 * which every iPad has done since iPadOS 13, hence the touch-point check.
 */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  } catch {
    return false;
  }
}

/**
 * Fire a haptic. Safe to call from anywhere, including where there is no
 * hardware to fire on — it simply does nothing.
 *
 * Call it from inside the user's own event handler. Both backends need the
 * gesture, and a buzz fired from a timer or a network callback is ignored by
 * the browser on iOS.
 */
export function haptic(kind: Haptic = "tap"): void {
  if (typeof window === "undefined") return;
  if (reducedMotion()) return;

  try {
    if (canVibrate()) {
      navigator.vibrate(PATTERNS[kind]);
      return;
    }

    if (isIOS()) {
      const label = iosTrigger();
      if (!label) return;

      label.click();

      // A double tap for the two-beat patterns, so success and error still
      // feel different from a plain tap.
      if (kind === "success" || kind === "error") {
        window.setTimeout(() => {
          try {
            label.click();
          } catch {
            /* the element went away */
          }
        }, kind === "success" ? 45 : 70);
      }
    }
  } catch {
    /* haptics are decoration; never let one break the thing it decorates */
  }
}

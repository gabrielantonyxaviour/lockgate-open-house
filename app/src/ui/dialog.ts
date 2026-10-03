import { useEffect, useRef, type RefObject } from "react";
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, locked = false, enabled = true) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement as HTMLElement;
    const element = ref.current;
    const first = element?.querySelector<HTMLElement>("input,button:not(:disabled),a[href],textarea");
    (first || element)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked) close.current();
      if (event.key !== "Tab" || !element) return;
      const items = Array.from(
        element.querySelectorAll<HTMLElement>("input,button:not(:disabled),a[href],textarea,select"),
      ).filter((item) => item.getClientRects().length > 0);
      const start = items[0],
        end = items[items.length - 1];
      if (!start) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === start || document.activeElement === element)) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [ref, locked, enabled]);
}

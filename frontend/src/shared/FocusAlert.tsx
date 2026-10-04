import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/** Focus an error the moment it appears (or its text changes), and bring it
 *  into view — the person sees what went wrong without hunting for it, and a
 *  screen reader reads it. Returns the ref to put on the error element. */
export function useFocusOnError<T extends HTMLElement>(trigger: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!trigger || !el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [trigger]);
  return ref;
}

/** An error message that takes the focus when it appears. */
export function FocusAlert({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useFocusOnError<HTMLParagraphElement>(children);
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="alert"
      className={`outline-none ${className}`}
    >
      {children}
    </p>
  );
}

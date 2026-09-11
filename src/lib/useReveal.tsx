import { createElement, useEffect, useRef, useState, type ReactNode } from "react";

// Motion pass — scroll reveals. IntersectionObserver only (no library). Fires
// once per section and stays visible (no re-entry replay — keeps the page calm
// on scroll-up). Under prefers-reduced-motion the CSS reset makes this an
// instant, motionless fade-in regardless of `visible` state, so no branching
// is needed here — this hook only decides *when* the class flips.
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useRevealRef<T extends HTMLElement>(threshold = 0.12) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect(); // replay once, not on re-entry
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return { ref, visible };
}

interface RevealProps {
  children: ReactNode;
  as?: string;
  stagger?: boolean;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
}

/** Wraps a section: fades + rises into place once as it enters the viewport.
 *  Uses createElement (not JSX) for the dynamic tag — a polymorphic JSX
 *  component here blows up TS's attribute-union inference. */
export function Reveal({ children, as = "div", stagger = false, className = "", id, style }: RevealProps) {
  const { ref, visible } = useRevealRef<HTMLElement>();
  const cls = [stagger ? "reveal-stagger" : "reveal", visible ? "is-visible" : "", className]
    .filter(Boolean)
    .join(" ");
  return createElement(as, { ref, className: cls, id, style }, children);
}

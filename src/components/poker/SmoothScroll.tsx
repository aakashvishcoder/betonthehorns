import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useEffect, useRef, useState } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export type SmoothScrollProps = {
  paused?: boolean;
};

function getAnchorTarget(hash: string) {
  if (!hash) {
    return null;
  }

  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return null;
  }
}

export default function SmoothScroll({ paused = false }: SmoothScrollProps) {
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    return window.matchMedia(reducedMotionQuery).matches;
  });
  const lenisRef = useRef<Lenis | null>(null);
  const pausedRef = useRef(paused);
  const rafIdRef = useRef<number | null>(null);
  const startRafRef = useRef<() => void>(() => {});
  const stopRafRef = useRef<() => void>(() => {});

  useEffect(() => {
    const mediaQuery = window.matchMedia(reducedMotionQuery);
    const updateReducedMotion = () => setReducedMotion(mediaQuery.matches);

    updateReducedMotion();
    mediaQuery.addEventListener("change", updateReducedMotion);

    return () => {
      mediaQuery.removeEventListener("change", updateReducedMotion);
    };
  }, []);

  useEffect(() => {
    const focusAnchorTarget = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) {
        return;
      }

      const targetUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (
        !targetUrl.hash ||
        targetUrl.origin !== currentUrl.origin ||
        targetUrl.pathname !== currentUrl.pathname ||
        targetUrl.search !== currentUrl.search
      ) {
        return;
      }

      window.requestAnimationFrame(() => {
        if (new URL(window.location.href).hash !== targetUrl.hash) {
          return;
        }

        const target = getAnchorTarget(targetUrl.hash);
        if (!target) {
          return;
        }

        const addedTabIndex = !target.hasAttribute("tabindex");
        if (addedTabIndex) {
          target.setAttribute("tabindex", "-1");
          target.addEventListener(
            "blur",
            () => target.removeAttribute("tabindex"),
            { once: true }
          );
        }

        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus();
        }
      });
    };

    document.addEventListener("click", focusAnchorTarget);

    return () => {
      document.removeEventListener("click", focusAnchorTarget);
    };
  }, []);

  useEffect(() => {
    pausedRef.current = paused;

    const lenis = lenisRef.current;
    if (!lenis) {
      return;
    }

    if (paused) {
      stopRafRef.current();
      lenis.stop();
    } else {
      lenis.start();
      startRafRef.current();
    }
  }, [paused]);

  useEffect(() => {
    if (reducedMotion !== false) {
      return;
    }

    // Official Lenis API: https://github.com/darkroomengineering/lenis#readme
    const lenis = new Lenis({
      anchors: true,
      autoRaf: false,
      smoothWheel: true,
      syncTouch: false,
      prevent: node => node.closest("[data-lenis-prevent]") !== null,
    });
    let destroyed = false;

    const stopRaf = () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const update = (time: number) => {
      lenis.raf(time);
      if (!destroyed) {
        rafIdRef.current = window.requestAnimationFrame(update);
      }
    };

    const startRaf = () => {
      if (!destroyed && rafIdRef.current === null) {
        rafIdRef.current = window.requestAnimationFrame(update);
      }
    };

    lenisRef.current = lenis;
    startRafRef.current = startRaf;
    stopRafRef.current = stopRaf;

    if (pausedRef.current) {
      lenis.stop();
    } else {
      startRaf();
    }

    return () => {
      destroyed = true;
      stopRaf();
      lenis.destroy();

      if (lenisRef.current === lenis) {
        lenisRef.current = null;
        startRafRef.current = () => {};
        stopRafRef.current = () => {};
      }
    };
  }, [reducedMotion]);

  return null;
}

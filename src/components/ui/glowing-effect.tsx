"use client";

import { animate } from "motion/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface GlowingEffectProps {
  blur?: number;
  inactiveZone?: number;
  proximity?: number;
  spread?: number;
  variant?: "default" | "white";
  glow?: boolean;
  className?: string;
  disabled?: boolean;
  movementDuration?: number;
  borderWidth?: number;
}

const GlowingEffect = memo(function GlowingEffect({
  blur = 0,
  inactiveZone = 0.7,
  proximity = 48,
  spread = 24,
  variant = "default",
  glow = false,
  className,
  movementDuration = 1.4,
  borderWidth = 1,
  disabled = true,
}: GlowingEffectProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const lastPosition = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number>(0);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const isDisabled = disabled || reducedMotion;

  const handleMove = useCallback(
    (event?: PointerEvent | { x: number; y: number }) => {
      if (!containerRef.current) return;
      cancelAnimationFrame(animationFrameRef.current);

      animationFrameRef.current = requestAnimationFrame(() => {
        const element = containerRef.current;
        if (!element) return;

        const { left, top, width, height } = element.getBoundingClientRect();
        const pointerX = event?.x ?? lastPosition.current.x;
        const pointerY = event?.y ?? lastPosition.current.y;
        if (event) lastPosition.current = { x: pointerX, y: pointerY };

        const centerX = left + width * 0.5;
        const centerY = top + height * 0.5;
        const inactiveRadius = 0.5 * Math.min(width, height) * inactiveZone;
        if (Math.hypot(pointerX - centerX, pointerY - centerY) < inactiveRadius) {
          element.style.setProperty("--active", "0");
          return;
        }

        const isActive =
          pointerX > left - proximity &&
          pointerX < left + width + proximity &&
          pointerY > top - proximity &&
          pointerY < top + height + proximity;
        element.style.setProperty("--active", isActive ? "1" : "0");
        if (!isActive) return;

        const currentAngle = Number.parseFloat(element.style.getPropertyValue("--start")) || 0;
        const targetAngle = (180 * Math.atan2(pointerY - centerY, pointerX - centerX)) / Math.PI + 90;
        const angleDiff = ((targetAngle - currentAngle + 180) % 360) - 180;
        animationRef.current?.stop();
        animationRef.current = animate(currentAngle, currentAngle + angleDiff, {
          duration: movementDuration,
          ease: [0.16, 1, 0.3, 1],
          onUpdate: (value) => element.style.setProperty("--start", String(value)),
        });
      });
    },
    [inactiveZone, movementDuration, proximity],
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (isDisabled) return;
    const handleScroll = () => handleMove();
    const handlePointerMove = (event: PointerEvent) => handleMove(event);
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.body.addEventListener("pointermove", handlePointerMove, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      animationRef.current?.stop();
      window.removeEventListener("scroll", handleScroll);
      document.body.removeEventListener("pointermove", handlePointerMove);
    };
  }, [handleMove, isDisabled]);

  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "glowing-effect-fallback pointer-events-none absolute -inset-px hidden rounded-[inherit] border border-[color:var(--rule)] opacity-0 transition-opacity",
          glow && isDisabled && "!block opacity-100",
          variant === "white" && "border-white/40",
        )}
      />
      <span
        ref={containerRef}
        aria-hidden="true"
        style={{
          "--blur": `${blur}px`,
          "--spread": spread,
          "--start": "0",
          "--active": "0",
          "--glowingeffect-border-width": `${borderWidth}px`,
          "--gradient": variant === "white"
            ? "repeating-conic-gradient(from 236.84deg at 50% 50%, rgb(243 247 250 / 72%), rgb(243 247 250 / 18%) 18%, rgb(243 247 250 / 72%) 36%)"
            : "repeating-conic-gradient(from 236.84deg at 50% 50%, #72d0dc 0deg, #72d0dc 34deg, #ff9f7d 64deg, #2a3440 94deg, #72d0dc 124deg)",
        } as CSSProperties}
        className={cn(
          "glowing-effect-active pointer-events-none absolute inset-0 rounded-[inherit] opacity-100 transition-opacity",
          blur > 0 && "blur-[var(--blur)]",
          className,
          isDisabled && "!hidden",
        )}
      >
        <span
          className={cn(
            "absolute inset-0 rounded-[inherit]",
            "after:absolute after:inset-[calc(-1*var(--glowingeffect-border-width))] after:rounded-[inherit] after:content-['']",
            "after:[border:var(--glowingeffect-border-width)_solid_transparent]",
            "after:[background:var(--gradient)] after:[background-attachment:fixed]",
            "after:opacity-[var(--active)] after:transition-opacity after:duration-300",
            "after:[mask-clip:padding-box,border-box] after:[mask-composite:intersect]",
            "after:[mask-image:linear-gradient(#0000,#0000),conic-gradient(from_calc((var(--start)-var(--spread))*1deg),#0000_0deg,#fff,#0000_calc(var(--spread)*2deg))]",
          )}
        />
      </span>
    </>
  );
});

GlowingEffect.displayName = "GlowingEffect";

export { GlowingEffect };

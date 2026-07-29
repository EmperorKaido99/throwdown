import { useEffect, useRef } from "react";
import { Arena, NEUTRAL_VIEW, type ArenaView } from "../../render/arena";

// React's only job here is to own the canvas element's lifetime. The scene
// renders from a ref on its own animation frame, so the 3D view never waits on
// React scheduling and a re-render never rebuilds the scene.

interface Props {
  viewRef: React.RefObject<ArenaView>;
}

export function ArenaCanvas({ viewRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    let arena: Arena;
    try {
      arena = new Arena(canvas);
    } catch (err) {
      // A device without a usable WebGL context should not take the whole app
      // down — the fight is still running, it just cannot be drawn.
      console.error("arena failed to start:", err);
      return;
    }

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      if (clientWidth > 0 && clientHeight > 0) {
        arena.resize(clientWidth, clientHeight);
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // Clamped: a backgrounded tab returns with a huge delta, and the damping
      // would snap every smoothed value straight to its target.
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      arena.render(viewRef.current ?? NEUTRAL_VIEW, dt);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      arena.dispose();
    };
  }, [viewRef]);

  return (
    <div className="arena" ref={hostRef}>
      <canvas ref={canvasRef} className="arena-canvas" />
    </div>
  );
}

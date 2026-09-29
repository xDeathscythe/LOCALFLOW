import { memo, useEffect, useRef } from "react";

const idleLevels = Array.from({ length: 41 }, (_, index) => (4 + Math.abs(Math.sin(index * 1.9) * Math.sin(index * .35)) * 24) / 35);

export const Waveform = memo(function Waveform({ stream, recording, visible }: { stream: MediaStream | null; recording: boolean; visible: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current!;
    const paint = canvas.getContext("2d")!;
    const style = getComputedStyle(canvas);
    const color = style.getPropertyValue(recording ? "--niwa-color-primary" : "--niwa-color-text-tertiary").trim();
    const context = stream ? new AudioContext() : null;
    const source = context?.createMediaStreamSource(stream!);
    const analyser = context?.createAnalyser();
    if (analyser) { analyser.fftSize = 256; source!.connect(analyser); }
    const data = new Uint8Array(128);
    let width = 0;
    let frame = 0;
    let lastPaint = -Infinity;
    const draw = () => {
      analyser?.getByteTimeDomainData(data);
      paint.clearRect(0, 0, width, 96);
      paint.fillStyle = color;
      paint.globalAlpha = recording ? 1 : 0.76;
      const count = Math.min(41, Math.floor(width / 5));
      const offset = (width - count * 5 + 3) / 2;
      paint.beginPath();
      for (let index = 0; index < count; index++) {
        const level = analyser ? Math.min(1, 0.08 + Math.abs(data[Math.floor(index * 128 / count)] - 128) / 128 * 2.8) : idleLevels[index];
        const height = Math.max(8, Math.round(level * 96));
        paint.roundRect(offset + index * 5, (96 - height) / 2, 2, height, 1);
      }
      paint.fill();
    };
    const observer = new ResizeObserver(() => {
      width = canvas.clientWidth;
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(96 * scale);
      paint.setTransform(scale, 0, 0, scale, 0, 0);
      draw();
    });
    observer.observe(canvas);
    const tick = (now: number) => {
      if (now - lastPaint >= 1000 / 30) { draw(); lastPaint = now; }
      frame = requestAnimationFrame(tick);
    };
    if (stream) frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      source?.disconnect();
      void context?.close();
    };
  }, [stream, recording, visible]);

  return <div className="waveform"><canvas ref={canvasRef} role="img" aria-label="Audio waveform" /></div>;
});

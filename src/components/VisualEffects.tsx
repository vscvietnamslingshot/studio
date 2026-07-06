import React, { useEffect, useRef, useState } from "react";

interface Particle {
  x: number;
  y: number;
  size: number;
  color: string;
  speedX: number;
  speedY: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
}

export function ConfettiCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const requestRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);

  const colors = [
    "#FF1493", "#00BFFF", "#32CD32", "#FFD700", 
    "#FF4500", "#9400D3", "#00FFFF", "#FF69B4"
  ];

  useEffect(() => {
    if (active) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const width = canvas.width = window.innerWidth;
      const height = canvas.height = window.innerHeight;

      // Seed particles
      const newParticles: Particle[] = [];
      for (let i = 0; i < 150; i++) {
        newParticles.push({
          x: Math.random() * width,
          y: -20 - Math.random() * 100,
          size: Math.random() * 8 + 6,
          color: colors[Math.floor(Math.random() * colors.length)],
          speedX: Math.random() * 6 - 3,
          speedY: Math.random() * 5 + 4,
          rotation: Math.random() * 360,
          rotationSpeed: Math.random() * 4 - 2,
          opacity: 1,
        });
      }
      particlesRef.current = newParticles;
    }
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const currentParticles = particlesRef.current;

      for (let i = 0; i < currentParticles.length; i++) {
        const p = currentParticles[i];
        p.y += p.speedY;
        p.x += p.speedX;
        p.rotation += p.rotationSpeed;

        if (p.y > canvas.height) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
          p.opacity = 1;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    if (active) {
      requestRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-50 w-full h-full"
      style={{ mixBlendMode: "screen" }}
    />
  );
}

import type { CSSProperties, ReactNode } from 'react';
import type { BrainstormMode } from '../../lib/brainstorm';

interface ModuleArtProps { mode: BrainstormMode; live?: boolean; className?: string }

// Hairline drawings share one stroke system: lines draw themselves once, the lantern marks "you are here".
const line = (d: string, delay = 0, extra?: string) => <path key={d} className={`artLine ${extra || ''}`} pathLength={1} d={d} style={{ '--d': `${delay}ms` } as CSSProperties} />;
const dot = (x: number, y: number, delay: number, lantern = false, r = 2.6) => <circle key={`${x}:${y}`} className={lantern ? 'artLantern' : 'artDot'} cx={x} cy={y} r={r} style={{ '--d': `${delay}ms` } as CSSProperties} />;

const drawings: Record<BrainstormMode, ReactNode> = {
  present: <>
    {line('M80 4 V30', 0)}
    {line('M70 30 H90 L96 40 V66 L90 76 H70 L64 66 V40 Z', 200)}
    {line('M64 40 H96 M64 66 H96', 600)}
    {line('M74 84 H86 M77 90 H83', 900)}
    <circle className="artGlow" cx={80} cy={53} r={22} />
    {dot(80, 53, 700, true, 5)}
  </>,
  paths: <>
    {line('M14 50 C40 50 46 50 62 50', 0)}
    {line('M62 50 C84 50 88 18 112 18', 300)}
    {line('M62 50 C84 50 88 36 112 36', 380)}
    {line('M62 50 C84 50 90 50 112 50', 460)}
    {line('M62 50 C84 50 88 66 112 66', 540)}
    {line('M62 50 C84 50 88 84 112 84', 620)}
    {line('M112 50 C130 50 134 40 150 40', 900, 'artFuture')}
    {dot(14, 50, 0)}{dot(62, 50, 300, true, 3.4)}
    {[18, 36, 50, 66, 84].map((y, i) => dot(112, y, 700 + i * 80))}
  </>,
  story: <>
    {line('M6 70 C30 70 34 40 58 44 S86 70 108 52 S132 30 140 34', 0)}
    {line('M140 34 C146 31 150 24 156 20', 900, 'artFuture')}
    {line('M140 34 C147 36 151 44 156 48', 960, 'artFuture')}
    {[[18, 70], [58, 44], [96, 62]].map(([x, y], i) => dot(x, y, 300 + i * 200))}
    {dot(140, 34, 900, true, 3.4)}
  </>,
  challenges: <>
    {line('M4 88 L34 70 L50 76 L82 40 L98 50 L124 18 L156 52', 0)}
    {line('M124 18 V4 L136 8 L124 12', 900)}
    {line('M28 74 L28 64 L34 67 L28 70', 500)}
    {line('M78 44 L78 34 L84 37 L78 40', 650)}
    {dot(98, 50, 800, true, 3.2)}
    {line('M98 50 L110 36 L118 26', 1000, 'artFuture')}
  </>,
  board: <>
    {line('M28 24 L80 16 L132 30', 300)}
    {line('M28 24 L52 74 L112 78 L132 30', 500)}
    {line('M80 16 L52 74', 700, 'artThread')}
    {line('M80 16 L112 78', 800, 'artThread')}
    {[[28, 24], [80, 16], [132, 30], [52, 74], [112, 78]].map(([x, y], i) => dot(x, y, i * 90, false, 3.2))}
    {dot(80, 48, 1000, true, 3.6)}
  </>,
  thoughts: <>
    <g className="artFloat" style={{ '--f': '0s' } as CSSProperties}>{line('M30 56 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0', 0)}</g>
    <g className="artFloat" style={{ '--f': '-2s' } as CSSProperties}>{line('M70 38 a20 20 0 1 0 40 0 a20 20 0 1 0 -40 0', 200)}</g>
    <g className="artFloat" style={{ '--f': '-4s' } as CSSProperties}>{line('M116 66 a13 13 0 1 0 26 0 a13 13 0 1 0 -26 0', 400)}</g>
    {line('M8 90 H152', 600)}
    {dot(90, 38, 900, true, 3.4)}
  </>,
};

export function ModuleArt({ mode, live = false, className = '' }: ModuleArtProps) {
  return <svg className={`moduleArt ${live ? 'isLive' : ''} ${className}`} viewBox="0 0 160 100" aria-hidden="true">{drawings[mode]}</svg>;
}

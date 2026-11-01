import { clamp, rad, type Vec2 } from "../core/iso";
import { tdone, tset, tval, tween, type Tween } from "../core/motion";
import { BACK, FWD, G, H, LIFT, N, REST, W, card, pose, scene, tray } from "./riffle-geometry";
import { disposer, mk, place, pointer, reflect, register, type FigureEls, type FigureHandle } from "../core/stage";

/**
 * Riffle (Fig 9.1) — a rounded tray holding eight cards. The card under the pointer stands up and lifts; the ones in front
 * lean forward and the ones behind lean back, staggered outwards from it on
 * the 700ms lift curve. A discrete figure, so every card runs on tweens.
 *
 * Selection never reads the posed cards: it comes from static oblique bands
 * along the resting top edges, so a card moving out from under the pointer
 * can't flip the choice back and forth. The bands are geometry only; nothing
 * draws them. The stage is a focusable group; the arrow keys walk the cards
 * and the read-out names the one pulled by its number.
 *
 * The drawing itself — camera, tray, a card in any pose — is pure and lives in
 * riffle-geometry.ts; this file is the DOM, the tweens and the input.
 */

type Card = {
  n: number; t0: number; shape: Vec2[];
  back: SVGPathElement; face: SVGPathElement; head: SVGPathElement; rules: SVGPathElement;
  punch: SVGCircleElement[];
  /** Lean in degrees, and lift. */
  a: Tween; z: Tween;
};

type Entry = { id: string; label: string };
type Options = { items: Entry[]; open: (id: string, newTab?: boolean) => void; menu: (id: string, x: number, y: number) => void; selected: (index: number) => void };

export const mount = ({ stage, svg, read }: FigureEls, value: number, options: Options): FigureHandle => {
  const bag = disposer();
  let stag = value;
  const count = options.items.length, offset = N - count;

  const { P, front, outer, inner } = scene();
  const paths = tray(P, front, outer, inner);

  const g = mk("g", {}, svg);
  reflect(svg, g, P, front, outer, 0, 14);
  for (const [d, cls] of paths.far) mk("path", { d, class: cls }, g);

  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    const { n, t0, shape } = card(i + offset);
    const item = options.items[n - 1];
    const grp = mk("g", { class: 'riffleCard', 'data-item-id': item.id, 'aria-label': item.label }, g);
    const back = mk("path", { class: "lo" }, grp), face = mk("path", { class: "sil" }, grp);
    const head = mk("path", { class: "nf" }, grp), rules = mk("path", { class: "nf lo" }, grp);
    // the card's number, punched in a 4 × 2 grid on its tab
    const punch: SVGCircleElement[] = [];
    for (let k = 0; k < 8; k++) punch.push(mk("circle", { r: 1.05, class: "dot " + (k === n - 1 ? "m" : "off") }, grp));
    cards.push({ n, t0, shape, back, face, head, rules, punch, a: tween(REST), z: tween(0) });
  }

  for (const [d, cls] of paths.near) mk("path", { d, class: cls }, g);

  // hit bands: oblique strips along the RESTING top edges. They never move.
  const top = (i: number) => P(W / 2, i * G + H * Math.sin(rad(REST)), H * Math.cos(rad(REST)));
  const c0 = top(0), c1 = top(1), d = [c1[0] - c0[0], c1[1] - c0[1]];
  const px0 = P(0, 0, 0), px1 = P(1, 0, 0), ex = [px1[0] - px0[0], px1[1] - px0[1]];
  const HALF = W / 2 + 6, det = d[0] * ex[1] - d[1] * ex[0];

  /** The card whose band holds the point, in the band's own (s, r) coordinates; -1 outside. */
  function hit([x, y]: Vec2) {
    const qx = x - c0[0], qy = y - c0[1];
    const s = (qx * ex[1] - qy * ex[0]) / det, r = (d[0] * qy - d[1] * qx) / det;
    if (Math.abs(r) > HALF || s < -0.5 || s > N + 1) return -1;
    const slot = clamp(Math.round(s), 0, N - 1);
    return slot < offset ? -1 : slot - offset;
  }

  function draw(i: number, th: number, lift: number) {
    const cd = cards[i], q = pose(P, i + offset, cd.t0, cd.shape, th, lift);
    cd.back.setAttribute("d", q.back);
    cd.face.setAttribute("d", q.face);
    cd.head.setAttribute("d", q.head);
    cd.rules.setAttribute("d", q.rules);
    cd.punch.forEach((el, k) => place(el, q.punch[k]));
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    cards.forEach((cd, i) => { draw(i, tval(cd.a, now), tval(cd.z, now)); if (!tdone(cd.a, now) || !tdone(cd.z, now)) moving = true; });
    return moving;
  });
  bag.add(B.unregister);

  let act = -1;
  const caption = (a: number) => (a < 0 ? "" : options.items[count - 1 - a].label);
  /** Pulls card a (-1 puts them all back). The stagger spreads out from the card pulled, or the one let go. */
  function setActive(a: number) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    cards.forEach((cd, i) => {
      const delay = Math.abs(i - from) * stag;
      const th = a < 0 ? REST : i < a ? BACK : i > a ? FWD : 0;
      tset(cd.a, th, now, delay); tset(cd.z, a === i ? LIFT : 0, now, delay);
      cd.face.classList.toggle("hi", i === a); cd.head.classList.toggle("hi", i === a); cd.punch[cd.n - 1].classList.toggle("m", i !== a);
    });
    read.textContent = caption(a);
    options.selected(a < 0 ? -1 : count - 1 - a);
    B.wake();
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.on(stage, "keydown", (e) => {
    if (!count || stage.getAttribute('aria-disabled') === 'true') return;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { setActive(act < 0 ? count - 1 : Math.min(count - 1, act + 1)); e.preventDefault(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") { setActive(act < 0 ? count - 1 : Math.max(0, act - 1)); e.preventDefault(); }
    else if (e.key === 'Home') { setActive(count - 1); e.preventDefault(); }
    else if (e.key === 'End') { setActive(0); e.preventDefault(); }
    else if ((e.key === 'Enter' || e.key === ' ') && act >= 0) { e.preventDefault(); options.open(options.items[count - 1 - act].id, e.ctrlKey || e.metaKey); }
    // Escape puts a pulled card back and claims the key; at rest it passes on to the page.
    else if (e.key === "Escape" && act >= 0) { setActive(-1); e.preventDefault(); }
  });
  const itemAt = (e: MouseEvent) => {
    if (stage.getAttribute('aria-disabled') === 'true') return;
    const r = stage.getBoundingClientRect();
    const a = hit([(e.clientX - r.left) / r.width * 400, (e.clientY - r.top) / r.height * 320]);
    return a < 0 ? undefined : options.items[count - 1 - a];
  };
  bag.on(stage, 'click', e => { const item = itemAt(e); if (item) options.open(item.id, e.ctrlKey || e.metaKey); });
  bag.on(stage, 'auxclick', e => { const item = itemAt(e); if (item && e.button === 1) { e.preventDefault(); options.open(item.id, true); } });
  bag.on(stage, 'contextmenu', e => { const item = itemAt(e); if (item) { e.preventDefault(); options.menu(item.id, e.clientX, e.clientY); } });
  bag.on(stage, "blur", () => setActive(-1));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { stag = v; },
    destroy: bag.dispose,
  };
};

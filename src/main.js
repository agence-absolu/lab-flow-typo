import '@fontsource/anton/latin-400.css';
import './style.css';

import { gsap } from 'gsap';
import * as THREE from 'three';

import { fragmentShader, vertexShader } from './shaders.js';

// --- Réglages -------------------------------------------------------------

const LINES = ['BIENVENUE DANS LA', 'YELLOW', 'FAMILY'];
const GAP_AFTER = [0.55, 0.3, 0.3]; // espace entre deux répétitions (en capitales)
const MARGIN = 0.06;                // marge au-dessus/en dessous des capitales
const SPEEDS = [0.42, 0.55, 0.48];  // vitesses relatives des trois lignes
const HERO_DIRS = [1, -1, 1];       // sens des trois lignes du titre (comme le shader)
const HERO_START = [0.3, 0.57, 0.84]; // position de départ des lignes du titre
const BLOCK_HEIGHT = 0.46;          // hauteur du titre, en fraction du viewport
const RUN = 2;                      // durée de la course, du départ à l'arrêt (s)
const TRAVEL = 5;                   // distance parcourue (× SPEEDS, en répétitions)
const RUN_EASE = 'power3.out';      // départ très vif, freinage concentré en début de course
const WHITE_AT = 0.35;              // passage du titre au blanc, en fraction de la course
const TITLE_Y = 0.06;               // remontée du titre (fraction du viewport) pour le sticker

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Rendu ----------------------------------------------------------------

const canvas = document.querySelector('.FlowTypo-canvas');
const replay = document.querySelector('.FlowTypo-replay');
const sticker = document.querySelector('.FlowTypo-sticker');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const uniforms = {
  uRes: { value: new THREE.Vector2() },
  uTime: { value: 0 },
  uIntro: { value: 0 },
  uWave: { value: 1 }, // amplitude de la vague (constante : elle reste jusqu'au bout)
  uFocus: { value: 0 },
  uWhite: { value: 0 },
  uScroll: { value: 0 },
  uInteract: { value: 0 },
  uHover: { value: 0 },
  uH: { value: new THREE.Vector3() },
  uStripW: { value: new THREE.Vector3() },
  uInkStart: { value: new THREE.Vector3() },
  uSpeed: { value: new THREE.Vector3(...SPEEDS) },
  uHeroOff: { value: new THREE.Vector3(...HERO_START) },
  uHeroRep: { value: new THREE.Vector3() },
  uGap: { value: 0 },
  uX0: { value: 0 },
  uTitleY: { value: 0 },
  uMargin: { value: MARGIN },
  uMouse: { value: new THREE.Vector2(0, 0) },
  uVel: { value: new THREE.Vector2() },
  tStrip0: { value: null },
  tStrip1: { value: null },
  tStrip2: { value: null },
};

const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
const scene = new THREE.Scene();
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
const camera = new THREE.Camera();

// --- Bandes de texte ------------------------------------------------------

// Chaque ligne devient une texture qui se répète horizontalement : l'encre
// (pas l'avance) est centrée dans un blanc réparti des deux côtés, pour que la
// jonction entre deux répétitions tombe dans le vide. La hauteur utile est
// celle des capitales.
function makeStrip(text, gapAfter) {
  const size = 400;
  const font = `${size}px Anton`;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const m = ctx.measureText(text);
  const cap = ctx.measureText('H').actualBoundingBoxAscent;
  const ink = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;

  const pad = (cap * gapAfter) / 2;
  c.width = Math.ceil(ink + 2 * pad);
  c.height = Math.ceil(cap * (1 + 2 * MARGIN));
  ctx.font = font; // le redimensionnement du canvas réinitialise le contexte
  ctx.fillStyle = '#fff';
  ctx.fillText(text, pad + m.actualBoundingBoxLeft, cap * (1 + MARGIN));

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // ratio largeur d'encre / capitale, et largeur d'une répétition / capitale
  // + position du début de l'encre dans la répétition (0–1)
  return { tex, aspect: ink / cap, repeat: c.width / cap, inkStart: pad / c.width };
}

let strips = [];

// Le titre est un bloc justifié : les trois lignes ont la même largeur d'encre W,
// leurs hauteurs s'en déduisent. Le flot réutilise exactement ces dimensions :
// le titre garde la taille qu'il avait dans le flot, les clones disparaissent
// autour de lui.
function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.getDrawingBufferSize(uniforms.uRes.value);

  const invAspects = strips.reduce((sum, s) => sum + 1 / s.aspect, 0);
  const gapRatio = 0.035;
  const W = Math.min(0.62 * (w / h), BLOCK_HEIGHT / (invAspects + 2 * gapRatio), 0.7);

  const hs = strips.map((s) => W / s.aspect);
  uniforms.uH.value.set(...hs);
  uniforms.uStripW.value.set(...strips.map((s, i) => s.repeat * hs[i]));
  uniforms.uInkStart.value.set(...strips.map((s) => s.inkStart));
  uniforms.uGap.value = W * gapRatio;
  uniforms.uX0.value = -W / 2;
  uniforms.uTitleY.value = TITLE_Y;

  // Sticker : centré sous le titre, un peu moins de la moitié de sa largeur.
  const blockH = hs.reduce((a, b) => a + b, 0) + 2 * uniforms.uGap.value;
  const titleBottom = h / 2 - (TITLE_Y - blockH / 2) * h; // en px depuis le haut
  sticker.style.setProperty('--sticker-top', `${titleBottom + 0.035 * h + 20}px`);
  sticker.style.setProperty('--sticker-width', `${W * h * 0.42}px`);
}

// --- Chorégraphie ---------------------------------------------------------

// Tout est porté par une seule timeline, sans état calculé image par image :
// on peut donc la rejouer ou la mettre en pause.
const hero = { a: HERO_START[0], b: HERO_START[1], c: HERO_START[2] };
const heroKeys = ['a', 'b', 'c'];

function buildTimeline() {
  const tl = gsap.timeline({ paused: true });

  tl.fromTo(uniforms.uIntro, { value: 0 }, { value: 1, duration: 0.3, ease: 'power1.out' }, 0);

  // La course : toutes les lignes partent vite et freinent ensemble, avec le
  // même ease, jusqu'à l'arrêt complet au même instant (RUN). La vague, elle,
  // ne bouge jamais.
  // Lignes hors titre : une seule horloge de défilement pour toutes.
  tl.fromTo(uniforms.uScroll, { value: 0 }, { value: TRAVEL, duration: RUN, ease: RUN_EASE }, 0);

  // Lignes du titre : même mouvement, mais la distance est arrondie pour que
  // chacune s'arrête pile au début de son mot (offset entier).
  heroKeys.forEach((key, i) => {
    const dir = HERO_DIRS[i];
    const free = HERO_START[i] + dir * SPEEDS[i] * TRAVEL;
    const target = Math.round(free);
    tl.fromTo(hero, { [key]: HERO_START[i] }, { [key]: target, duration: RUN, ease: RUN_EASE }, 0);
    uniforms.uHeroRep.value.setComponent(i, target); // la répétition arrêtée au centre
  });

  // Comme sur la vidéo de référence : les mots du titre passent au blanc
  // pendant le freinage, juste avant de s'immobiliser…
  tl.fromTo(uniforms.uWhite, { value: 0 }, { value: 1, duration: 0.3, ease: 'power1.out' }, RUN * WHITE_AT);

  // … et à l'arrêt : retour au jaune (état final), les clones s'effacent
  // vite, le sticker arrive.
  tl.addLabel('title', RUN);
  tl.fromTo(uniforms.uFocus, { value: 0 }, { value: 1, duration: 0.25, ease: 'power1.out' }, 'title');
  tl.fromTo(
    uniforms.uWhite,
    { value: 1 },
    { value: 0, duration: 0.3, ease: 'power2.out', immediateRender: false }, // sinon il écraserait le 0 de départ
    'title',
  );
  tl.fromTo(
    sticker,
    // L'image est déjà inclinée : le sticker se pose à 0°.
    { autoAlpha: 0, xPercent: -50, scale: 0.6, rotation: -10 },
    { autoAlpha: 1, xPercent: -50, scale: 1, rotation: 0, duration: 0.45, ease: 'back.out(2.2)' },
    'title+=0.05',
  );
  tl.fromTo(uniforms.uInteract, { value: 0 }, { value: 1, duration: 0.5, ease: 'power2.out' }, 'title+=0.2');
  tl.call(showReplay, null, 'title+=0.4');

  return tl;
}

function showReplay() {
  replay.hidden = false;
  requestAnimationFrame(() => replay.classList.add('is-visible'));
}

function hideReplay() {
  replay.classList.remove('is-visible');
  replay.hidden = true;
}

// --- Pointeur -------------------------------------------------------------

const pointer = { target: new THREE.Vector2(), smooth: new THREE.Vector2(), prev: new THREE.Vector2() };

function toWorld(e) {
  const h = window.innerHeight;
  pointer.target.set((e.clientX - window.innerWidth / 2) / h, (h / 2 - e.clientY) / h);
}

canvas.addEventListener('pointermove', (e) => {
  toWorld(e);
  gsap.to(uniforms.uHover, { value: 1, duration: 0.4, overwrite: true });
});
canvas.addEventListener('pointerdown', (e) => {
  toWorld(e);
  pointer.smooth.copy(pointer.target);
  gsap.to(uniforms.uHover, { value: 1, duration: 0.4, overwrite: true });
});
canvas.addEventListener('pointerleave', () => {
  gsap.to(uniforms.uHover, { value: 0, duration: 0.8, overwrite: true });
});

// --- Boucle ---------------------------------------------------------------

gsap.ticker.add((_, deltaMs) => {
  if (!strips.length) return; // police pas encore chargée
  const dt = Math.min(deltaMs / 1000, 0.05);
  uniforms.uTime.value += dt; // fond et ondulation sous le curseur
  uniforms.uHeroOff.value.set(hero.a, hero.b, hero.c);

  // Pointeur lissé + vitesse lissée (indépendants de la cadence d'affichage).
  pointer.prev.copy(pointer.smooth);
  pointer.smooth.lerp(pointer.target, 1 - Math.exp(-dt * 9));
  const vel = pointer.smooth.clone().sub(pointer.prev).multiplyScalar(dt > 0 ? 0.02 / dt : 0);
  vel.clampLength(0, 0.08);
  uniforms.uVel.value.lerp(vel, 1 - Math.exp(-dt * 6));
  uniforms.uMouse.value.copy(pointer.smooth);

  renderer.render(scene, camera);
});

window.addEventListener('resize', layout);

// --- Démarrage ------------------------------------------------------------

await document.fonts.load('400px Anton');
strips = LINES.map((text, i) => makeStrip(text, GAP_AFTER[i]));
strips.forEach((s, i) => (uniforms[`tStrip${i}`].value = s.tex));
layout();

const tl = buildTimeline();
replay.addEventListener('click', () => {
  hideReplay();
  tl.restart();
});

if (reduceMotion) {
  tl.progress(1); // directement le titre posé, déformation au curseur active
} else {
  tl.play();
}

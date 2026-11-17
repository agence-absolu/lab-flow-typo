// Shaders de la démo : un seul plan plein écran, tout se joue dans le fragment.
//
// Espace « monde » : origine au centre de l'écran, y vers le haut, 1 unité =
// hauteur du viewport. Les bandes de texte sont pavées verticalement par
// périodes de trois lignes (BIENVENUE DANS LA / YELLOW / FAMILY) ; la période 0
// est centrée à l'écran : c'est elle qui devient le titre à l'arrêt.

export const vertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec2 uRes;          // taille du canvas en pixels physiques
  uniform float uTime;
  uniform float uIntro;       // 0 → 1 : apparition
  uniform float uWave;        // amplitude de la vague
  uniform float uFocus;       // 0 → 1 : les lignes hors titre s'effacent
  uniform float uWhite;       // 0 → 1 : le titre passe du jaune au blanc
  uniform float uScroll;      // horloge de défilement des lignes hors titre
  uniform float uInteract;    // 0 → 1 : déformation au curseur active
  uniform float uHover;       // pointeur présent sur le canvas

  uniform vec3 uH;            // hauteur de capitale de chaque bande (monde)
  uniform vec3 uStripW;       // largeur d'une répétition de chaque bande (monde)
  uniform vec3 uInkStart;     // début de l'encre dans une répétition (0–1)
  uniform vec3 uSpeed;        // vitesses de défilement (répétitions / s)
  uniform vec3 uHeroOff;      // décalage des trois lignes du titre (répétitions)
  uniform vec3 uHeroRep;      // répétition qui forme le titre final, pour chaque ligne
  uniform float uGap;         // interligne (monde)
  uniform float uX0;          // bord gauche du titre (monde)
  uniform float uTitleY;      // hauteur du centre du titre (monde)
  uniform float uMargin;      // marge haute/basse des textures (en capitales)

  uniform vec2 uMouse;        // pointeur lissé (monde)
  uniform vec2 uVel;          // vitesse lissée du pointeur

  uniform sampler2D tStrip0;
  uniform sampler2D tStrip1;
  uniform sampler2D tStrip2;

  const vec3 YELLOW = vec3(1.0, 0.929, 0.0);

  float hash(float n) {
    return fract(sin(n * 127.1 + 311.7) * 43758.5453);
  }

  // Bruit sans motif visible (Dave Hoskins, « hash without sine »).
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float blob(vec2 q, vec2 c, float r) {
    vec2 d = q - c;
    return exp(-dot(d, d) / (r * r));
  }

  // Fond : une photo très floutée, imitée par des taches de couleur qui dérivent.
  vec3 background(vec2 q) {
    float t = uTime * 0.12;
    vec3 col = vec3(0.86, 0.80, 0.70);
    col = mix(col, vec3(0.80, 0.84, 0.85), blob(q, vec2(-0.55 + 0.1 * sin(t), 0.45), 0.55));
    col = mix(col, vec3(0.07, 0.17, 0.19), 0.85 * blob(q, vec2(-0.35 + 0.15 * cos(t * 1.3), 0.05), 0.22));
    col = mix(col, vec3(0.86, 0.56, 0.12), 0.8 * blob(q, vec2(0.05 + 0.12 * sin(t * 0.9), 0.22), 0.25));
    col = mix(col, vec3(0.35, 0.21, 0.08), 0.6 * blob(q, vec2(0.25, 0.32 + 0.08 * sin(t * 1.7)), 0.14));
    col = mix(col, vec3(0.10, 0.20, 0.22), 0.8 * blob(q, vec2(0.6 + 0.1 * sin(t * 1.1), -0.05), 0.24));
    col = mix(col, vec3(0.62, 0.42, 0.22), 0.7 * blob(q, vec2(-0.6, -0.4 + 0.1 * cos(t)), 0.3));
    col = mix(col, vec3(0.88, 0.76, 0.58), 0.7 * blob(q, vec2(0.3 + 0.1 * cos(t * 0.7), -0.4), 0.35));
    // Au moment du titre, le fond s'assombrit pour le faire ressortir.
    col *= mix(1.0, 0.62, uFocus);
    return col;
  }


  // Couverture (alpha) d'une bande à la position p, pour la période g.
  // dpx / dpy : dérivées écran de p, continues. Les coordonnées de texture,
  // elles, sautent d'une ligne à l'autre (décalage, période) : laissées au
  // GPU, ces sauts lui font choisir le plus petit mipmap, dont le voile
  // dessinait des traits horizontaux. On lui fournit donc les vraies pentes.
  float band(sampler2D tex, vec2 p, vec2 dpx, vec2 dpy, float yl, float g, float i,
             float top, float h, float stripW, float inkStart,
             float speed, float heroOff, float heroRep) {
    float vc = (yl - top) / h; // 0 = haut des capitales, 1 = ligne de base
    float inside = step(-uMargin, vc) * step(vc, 1.0 + uMargin);

    float n = g * 3.0 + i; // index global de la ligne
    float dir = mod(n, 2.0) < 0.5 ? 1.0 : -1.0;
    float off = g == 0.0
      ? heroOff
      : dir * uScroll * speed * (0.75 + 0.5 * hash(n)) + hash(n + 17.0);

    vec2 uv = vec2(
      (p.x - uX0) / stripW + off + inkStart,
      1.0 - (vc + uMargin) / (1.0 + 2.0 * uMargin)
    );
    vec2 k = vec2(1.0 / stripW, 1.0 / (h * (1.0 + 2.0 * uMargin)));
    float a = textureGrad(tex, uv, dpx * k, dpy * k).a * inside;
    // Seule la répétition centrale des lignes du titre survit au fondu.
    bool isTitle = g == 0.0 && floor(uv.x) == heroRep;
    return isTitle ? a : a * (1.0 - uFocus);
  }

  void main() {
    vec2 q = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    vec3 bg = background(q);

    // --- Déformation au curseur (phase interactive) ---
    vec2 d = q - uMouse;
    float f = exp(-dot(d, d) / 0.012) * uInteract * uHover;
    float spd = length(uVel);
    vec2 p = q;
    p -= d * f * 0.42;                                  // loupe
    p -= uVel * f * 2.2;                                // traînée dans le sens du geste
    float ang = f * (0.35 + 6.0 * spd) * sign(uVel.x + 1e-4);
    p = uMouse + mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (p - uMouse); // torsion
    p.y += f * (0.012 + 0.25 * spd) * sin(p.x * 40.0 - uTime * 7.0);  // le flot renaît sous le curseur

    // --- Ondulation globale : une forme figée, que le texte traverse ---
    // (elle ne bouge pas elle-même et reste jusqu’au titre final).
    // Calculée dans un repère réduit pour garder des courbes amples.
    float w = uWave;
    p.y -= uTitleY; // tout le pavage (et la vague) se centre sur le titre
    vec2 z = p * 1.75;
    // Calée sur les captures : les lettres gardent toutes la même taille, ce
    // sont les lignes qui se décalent verticalement. Au centre, le titre monte
    // vers la droite (fûts verticaux, haut et bas des lignes inclinés) ; plus
    // loin, cette pente devient une grande ondulation. Tout est nul au centre
    // de l'écran, qui reste donc le centre du titre.
    z.y -= w * 0.095 * sin(z.x * 2.1 + z.y * 0.6);              // pente du titre, vague ample
    z.y -= w * 0.015 * (sin(z.x * 4.3 + 1.7) - sin(1.7));       // petite ondulation
    z.x += w * 0.012 * sin(z.y * 3.1);                          // léger décalage des lignes
    p = z / 1.75;

    // --- Pavage des lignes ---
    float H = uH.x + uH.y + uH.z + 3.0 * uGap;
    // Période 0 centrée ; chaque période commence au milieu d'un interligne,
    // pour que le saut d'une période à l'autre (et le changement de mipmap
    // qu'il provoque) tombe dans le vide et pas sur le haut des lettres.
    float yDown = 0.5 * H - p.y;
    float g = floor(yDown / H);
    float yl = yDown - g * H;

    vec2 dpx = dFdx(p);
    vec2 dpy = dFdy(p);

    float a = 0.0;
    a = max(a, band(tStrip0, p, dpx, dpy, yl, g, 0.0, 0.5 * uGap,                  uH.x, uStripW.x, uInkStart.x, uSpeed.x, uHeroOff.x, uHeroRep.x));
    a = max(a, band(tStrip1, p, dpx, dpy, yl, g, 1.0, uH.x + 1.5 * uGap,           uH.y, uStripW.y, uInkStart.y, uSpeed.y, uHeroOff.y, uHeroRep.y));
    a = max(a, band(tStrip2, p, dpx, dpy, yl, g, 2.0, uH.x + uH.y + 2.5 * uGap,    uH.z, uStripW.z, uInkStart.z, uSpeed.z, uHeroOff.z, uHeroRep.z));

    vec3 ink = mix(YELLOW, vec3(1.0), uWhite);
    ink = mix(ink, vec3(1.0, 0.97, 0.75), f * 0.35 * (1.0 - uWhite));
    vec3 col = mix(bg, ink, a * uIntro);

    // Vignettage + grain léger pour casser les aplats.
    col *= 1.0 - 0.25 * dot(q * vec2(0.6, 1.0), q * vec2(0.6, 1.0));
    col += (hash12(gl_FragCoord.xy) - 0.5) * 0.03; // grain fixe : rien ne fourmille

    gl_FragColor = vec4(col, 1.0);
  }
`;

// Scene art: each scene is an SVG drawn in a 1600x900 coordinate space.
// Functions take the game state so the picture follows the story (dawn, Anton, the man...).
window.Art = (() => {
  const VOID = '#8b8b8b'; // the colour of nothing; shared with CSS --void

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  const grad = (id, stops, vertical = true) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">` +
    stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('') +
    `</linearGradient>`;

  const radial = (id, color, a = 1) =>
    `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${a}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;

  // Rows of Soviet-style apartment blocks with a few lit windows.
  function blocks(seed, x0, x1, baseY, minH, maxH, lit, color, litColor = '#f2c46b') {
    const r = rng(seed);
    let x = x0, out = '';
    while (x < x1) {
      const w = 90 + r() * 140, h = minH + r() * (maxH - minH);
      out += `<rect x="${x}" y="${baseY - h}" width="${w}" height="${h}" fill="${color}"/>`;
      for (let wy = baseY - h + 14; wy < baseY - 12; wy += 22) {
        for (let wx = x + 10; wx < x + w - 12; wx += 18) {
          if (r() < lit) out += `<rect x="${wx}" y="${wy}" width="8" height="11" fill="${litColor}" opacity="${(0.45 + r() * 0.5).toFixed(2)}"/>`;
        }
      }
      x += w + 6 + r() * 18;
    }
    return out;
  }

  // ---------- figures (origin at the feet) ----------
  function hair(cx, cy, r, color) {
    const pts = [[-24, -10], [-18, -24], [-4, -30], [12, -27], [24, -16], [28, 0], [-28, 4], [-26, 18], [27, 16], [-14, -18], [8, -16]];
    return pts.map(([x, y]) => `<circle cx="${cx + x}" cy="${cy + y}" r="${r}" fill="${color}"/>`).join('');
  }

  function cat(x, y, s = 1, cls = '') {
    return `<g class="fig ${cls}" transform="translate(${x} ${y}) scale(${s})">
      <ellipse cx="0" cy="0" rx="42" ry="8" fill="#000" opacity=".2" class="shadow"/>
      <rect x="-17" y="-122" width="14" height="120" rx="6" fill="#2b2f3a"/>
      <rect x="3" y="-122" width="14" height="120" rx="6" fill="#2b2f3a"/>
      <path d="M-31 -232 Q0 -246 31 -232 L27 -112 L-27 -112 Z" fill="#4f6b5c"/>
      <path d="M-31 -228 L-44 -140 L-34 -136 L-22 -200 Z" fill="#4f6b5c"/>
      <path d="M31 -228 L44 -140 L34 -136 L22 -200 Z" fill="#4f6b5c"/>
      <rect x="-9" y="-254" width="18" height="20" fill="#e2b99a"/>
      <circle cx="0" cy="-276" r="26" fill="#e2b99a"/>
      ${hair(0, -280, 13, '#a97c50')}
    </g>`;
  }

  function jimbob(x, y, s = 1, cls = '') {
    return `<g class="fig ${cls}" transform="translate(${x} ${y}) scale(${s})">
      <ellipse cx="0" cy="0" rx="40" ry="8" fill="#000" opacity=".2" class="shadow"/>
      <rect x="-17" y="-104" width="15" height="102" rx="6" fill="#3b3a36"/>
      <rect x="2" y="-104" width="15" height="102" rx="6" fill="#3b3a36"/>
      <path d="M-33 -204 Q0 -216 33 -204 L29 -96 L-29 -96 Z" fill="#8f949c"/>
      <rect x="-9" y="-222" width="18" height="18" fill="#9b6b4b"/>
      <circle cx="0" cy="-244" r="25" fill="#9b6b4b"/>
      <path d="M-26 -250 Q-24 -276 0 -276 Q24 -276 26 -250 Q14 -262 0 -262 Q-14 -262 -26 -250 Z" fill="#14110f"/>
      <circle cx="-9" cy="-246" r="7" fill="none" stroke="#111" stroke-width="2.5"/>
      <circle cx="9" cy="-246" r="7" fill="none" stroke="#111" stroke-width="2.5"/>
      <line x1="-2" y1="-246" x2="2" y2="-246" stroke="#111" stroke-width="2.5"/>
    </g>`;
  }

  // Someone seen from behind, sitting in a row of chairs.
  function seated(x, y, color, curls) {
    return `<g transform="translate(${x} ${y})">
      <path d="M-34 0 Q-36 -70 0 -76 Q36 -70 34 0 Z" fill="${color}"/>
      <circle cx="0" cy="-96" r="22" fill="${curls ? '#e2b99a' : color}"/>
      ${curls ? hair(0, -98, 11, '#a97c50') : ''}
    </g>`;
  }

  // ---------- views through windows ----------
  function cityView(x, y, w, h, dawn) {
    const skies = [
      [['0', '#070a1c'], ['1', '#1a2445']],
      [['0', '#1b2347'], ['.65', '#7a5a7c'], ['1', '#e59a74']],
      [['0', '#6f93b8'], ['.7', '#b9cbd8'], ['1', '#efd9b4']],
    ];
    const lit = [0.18, 0.08, 0.02][dawn];
    const bld = ['#0b0e1c', '#29243a', '#5b6474'][dawn];
    const bld2 = ['#121629', '#3a3149', '#737c8a'][dawn];
    const clip = `cv${x}-${y}`;
    return `<defs>${grad('sky' + dawn, skies[dawn])}<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs>
      <g clip-path="url(#${clip})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#sky${dawn})"/>
      ${blocks(7, x - 40, x + w, y + h * 0.78, h * 0.25, h * 0.55, lit, bld2)}
      ${blocks(3, x - 80, x + w, y + h * 0.92, h * 0.3, h * 0.7, lit, bld)}</g>`;
  }

  function beachView(x, y, w, h) {
    return `<defs>${grad('bsky', [['0', '#232a5c'], ['.6', '#b26e78'], ['1', '#f2a676']])}</defs>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#bsky)"/>
      <circle cx="${x + w * 0.6}" cy="${y + h * 0.62}" r="40" fill="#ffd29a" opacity=".85"/>
      <polygon points="${x},${y + h * 0.6} ${x + w * 0.2},${y + h * 0.48} ${x + w * 0.38},${y + h * 0.6}" fill="#4a3f63"/>
      <rect x="${x}" y="${y + h * 0.62}" width="${w}" height="${h * 0.2}" fill="#3a5f80"/>
      <rect x="${x}" y="${y + h * 0.66}" width="${w}" height="3" fill="#f6c08c" opacity=".6"/>
      <rect x="${x}" y="${y + h * 0.82}" width="${w}" height="${h * 0.18}" fill="#d8bc93"/>`;
  }

  // ---------- scenes ----------
  function bedroom(s) {
    const beach = s.chapter === 2;
    const peek = s.l.peeked, open = s.l.windowOpen, up = s.l.alarmOff;
    const wx = 1000, wy = 140, ww = 460, wh = 420;
    const view = beach ? beachView(wx, wy, ww, wh) : cityView(wx, wy, ww, wh, peek && s.chapter === 3 ? 1 : 0);
    let slats = '';
    for (let y = wy + 6; y < wy + wh; y += 26) {
      slats += `<rect x="${wx}" y="${y}" width="${ww}" height="${peek ? 10 : 21}" fill="#24273a"/>`;
    }
    const tint = beach ? '#f2a676' : '#5d6fa8';
    const light = peek
      ? `<polygon points="${wx},${wy + wh} ${wx + ww},${wy + wh} 760,900 120,900" fill="${tint}" opacity="${beach ? 0.16 : 0.07}"/>`
      : '';
    const breeze = open
      ? `<g stroke="#cfd6ef" stroke-width="2" fill="none" opacity=".35" class="breeze">
           <path d="M${wx - 20} 300 q-60 -20 -120 0 t-120 0"/><path d="M${wx - 30} 360 q-50 -16 -100 0 t-100 0"/></g>`
      : '';
    const jim = s.l.jim ? jimbob(160, 712, 0.95) : '';
    const sleeper = up ? '' : `
      <path d="M470 676 Q600 610 760 640 Q860 650 900 676 Z" fill="#646c8d"/>
      ${hair(860, 664, 10, '#a97c50')}`;
    return `
      <rect width="1600" height="900" fill="#171926"/>
      <rect y="640" width="1600" height="260" fill="#0f1018"/>
      <rect x="${wx - 16}" y="${wy - 16}" width="${ww + 32}" height="${wh + 32}" fill="#2c2f43"/>
      <g>${view}</g>
      ${slats}
      <rect x="${wx - 26}" y="${wy + wh + 10}" width="${ww + 52}" height="16" fill="#353950"/>
      ${light}${breeze}
      <rect x="60" y="230" width="200" height="440" fill="#202233"/>
      <rect x="72" y="242" width="176" height="428" fill="${s.l.jim ? '#d9b58a' : '#252839'}"/>
      ${s.l.jim ? '<rect x="72" y="242" width="176" height="428" fill="url(#doorlight)"/>' : ''}
      <circle cx="232" cy="460" r="7" fill="#4b4f68"/>
      ${jim}
      <g><rect x="292" y="716" width="70" height="14" fill="#5a3f3a"/><rect x="298" y="702" width="62" height="14" fill="#2f4a5c"/>
         <rect x="290" y="688" width="66" height="14" fill="#6b5a3a"/><rect x="300" y="674" width="54" height="14" fill="#3d3550"/></g>
      <rect x="420" y="676" width="520" height="60" rx="10" fill="#3a3f57"/>
      <rect x="420" y="664" width="520" height="22" rx="10" fill="#565e80"/>
      <rect x="830" y="648" width="96" height="30" rx="12" fill="#7a83a6"/>
      ${sleeper}
      ${up ? '<path d="M460 668 Q560 640 640 668 Z" fill="#565e80"/>' : ''}
      <g class="${up ? '' : 'pulse'}">
        <rect x="960" y="726" width="56" height="28" rx="6" fill="#0c0d14"/>
        <rect x="964" y="730" width="48" height="20" rx="4" fill="${up ? '#16202e' : '#3c7bd6'}"/>
        <text x="988" y="745" font-family="IBM Plex Mono, monospace" font-size="13" fill="${up ? '#3c5675' : '#fff'}" text-anchor="middle">05:00</text>
        ${up ? '' : '<circle cx="988" cy="740" r="70" fill="url(#phone)"/>'}
      </g>
      <defs>${radial('phone', '#3c7bd6', 0.35)}${grad('doorlight', [['0', '#fff3d8', 0.6], ['1', '#e0a46a', 0.2]])}</defs>`;
  }

  function kitchen(s) {
    return `
      <rect width="1600" height="900" fill="#1c1e2a"/>
      <rect y="760" width="1600" height="140" fill="#14151d"/>
      <rect x="300" y="140" width="320" height="200" fill="#262938"/>
      <line x1="460" y1="140" x2="460" y2="340" stroke="#1c1e2a" stroke-width="4"/>
      <rect x="660" y="160" width="250" height="170" fill="#2c2f43"/>
      <g>${cityView(672, 172, 226, 146, 0)}</g>
      <line x1="785" y1="172" x2="785" y2="318" stroke="#2c2f43" stroke-width="6"/>
      <rect x="260" y="520" width="900" height="24" fill="#3b3f52"/>
      <rect x="280" y="544" width="860" height="216" fill="#262938"/>
      <line x1="560" y1="544" x2="560" y2="760" stroke="#1c1e2a" stroke-width="4"/>
      <line x1="850" y1="544" x2="850" y2="760" stroke="#1c1e2a" stroke-width="4"/>
      <g>
        <rect x="560" y="390" width="120" height="130" rx="8" fill="#101118"/>
        <rect x="574" y="440" width="70" height="66" rx="6" fill="#2a2632" opacity=".9"/>
        <rect x="582" y="470" width="54" height="34" fill="${s.l.coffee ? '#2a1a12' : '#4a2c1c'}"/>
        <circle cx="664" cy="410" r="5" fill="${s.l.coffee ? '#3a1414' : '#ff3b30'}" class="${s.l.coffee ? '' : 'pulse'}"/>
      </g>
      ${s.l.coffee ? '' : `<g><rect x="720" y="470" width="44" height="50" rx="6" fill="#d8d2c4"/><path d="M764 482 q18 0 18 14 q0 14 -18 14" fill="none" stroke="#d8d2c4" stroke-width="6"/></g>`}
      <rect x="1180" y="190" width="200" height="570" rx="10" fill="#c9ccd3"/>
      <line x1="1180" y1="400" x2="1380" y2="400" stroke="#9ea2ab" stroke-width="4"/>
      <rect x="1350" y="250" width="10" height="100" rx="4" fill="#9ea2ab"/>
      <rect x="1230" y="300" width="70" height="60" fill="#f1dc74" transform="rotate(-4 1265 330)"/>
      <text x="1265" y="336" font-family="IBM Plex Mono, monospace" font-size="11" fill="#333" text-anchor="middle" transform="rotate(-4 1265 330)">BUY PEPSI</text>
      <rect x="1420" y="180" width="180" height="600" fill="#2b2d3e"/>
      <rect x="1440" y="200" width="160" height="580" fill="url(#arch)"/>
      <rect x="20" y="210" width="190" height="560" fill="#111219"/>
      <defs>${grad('arch', [['0', '#3b3a58'], ['1', '#5a4a5e']], false)}</defs>`;
  }

  function living(s) {
    const dawn = s.l.dawn || 0;
    const anton = !s.l.antonGone && s.chapter !== 2;
    const wall = ['#1d1f2c', '#2a2738', '#4b4b58'][dawn];
    const floor = ['#14151e', '#1d1b26', '#33323b'][dawn];
    let park = `<rect x="880" y="500" width="640" height="60" fill="${['#0f1914', '#2d3a30', '#55704f'][dawn]}"/>
      <g fill="${['#0a120d', '#1f2a22', '#3d5a3a'][dawn]}"><circle cx="950" cy="480" r="34"/><circle cx="1420" cy="476" r="40"/><rect x="946" y="480" width="8" height="40"/><rect x="1416" y="476" width="8" height="44"/></g>
      <g fill="${['#1b1612', '#3a2c22', '#6a4f3a'][dawn]}"><rect x="1150" y="516" width="90" height="8"/><rect x="1158" y="524" width="6" height="18"/><rect x="1226" y="524" width="6" height="18"/>
        <rect x="1140" y="534" width="110" height="5"/></g>`;
    if (s.l.babushki) {
      park += ['#7a3b4c', '#3e5b7a', '#8a6f3b', '#5b4a72'].map((c, i) =>
        `<g transform="translate(${1150 + i * 30} 528)"><rect x="-6" y="-22" width="12" height="22" rx="4" fill="${c}"/><circle cy="-28" r="6" fill="#d9b49a"/><path d="M-7 -30 Q0 -40 7 -30 Z" fill="#c9c2b8"/></g>`).join('');
    }
    const desk = (x, w) => `<rect x="${x}" y="690" width="${w}" height="20" fill="#3a3346"/><rect x="${x + 10}" y="710" width="12" height="190" fill="#2a2433"/><rect x="${x + w - 22}" y="710" width="12" height="190" fill="#2a2433"/>`;
    const mon = (x, glow) => `<rect x="${x}" y="560" width="200" height="124" rx="6" fill="#0d0e14"/><rect x="${x + 8}" y="568" width="184" height="108" fill="${glow}"/><rect x="${x + 92}" y="684" width="16" height="8" fill="#0d0e14"/>`;
    const sleeper = anton ? `<g>
      <path d="M700 690 Q700 620 790 610 Q880 620 880 690 Z" fill="#5a4b3c"/>
      <circle cx="790" cy="640" r="32" fill="#2a1f18"/>
      <path d="M690 690 Q720 660 790 668 Q860 660 890 690 Z" fill="#6b5a48"/>
      <text x="850" y="590" font-family="IBM Plex Mono, monospace" font-size="20" fill="#8a8fb0" class="zzz">z</text></g>` : '';
    const catAtDesk = s.l.atDesk ? `<g>
      <path d="M1190 690 Q1190 600 1280 590 Q1370 600 1370 690 Z" fill="#4f6b5c"/>
      <circle cx="1280" cy="566" r="30" fill="#e2b99a"/>${hair(1280, 560, 14, '#a97c50')}</g>` : '';
    return `
      <rect width="1600" height="900" fill="${wall}"/>
      <rect y="660" width="1600" height="240" fill="${floor}"/>
      <rect x="866" y="106" width="668" height="468" fill="#2c2f43"/>
      <g>${cityView(880, 120, 640, 440, dawn)}${park}</g>
      <line x1="1200" y1="120" x2="1200" y2="560" stroke="#2c2f43" stroke-width="8"/>
      <rect x="856" y="566" width="688" height="16" fill="#3a3d52"/>
      <rect x="60" y="470" width="420" height="140" rx="20" fill="#3a3046"/>
      <rect x="40" y="540" width="460" height="110" rx="20" fill="#463956"/>
      <rect x="540" y="430" width="260" height="150" rx="6" fill="#0b0c12"/>
      <rect x="600" y="580" width="140" height="60" fill="#2a2433"/>
      <rect x="0" y="230" width="30" height="460" fill="#2a2433"/>
      ${desk(80, 400)}${desk(600, 400)}${desk(1120, 400)}
      ${mon(170, '#1d2a3a')}<rect x="300" y="664" width="22" height="26" rx="4" fill="#1f4f9c"/>
      ${mon(690, anton ? '#20304a' : '#14181f')}
      ${mon(1210, s.l.atDesk ? '#28466e' : '#16202e')}
      ${sleeper}${catAtDesk}`;
  }

  function cafe(s) {
    const r = rng(11);
    let people = '';
    const n = s.f.returned ? 5 : 34;
    for (let i = 0; i < n; i++) {
      const x = 130 + r() * 1340, y = 560 + r() * 40, c = ['#3b4252', '#6b3b3b', '#38506b', '#5e5a4a', '#2f2f36', '#7a6a58'][i % 6];
      people += `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)})" class="${s.f.returned ? '' : 'walker'}" style="animation-delay:${(-r() * 8).toFixed(2)}s">
        <rect x="-6" y="-30" width="12" height="30" rx="4" fill="${c}"/><circle cy="-36" r="6" fill="#c7a083"/></g>`;
    }
    const facades = [['#c9a46e', 100], ['#a8b7a6', 380], ['#d5c5ad', 640], ['#b88c7a', 930], ['#9fa9b8', 1200]].map(([c, x], i) => {
      let w = '';
      for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) w += `<rect x="${x + 22 + col * 60}" y="${170 + row * 110}" width="30" height="58" fill="#3d3a3f" opacity=".75"/>`;
      return `<rect x="${x}" y="${120 + (i % 2) * 20}" width="270" height="430" fill="${c}"/>${w}`;
    }).join('');
    const man = s.l.man ? jimbob(800, 590, 0.32, 'still') : '';
    return `
      <rect width="1600" height="900" fill="#2b2420"/>
      <defs>${grad('day', [['0', '#a9c4dc'], ['1', '#e2e6e4']])}</defs>
      <rect x="80" y="70" width="1440" height="560" fill="url(#day)"/>
      ${facades}
      <rect x="80" y="545" width="1440" height="85" fill="#8d8a86"/>
      ${people}${man}
      <rect x="80" y="70" width="1440" height="560" fill="#ffffff" opacity="${s.f.returned ? 0.08 : 0.04}"/>
      <g fill="#3a302a"><rect x="66" y="56" width="1468" height="20"/><rect x="66" y="624" width="1468" height="22"/>
        <rect x="560" y="70" width="14" height="560"/><rect x="1040" y="70" width="14" height="560"/></g>
      <rect y="690" width="1600" height="210" fill="#6a4a34"/>
      <rect y="690" width="1600" height="14" fill="#7d5a40"/>
      <g transform="translate(1150 680)"><path d="M-34 -110 L34 -110 L28 0 L-28 0 Z" fill="#efe6da" opacity=".55"/>
        <path d="M-33 ${s.f.returned ? -18 : -96} L33 ${s.f.returned ? -18 : -96} L28 0 L-28 0 Z" fill="#c69a6b" opacity=".9"/></g>
      <ellipse cx="900" cy="700" rx="90" ry="14" fill="#e8e1d6"/>
      ${s.f.returned ? '<g fill="#b58a5c"><circle cx="880" cy="696" r="3"/><circle cx="910" cy="699" r="2"/><circle cx="930" cy="694" r="2.5"/></g>' : '<path d="M850 694 Q900 660 950 694 Z" fill="#c8924f"/>'}`;
  }

  function wake() {
    const candle = (x) => `<rect x="${x - 5}" y="440" width="10" height="70" fill="#e8dcc0"/>
      <ellipse cx="${x}" cy="432" rx="6" ry="12" fill="#ffcf6a" class="flicker"/><circle cx="${x}" cy="436" r="60" fill="url(#cglow)"/>`;
    let rows = '';
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 6; i++) {
        const x = 220 + i * 230 + row * 60, isCat = row === 1 && i === 3;
        rows += seated(x, 790 + row * 110, row ? '#141015' : '#1b161b', isCat);
      }
    }
    return `
      <rect width="1600" height="900" fill="#1a1316"/>
      <defs>${radial('cglow', '#ffb94d', 0.25)}</defs>
      <path d="M560 60 Q800 -20 1040 60 L1040 420 L560 420 Z" fill="#241a1e"/>
      <rect x="770" y="100" width="60" height="10" fill="#4a3a2a"/><rect x="795" y="76" width="10" height="60" fill="#4a3a2a"/>
      <g><path d="M800 230 Q770 232 768 300 L768 470 L832 470 L832 300 Q830 232 800 230 Z" fill="#0d0a0c"/><circle cx="800" cy="206" r="24" fill="#0d0a0c"/></g>
      <rect x="560" y="500" width="480" height="70" rx="8" fill="#3a2418"/>
      <rect x="570" y="490" width="460" height="18" rx="6" fill="#4d3020"/>
      <g fill="#e6e0e8"><circle cx="760" cy="488" r="10"/><circle cx="780" cy="482" r="9"/><circle cx="800" cy="488" r="11"/><circle cx="822" cy="484" r="9"/><circle cx="842" cy="490" r="10"/></g>
      ${candle(500)}${candle(1100)}
      <rect y="570" width="1600" height="330" fill="#110c0e"/>
      ${rows}`;
  }

  function voidScene() {
    return `<rect width="1600" height="900" fill="${VOID}"/>
      ${cat(680, 680, 0.95, 'float')}${jimbob(940, 690, 0.95, 'float late')}`;
  }

  function beach(s) {
    const walk = s.walk || 0;
    const par = (k) => `data-par="${k}" style="transform:translate(${-walk * k}px,0)"`;
    let near = '';
    const r = rng(5);
    for (let i = 0; i < 40; i++) {
      const x = 300 + i * 120 + r() * 60, y = 700 + r() * 170;
      near += r() < 0.5
        ? `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="7" ry="5" fill="#efe1c8"/>`
        : `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="14" ry="4" fill="#c4a67c" opacity=".7"/>`;
    }
    for (let i = 0; i < 6; i++) {
      const x = 900 + i * 700 + r() * 200;
      near += `<path d="M${x} 860 q40 -18 120 -6 q30 6 40 0" stroke="#7a5a40" stroke-width="10" fill="none" stroke-linecap="round"/>`;
    }
    const house = `<g><rect x="60" y="440" width="300" height="200" fill="#e9dcc6"/><polygon points="40,440 210,350 380,440" fill="#8a5a4a"/>
      <rect x="250" y="500" width="70" height="60" fill="#3a3346"/><rect x="254" y="504" width="62" height="52" fill="#f2b480" opacity=".7"/>
      <rect x="110" y="520" width="60" height="120" fill="#5a4a3a"/></g>`;
    const sunY = 470 - Math.min(walk, 6) * 26;
    return `
      <defs>${grad('bk', [['0', '#1c2350'], ['.55', '#a9677a'], ['.85', '#ef9d72'], ['1', '#f7c58f']])}${radial('sunglow', '#ffd59a', 0.5)}</defs>
      <rect width="1600" height="560" fill="url(#bk)"/>
      <g data-sun style="transform:translate(0,${470 - sunY}px)"><circle cx="1060" cy="${470}" r="200" fill="url(#sunglow)"/><circle cx="1060" cy="470" r="64" fill="#ffe0aa"/></g>
      <g ${par(4)}><polygon points="900,470 1100,330 1260,420 1420,300 1640,440 1900,350 2200,470" fill="#5a4a72"/>
        <polygon points="1000,470 1180,400 1330,450 1500,380 1700,470" fill="#463a5e"/></g>
      <rect y="468" width="1600" height="150" fill="#33597a"/>
      <g ${par(12)} stroke="#f7c58f" stroke-width="3" opacity=".55">
        ${Array.from({ length: 30 }, (_, i) => `<line x1="${i * 130}" y1="${490 + (i % 4) * 28}" x2="${i * 130 + 60}" y2="${490 + (i % 4) * 28}"/>`).join('')}</g>
      <path d="M0 610 Q400 590 800 612 T1600 606 L1600 900 L0 900 Z" fill="#d7bb91"/>
      <path d="M0 610 Q400 590 800 612 T1600 606" stroke="#f2ead8" stroke-width="6" fill="none" opacity=".7" class="foam"/>
      <g ${par(70)}>${house}${near}</g>
      <g class="walkers">${cat(700, 800, 0.85)}${jimbob(880, 806, 0.85)}</g>`;
  }

  return { bedroom, kitchen, living, cafe, wake, void: voidScene, beach, VOID };
})();

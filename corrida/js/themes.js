// Corrida Quanta — fases: cada nível muda as cores do mundo, as criaturas e a música.
(() => {
  'use strict';
  window.QC = window.QC || {};

  // cores em hex; "tint" multiplica texturas desenhadas em tons de cinza
  QC.THEMES = [
    {
      id: 'cidade', name: 'Cidade Quanta',
      fog: 0x061a11, skyTop: '#010604', skyMid: '#04130c',
      sun: ['#c6ffe2', '#7dffc0', '#1fd685', '#0f7a4c'], city: '#04120c', cityLit: 'rgba(31,214,133,0.5)',
      stars: '#7dffc0', grid: 0x0d4a30, tileA: 0x2a8a60, tileB: 0x22704f, side: 0x0a261a,
      rail: 0x1fd685, dash: 0x9fc2b0, windows: 0x1fd685, roof: 0x0f5a3a, glyph: 0x1fd685, streak: 0xc6ffe2,
      hemiSky: 0xd8ffe9, hemiGround: 0x0a2a1b, gate: 0x0c2d20,
      creatures: ['balloon', 'bird'],
    },
    {
      id: 'neon', name: 'Pôr do Sol Neon',
      fog: 0x2a0b2e, skyTop: '#0b0220', skyMid: '#3a0b3f',
      sun: ['#fff27a', '#ffb347', '#ff5fa2', '#b8339a'], city: '#1a0420', cityLit: 'rgba(255,95,162,0.6)',
      stars: '#ffd6f0', grid: 0xff3fa4, tileA: 0x7a3a8a, tileB: 0x5e2a70, side: 0x240a2c,
      rail: 0xff5fa2, dash: 0xffd6f0, windows: 0xff7ad0, roof: 0x5a1a5e, glyph: 0xffb347, streak: 0xffd6f0,
      hemiSky: 0xffd0f0, hemiGround: 0x3a0b3f, gate: 0x2a0b35,
      creatures: ['unicorn', 'shooting-star'],
    },
    {
      id: 'oceano', name: 'Oceano Digital',
      fog: 0x04213a, skyTop: '#010a18', skyMid: '#06284a',
      sun: ['#e0fbff', '#8ff0ff', '#2dd4ff', '#1a6fb8'], city: '#03182c', cityLit: 'rgba(45,212,255,0.55)',
      stars: '#bff6ff', grid: 0x1a8fd0, tileA: 0x2a6f9a, tileB: 0x1f5a80, side: 0x06243c,
      rail: 0x2dd4ff, dash: 0xbff6ff, windows: 0x5fe3ff, roof: 0x0f4a70, glyph: 0x8ff0ff, streak: 0xd8fbff,
      hemiSky: 0xd8f6ff, hemiGround: 0x06284a, gate: 0x08263e,
      creatures: ['whale', 'fish', 'bubble', 'duck'],
    },
    {
      id: 'meteoros', name: 'Chuva de Meteoros',
      fog: 0x140a2e, skyTop: '#03010c', skyMid: '#1a0c3a',
      sun: ['#ffe6b0', '#ffb070', '#ff7040', '#8a2a60'], city: '#0c0620', cityLit: 'rgba(167,139,250,0.55)',
      stars: '#ffffff', grid: 0x7a5af8, tileA: 0x5a4a9a, tileB: 0x463a7e, side: 0x160c30,
      rail: 0xa78bfa, dash: 0xe0d6ff, windows: 0xb89cff, roof: 0x3a2a70, glyph: 0xffb070, streak: 0xffe6b0,
      hemiSky: 0xe6dcff, hemiGround: 0x1a0c3a, gate: 0x1c1038,
      creatures: ['meteor', 'shooting-star', 'ufo'],
    },
    {
      id: 'vulcao', name: 'Vulcão',
      fog: 0x2e0a04, skyTop: '#0c0200', skyMid: '#3a0c02',
      sun: ['#fff0a0', '#ffc040', '#ff6a1a', '#b81a0a'], city: '#1c0602', cityLit: 'rgba(255,106,26,0.6)',
      stars: '#ffb070', grid: 0xff5a1a, tileA: 0x8a3a2a, tileB: 0x6e2c20, side: 0x2a0c06,
      rail: 0xff6a1a, dash: 0xffd0a0, windows: 0xff8a3a, roof: 0x5a1a0a, glyph: 0xffc040, streak: 0xffe0a0,
      hemiSky: 0xffe0c0, hemiGround: 0x3a0c02, gate: 0x2e0c06,
      creatures: ['dragon', 'ember', 'meteor'],
    },
    {
      id: 'doces', name: 'Terra dos Doces',
      fog: 0x3a1f3a, skyTop: '#1e0f2a', skyMid: '#5a2d5a',
      sun: ['#ffffff', '#ffe0f0', '#ffb0d8', '#ff7ab8'], city: '#2a1030', cityLit: 'rgba(255,214,240,0.7)',
      stars: '#fff0a0', grid: 0xffb0d8, tileA: 0xc07aa8, tileB: 0xa06090, side: 0x3a1a3a,
      rail: 0xffe07a, dash: 0xffffff, windows: 0xfff0a0, roof: 0xff7ab8, glyph: 0xffffff, streak: 0xfff0f8,
      hemiSky: 0xffffff, hemiGround: 0x5a2d5a, gate: 0x4a204a,
      creatures: ['donut', 'balloon', 'unicorn'],
    },
    {
      id: 'aurora', name: 'Aurora Polar',
      fog: 0x0a2230, skyTop: '#01070c', skyMid: '#0a2a3a',
      sun: ['#ffffff', '#c8fff0', '#7affc8', '#3aa8ff'], city: '#06161e', cityLit: 'rgba(200,255,240,0.6)',
      stars: '#ffffff', grid: 0x7affc8, tileA: 0x8ab8c8, tileB: 0x7098a8, side: 0x0c2230,
      rail: 0x7affc8, dash: 0xffffff, windows: 0xc8fff0, roof: 0x3a6a7a, glyph: 0xc8fff0, streak: 0xffffff,
      hemiSky: 0xf0ffff, hemiGround: 0x0a2a3a, gate: 0x0c2632,
      creatures: ['snowflake', 'bird', 'whale'],
    },
    {
      id: 'galaxia', name: 'Galáxia',
      fog: 0x05030f, skyTop: '#000000', skyMid: '#0a0620',
      sun: ['#ffffff', '#d0c0ff', '#9a7aff', '#4a2ab8'], city: '#04020c', cityLit: 'rgba(154,122,255,0.6)',
      stars: '#ffffff', grid: 0x5a3aff, tileA: 0x4a4a6a, tileB: 0x3a3a58, side: 0x0a0818,
      rail: 0x9a7aff, dash: 0xd0c0ff, windows: 0x9a7aff, roof: 0x2a1a5a, glyph: 0xd0c0ff, streak: 0xffffff,
      hemiSky: 0xe0d8ff, hemiGround: 0x0a0620, gate: 0x100a28,
      creatures: ['ufo', 'rocket', 'comet', 'meteor'],
    },
  ];

  // fase do nível: 1 -> 0, 2 -> 1, ... e recomeça do início depois da última, mais intensa
  QC.themeForLevel = (level) => {
    const i = (level - 1) % QC.THEMES.length;
    const cycle = Math.floor((level - 1) / QC.THEMES.length);
    return { index: i, theme: QC.THEMES[i], intensity: Math.min(1, 0.45 + cycle * 0.3) };
  };
})();

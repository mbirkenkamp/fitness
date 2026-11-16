import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

// Hell: Schneemorgen mit Tannengrün und Kerzenrot.
// Dunkel: Winternacht im Tannenwald, Kerzenlicht in Gold.
const { theme, problems } = makeColors({
  label: 'Weihnachten',
  roles: { accent: '#b3262e', danger: '#c0392b', success: '#2f7d4a', warning: '#b8860b', pro: '#8a6d1f' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#eef3ee',
        'surface-1': '#f4f8f3',
        'surface-2': '#fbfdf9',
        'text-primary': '#14291c',
        'text-secondary': '#34503f',
        'text-muted': '#4d6656',
      },
    },
  },
  dark: {
    roles: { accent: '#e5574f', danger: '#e8665c', success: '#5fbf80', warning: '#e0b84a', pro: '#e6c76a' },
    gray: {
      anchors: {
        'surface-0': '#0f1a14',
        'surface-1': '#131f18',
        'surface-2': '#17261d',
        'surface-3': '#1b2d22',
        'text-primary': '#f3efe2',
        'text-secondary': '#cdd6c6',
        'text-muted': '#a3b5a6',
      },
    },
  },
})

// Schneeflocken: Position, Größe, Dauer und Verzögerung, deterministisch verteilt.
const FLAKES = Array.from({ length: 46 }, (_, i) => {
  const x = (i * 211) % 1000
  const r = 1.4 + ((i * 7) % 5) * 0.6
  const dur = 11 + ((i * 13) % 10)
  const delay = -((i * 17) % 20)
  const drift = ((i % 2 === 0 ? 1 : -1) * (10 + ((i * 3) % 25)))
  return `<circle class="f" cx="${x}" cy="-10" r="${r}" style="animation-duration:${dur}s;animation-delay:${delay}s;--d:${drift}px"/>`
}).join('')

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
<style>
.f{fill:#fff;opacity:.85;animation-name:fall;animation-iteration-count:infinite;animation-timing-function:linear}
@keyframes fall{0%{transform:translate(0,0)}50%{transform:translate(var(--d),320px)}100%{transform:translate(0,640px)}}
.tw{animation:tw 3s ease-in-out infinite}
.tw2{animation:tw 3s ease-in-out -1.2s infinite}
.tw3{animation:tw 3s ease-in-out -2.1s infinite}
@keyframes tw{0%,100%{opacity:.25}50%{opacity:1}}
</style>
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#0b1a2a"/><stop offset="1" stop-color="#17302a"/>
</linearGradient>
</defs>
<rect width="1000" height="600" fill="url(#sky)"/>
<g fill="#0c2218">
<path d="M0 600V470L40 400L25 400L70 320L50 320L95 235L75 235L120 150L165 235L145 235L190 320L170 320L215 400L200 400L240 470V600Z"/>
<path d="M760 600V480L800 410L785 410L830 330L810 330L855 245L835 245L880 160L925 245L905 245L950 330L930 330L975 410L960 410L1000 480V600Z"/>
</g>
<g>
<circle class="tw" cx="880" cy="185" r="4" fill="#ffd45e"/>
<circle class="tw2" cx="845" cy="270" r="4" fill="#ff6b5e"/>
<circle class="tw3" cx="905" cy="270" r="4" fill="#ffd45e"/>
<circle class="tw" cx="860" cy="350" r="4" fill="#ff6b5e"/>
<circle class="tw2" cx="925" cy="355" r="4" fill="#ffd45e"/>
<circle class="tw3" cx="120" cy="175" r="4" fill="#ffd45e"/>
<circle class="tw" cx="85" cy="260" r="4" fill="#ff6b5e"/>
<circle class="tw2" cx="150" cy="262" r="4" fill="#ffd45e"/>
<circle class="tw3" cx="105" cy="345" r="4" fill="#ff6b5e"/>
<circle class="tw" cx="170" cy="350" r="4" fill="#ffd45e"/>
<path class="tw2" d="M880 140l5 12h12l-10 8 4 12-11-7-11 7 4-12-10-8h12z" fill="#ffd45e"/>
<path class="tw" d="M120 108l5 12h12l-10 8 4 12-11-7-11 7 4-12-10-8h12z" fill="#ffd45e"/>
</g>
<path d="M0 600V560Q250 520 500 555T1000 545V600Z" fill="#e9f0ec" opacity=".92"/>
${FLAKES}
</svg>`

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: 'weihnachten', glass: { blur: 6, tint: '#0f1a14', opacity: 0.55 } },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    const set = await $.theme.set(LOOK)

    if (!set.isDrawn) {
      $.ui.status(set.reason)
    }

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)

    return <Svg source={SCENE} alt="Verschneiter Tannenwald mit blinkenden Lichtern" isInteractive />
  })
}

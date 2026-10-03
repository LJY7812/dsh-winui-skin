// dsh-winui-skin client bundle (ModuleLoader format).
//
// Three plugin-owned effects, all installed through ctx.effect so unloading or
// HMR removes them together:
//
//   1. A theme token layer stacked over the active palette through
//      `ctx.theme.overrideTokens(source, tokens)`. Every value is a
//      `{ light, dark }` pair, so Light / Dark / Follow-system all keep
//      working — the skin is a *recolour of both palettes*, not a third
//      palette that would have to be selected from Settings.
//   2. A stylesheet for what a colour token cannot carry: the Fluent type
//      stack, Windows 11 thin scrollbars, the focus rect, the Mica canvas tint
//      and the acrylic flyout hairline.
//   3. A system-accent binding. Windows lets the user pick an accent colour and
//      websites can only reach it through the CSS system-colour keywords
//      (`AccentColor` / `AccentColorText`), so the skin probes those, derives
//      the light/dark shades WinUI itself derives from `SystemAccentColor`, and
//      re-stacks the token layer when the OS accent changes.
//
// Neutrals follow Windows 11 / WinUI 3 ThemeResources:
// SolidBackgroundFillColorBase, LayerFillColorDefault,
// CardBackgroundFillColorDefault, ControlFillColorDefault,
// ControlStrokeColorDefault, DividerStrokeColorDefault,
// TextFillColorPrimary/Secondary/Tertiary/Disabled, FocusStrokeColorOuter,
// SurfaceStrokeColorFlyout, the SystemFillColor* semantic family, and
// ControlCornerRadius (4) / OverlayCornerRadius (8).
//
// The token layer is applied as inline custom properties on <body> by the
// ui-layout presenter, so it outranks the `body` / `body[data-ds-dark-theme]`
// rules in ui-theme's own sheets and survives palette switches.

window.__ModuleLoader__.load({ id: 'dsh-winui-skin', factory: (require) => {
  var module = { exports: {} }
  var exports = module.exports

  /** Owning plugin id; also the override-layer source name and the <style> marker. */
  var PLUGIN_ID = 'dsh-winui-skin'

  /** How often the OS accent is re-read; there is no change event for it. */
  var ACCENT_POLL_MS = 20000

  /** Windows 11 system type ramp. Segoe UI Variable ships with Windows 11. */
  var FONT_UI = '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif'
  /** Cascadia is the Windows Terminal / WinUI code face; Consolas is the fallback. */
  var FONT_MONO = '"Cascadia Code", "Cascadia Mono", "Segoe UI Mono", Consolas, "Microsoft YaHei UI", monospace'

  var BLACK = [0, 0, 0]
  var WHITE = [255, 255, 255]

  // Fluent light palette. Values are the WinUI 3 ThemeResources in
  // Common_themeresources_any.xaml (x:Key="Light"), converted from the XAML
  // #AARRGGBB literals to CSS. Translucent tokens composited over the opaque
  // base are given as the composited hex, matching how DSH consumes them.
  var L = {
    base: '#f3f3f3',
    pane: '#ebebeb',
    card: '#ffffff',
    cardAlt: '#fbfbfb',
    control: 'rgba(255, 255, 255, 0.702)',
    controlHover: 'rgba(249, 249, 249, 0.502)',
    controlPressed: 'rgba(249, 249, 249, 0.302)',
    subtleHover: 'rgba(0, 0, 0, 0.035)',
    subtlePressed: 'rgba(0, 0, 0, 0.024)',
    stroke: 'rgba(0, 0, 0, 0.059)',
    divider: 'rgba(0, 0, 0, 0.059)',
    strokeSecondary: 'rgba(0, 0, 0, 0.161)',
    strokeStrong: 'rgba(0, 0, 0, 0.447)',
    flyoutStroke: 'rgba(0, 0, 0, 0.059)',
    textPrimary: 'rgba(0, 0, 0, 0.894)',
    textSecondary: 'rgba(0, 0, 0, 0.62)',
    textTertiary: 'rgba(0, 0, 0, 0.447)',
    textDisabled: 'rgba(0, 0, 0, 0.361)',
    textInverse: '#ffffff',
    focusOuter: 'rgba(0, 0, 0, 0.894)',
    scrollThumb: 'rgba(0, 0, 0, 0.36)',
    scrollThumbHover: 'rgba(0, 0, 0, 0.5)',
    success: '#0f7b0f',
    successBg: '#dff6dd',
    caution: '#9d5d00',
    cautionBg: '#fff4ce',
    critical: '#c42b1c',
    criticalBg: '#fde7e9'
  }

  // Fluent dark palette (x:Key="Default" is the dark dictionary). WinUI paints
  // translucent veils over the #202020 base, so the resolved values below are
  // the composited result.
  var D = {
    base: '#202020',
    pane: '#1c1c1c',
    card: '#2c2c2c',
    cardAlt: '#323232',
    control: 'rgba(255, 255, 255, 0.059)',
    controlHover: 'rgba(255, 255, 255, 0.082)',
    controlPressed: 'rgba(255, 255, 255, 0.031)',
    subtleHover: 'rgba(255, 255, 255, 0.059)',
    subtlePressed: 'rgba(255, 255, 255, 0.039)',
    stroke: 'rgba(255, 255, 255, 0.071)',
    divider: 'rgba(255, 255, 255, 0.082)',
    strokeSecondary: 'rgba(255, 255, 255, 0.094)',
    strokeStrong: 'rgba(255, 255, 255, 0.545)',
    flyoutStroke: 'rgba(0, 0, 0, 0.2)',
    textPrimary: '#ffffff',
    textSecondary: 'rgba(255, 255, 255, 0.773)',
    textTertiary: 'rgba(255, 255, 255, 0.529)',
    textDisabled: 'rgba(255, 255, 255, 0.365)',
    textInverse: 'rgba(0, 0, 0, 0.894)',
    focusOuter: '#ffffff',
    scrollThumb: 'rgba(255, 255, 255, 0.36)',
    scrollThumbHover: 'rgba(255, 255, 255, 0.5)',
    success: '#6ccb5f',
    successBg: '#393d1b',
    caution: '#fce100',
    cautionBg: '#433519',
    critical: '#ff99a4',
    criticalBg: '#442726'
  }

  // ---- colour helpers ----------------------------------------------------

  /** `rgb()` / `rgba()` / `#rrggbb` -> [r, g, b], or undefined. */
  function parseColor(text) {
    if (typeof text !== 'string') return undefined
    var value = text.trim()
    var hex = /^#([0-9a-f]{6})$/i.exec(value)
    if (hex) {
      return [
        parseInt(hex[1].slice(0, 2), 16),
        parseInt(hex[1].slice(2, 4), 16),
        parseInt(hex[1].slice(4, 6), 16)
      ]
    }
    var parts = /^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/i.exec(value)
    if (parts === null) return undefined
    return [Math.round(+parts[1]), Math.round(+parts[2]), Math.round(+parts[3])]
  }

  /** Move each channel `amount` of the way from `rgb` toward `target`. */
  function mixToward(rgb, target, amount) {
    return rgb.map((channel, index) => Math.round(channel + (target[index] - channel) * amount))
  }

  function toHex(rgb) {
    return '#' + rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')
  }

  function rgba(rgb, alpha) {
    return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + alpha + ')'
  }

  /** WCAG relative luminance, used to pick readable text on a fill. */
  function relativeLuminance(rgb) {
    var linear = rgb.map((channel) => {
      var value = channel / 255
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }

  /**
   * Luminance where black and white text are equally readable (~4.5:1 either
   * way). A looser value such as 0.42 puts white on mid-light accents and drops
   * the contrast to about 2.5:1.
   */
  var CONTRAST_PIVOT = 0.179

  function readableOn(rgb) {
    return relativeLuminance(rgb) >= CONTRAST_PIVOT ? '#000000' : '#ffffff'
  }

  /** WCAG contrast ratio between two colours. */
  function contrastRatio(left, right) {
    var a = relativeLuminance(left) + 0.05
    var b = relativeLuminance(right) + 0.05
    return a > b ? a / b : b / a
  }

  // ---- system accent -----------------------------------------------------

  /**
   * Accent shade set for the running palette.
   *
   * With a system accent, the shades mirror the WinUI mapping of
   * `SystemAccentColor` onto its brushes: the light fill is a slightly darkened
   * accent (`AccentFillColorDefaultBrush` = Dark1), the dark fill a lightened
   * one (Light2), accent text darker still in light mode (Dark2) and lighter in
   * dark mode (Light3). Without one — a browser that does not resolve
   * `AccentColor` — the shipped WinUI default blue is used verbatim.
   * @param {{rgb: number[], onFill: number[]}|undefined} system resolved OS accent.
   * @returns {{fill: object, text: object, attention: object, onFill: object, hover: object, tint: object, tintStrong: object, selection: object, onboarding: object}}
   */
  function accentShades(system) {
    if (system === undefined) {
      return {
        fill: { light: '#0067c0', dark: '#4cc2ff' },
        text: { light: '#003e92', dark: '#99ebff' },
        attention: { light: '#0078d4', dark: '#4cc2ff' },
        onFill: { light: '#ffffff', dark: '#000000' },
        hover: { light: 'rgba(0, 103, 192, 0.9)', dark: 'rgba(76, 194, 255, 0.9)' },
        tint: { light: rgba([0, 120, 212], 0.12), dark: rgba([76, 194, 255], 0.12) },
        tintStrong: { light: rgba([0, 120, 212], 0.2), dark: rgba([76, 194, 255], 0.2) },
        selection: { light: rgba([0, 120, 212], 0.24), dark: rgba([76, 194, 255], 0.3) },
        onboarding: '#0078d4'
      }
    }
    var accent = system.rgb
    var fillLight = mixToward(accent, BLACK, 0.1)
    var fillDark = mixToward(accent, WHITE, 0.35)
    // The OS offers the pairing it uses for the accent; keep it only while it
    // still reads against the shade derived for this palette.
    var onLight = contrastRatio(system.onFill, fillLight) >= 4.5 ? toHex(system.onFill) : readableOn(fillLight)
    return {
      fill: { light: toHex(fillLight), dark: toHex(fillDark) },
      text: { light: toHex(mixToward(accent, BLACK, 0.28)), dark: toHex(mixToward(accent, WHITE, 0.55)) },
      attention: { light: toHex(accent), dark: toHex(mixToward(accent, WHITE, 0.3)) },
      onFill: { light: onLight, dark: readableOn(fillDark) },
      hover: { light: rgba(fillLight, 0.9), dark: rgba(fillDark, 0.9) },
      tint: { light: rgba(accent, 0.12), dark: rgba(accent, 0.18) },
      tintStrong: { light: rgba(accent, 0.2), dark: rgba(accent, 0.28) },
      selection: { light: rgba(accent, 0.26), dark: rgba(accent, 0.34) },
      // The onboarding card paints its own accent behind white text in both
      // palettes, so it takes the saturated accent rather than the dark-mode
      // lightened one.
      onboarding: toHex(accent)
    }
  }

  /**
   * Hidden probe carrying the system-colour keywords. A custom property would
   * only store the literal keyword; applying `AccentColor` to `color` is what
   * forces the engine to resolve it to the OS accent.
   * @returns {HTMLElement|undefined}
   */
  function createAccentProbe() {
    if (typeof document === 'undefined' || document.body === null) return undefined
    var probe = document.createElement('span')
    probe.setAttribute('data-winui-skin-probe', '')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none'
    probe.style.color = 'AccentColor'
    probe.style.backgroundColor = 'AccentColorText'
    document.body.appendChild(probe)
    return probe
  }

  /**
   * Read the OS accent from the probe.
   *
   * `CSS.supports('color', 'AccentColor')` is checked first: on an engine that
   * does not know the keyword the declaration is simply dropped, and reading
   * the computed colour anyway would hand back the *inherited* text colour —
   * i.e. black — and repaint the whole skin with it.
   * @param {HTMLElement|undefined} probe element created by {@link createAccentProbe}.
   * @returns {{rgb: number[], onFill: number[]}|undefined} undefined when the
   * engine does not resolve `AccentColor` (non-Windows, older Chromium).
   */
  function readSystemAccent(probe) {
    if (probe === undefined || typeof getComputedStyle !== 'function') return undefined
    // `globalThis.CSS` explicitly: a local `CSS` binding (this file used to hold
    // the stylesheet in one) would otherwise shadow the engine's CSS object and
    // silently send the accent probe down the unsupported path.
    var css = typeof globalThis === 'object' ? globalThis.CSS : undefined
    if (css === undefined || typeof css.supports !== 'function') return undefined
    if (!css.supports('color', 'AccentColor')) return undefined
    var style = getComputedStyle(probe)
    var rgb = parseColor(style.color)
    if (rgb === undefined) return undefined
    var onFill = css.supports('color', 'AccentColorText') ? parseColor(style.backgroundColor) : undefined
    return { rgb: rgb, onFill: onFill || readableOn(rgb) }
  }

  // ---- token table -------------------------------------------------------

  /** Build a `{ light, dark }` pair from one accessor so the table stays short. */
  function pair(pick) {
    return { light: pick(L), dark: pick(D) }
  }

  /**
   * Alias-token overrides. Keys are the `--dsw-*` alias layer plus the
   * documented rebindable leaves (`--dsh-scrollbar-*`, `--dsw-font-family`,
   * the radius scale) that the theme contract lets a composition rebind.
   *
   * The radius ladder keeps DSH's original *progression* (4/8/12/16/20/28)
   * scaled down onto WinUI's two anchors: 4px for controls
   * (ControlCornerRadius) and 8px for cards and overlays
   * (OverlayCornerRadius), with 12px for the largest panels so a composer or a
   * full-height dialog does not read as a plain rectangle. Collapsing
   * everything onto 2/4/5/7/8/8 instead produced a smear of near-duplicate
   * values and left the big surfaces looking accidental.
   * @param {{rgb: number[], onFill: number[]}|undefined} system resolved OS accent.
   * @returns {object} token name -> { light, dark }.
   */
  function buildTokens(system) {
    var accent = accentShades(system)
    return {
      // ---- Mica canvas and raised surfaces ----
      '--dsw-alias-bg-base': pair((c) => c.base),
      '--dsw-alias-bg-layer-1': pair((c) => c.card),
      '--dsw-alias-bg-layer-2': pair((c) => c.cardAlt),
      '--dsw-alias-bg-layer-3': pair((c) => c.cardAlt),
      '--dsw-alias-bg-overlay': pair((c) => c.cardAlt),
      '--dsw-alias-bg-module-platform': pair((c) => c.pane),
      '--dsw-alias-bg-multi-select': pair((c) => c.pane),
      '--dsw-alias-bg-skeleton': pair((c) => (c === L ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.06)')),
      '--dsw-alias-bg-document-preview': pair((c) => c.pane),
      '--dsw-alias-label-document-preview': pair((c) => c.textSecondary),
      '--dsw-alias-bg-document-selection': { light: accent.selection.light, dark: accent.selection.dark },
      '--dsw-alias-bg-mask-1': pair((c) => (c === L ? 'rgba(0, 0, 0, 0.24)' : 'rgba(0, 0, 0, 0.5)')),
      '--dsw-alias-bg-mask-2': pair((c) => (c === L ? 'rgba(0, 0, 0, 0.12)' : 'rgba(0, 0, 0, 0.2)')),
      '--dsw-alias-bg-mask-3': pair(() => 'rgba(0, 0, 0, 0.48)'),
      '--dsw-alias-bg-mask-photo': pair(() => 'rgba(0, 0, 0, 0.88)'),
      '--dsw-alias-bg-mask-drop': pair((c) => (c === L ? 'rgba(255, 255, 255, 0.72)' : 'rgba(32, 32, 32, 0.75)')),
      '--dsw-specific-sidebar-fill': pair((c) => c.pane),

      // ---- Strokes and dividers (ControlStroke / DividerStroke / CardStroke) ----
      '--dsw-alias-border-l1': pair((c) => c.stroke),
      '--dsw-alias-border-l2': pair((c) => c.divider),
      '--dsw-alias-border-l2-darkmode-thin': pair((c) => (c === L ? c.divider : c.stroke)),
      '--dsw-alias-border-l3': pair((c) => c.strokeSecondary),
      '--dsw-alias-border-l4': pair((c) => c.strokeStrong),
      '--dsw-alias-border-inverted': pair((c) => (c === L ? 'transparent' : c.stroke)),
      '--dsw-alias-border-inverted2': pair((c) => (c === L ? 'transparent' : c.divider)),
      // base.css derives the settings-card material from border-l4; WinUI cards
      // use the far subtler CardStrokeColorDefault instead.
      '--dsw-alias-settings-card-stroke': pair((c) => c.stroke),
      '--dsw-alias-settings-card-fill': pair((c) => c.card),

      // ---- Text (TextFillColor*) ----
      '--dsw-alias-label-primary': pair((c) => c.textPrimary),
      '--dsw-alias-label-primary-dimmed': pair((c) => (c === L ? c.textPrimary : c.textSecondary)),
      '--dsw-alias-label-secondary': pair((c) => c.textSecondary),
      '--dsw-alias-label-tertiary': pair((c) => c.textTertiary),
      '--dsw-alias-label-caption': pair((c) => c.textTertiary),
      '--dsw-alias-label-dimmed': pair((c) => c.textDisabled),
      '--dsw-alias-label-primary-inverted': pair((c) => c.textInverse),
      '--dsw-alias-label-primary-foreground': { light: accent.onFill.light, dark: accent.onFill.dark },
      '--dsw-alias-label-primary-bluish': pair((c) => c.textPrimary),
      '--dsw-alias-brand-text': pair((c) => c.textPrimary),
      '--dsw-alias-menu-icon': pair((c) => c.textSecondary),
      '--dsw-alias-label-shimmer': pair((c) => (c === L ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.45)')),
      '--dsw-alias-label-deep-diving': { light: accent.text.light, dark: accent.text.dark },
      '--dsw-alias-label-deep-diving-shimmer': { light: accent.tintStrong.light, dark: accent.tintStrong.dark },

      // ---- Accent (SystemAccentColor, accent buttons and links) ----
      // Light uses a saturated accent fill with light text; dark flips to the
      // lightened accent with dark text — WinUI's own pairing, and the pairing
      // the original palettes already assumed through
      // `--dsw-alias-label-primary-foreground`.
      '--dsw-alias-brand-primary': { light: accent.fill.light, dark: accent.fill.dark },
      '--dsw-alias-brand-primary-invert': pair((c) => (c === L ? '#ffffff' : 'rgba(0, 0, 0, 0.894)')),
      '--dsw-alias-button-primary-fill': { light: accent.fill.light, dark: accent.fill.dark },
      '--dsw-alias-button-primary-hover': { light: accent.hover.light, dark: accent.hover.dark },
      '--dsw-alias-button-primary-dimmed': pair((c) => c.controlPressed),
      '--dsw-alias-button-info-fill': { light: accent.fill.light, dark: accent.fill.dark },
      '--dsw-alias-button-info-hover': { light: accent.hover.light, dark: accent.hover.dark },
      '--dsw-alias-state-business-primary': { light: accent.attention.light, dark: accent.attention.dark },
      '--dsw-alias-state-business-tertiary': { light: accent.tint.light, dark: accent.tint.dark },
      '--dsw-alias-link': { light: accent.text.light, dark: accent.text.dark },
      '--dsw-alias-onboarding-accent': { light: accent.onboarding, dark: accent.onboarding },

      // ---- Controls (ControlFillColor*, SubtleFillColor*) ----
      '--dsw-alias-button-elevated-fill': pair((c) => c.control),
      '--dsw-alias-button-floating-fill': pair((c) => c.control),
      '--dsw-alias-button-floating-hover': pair((c) => c.controlHover),
      '--dsw-alias-button-contrast-fill': pair((c) => c.textSecondary),
      '--dsw-alias-button-ghost-active-fill': pair((c) => c.subtleHover),
      '--dsw-alias-button-ghost-active-hover': pair((c) => c.subtlePressed),
      '--dsw-alias-button-ghost-active-border': pair((c) => c.strokeStrong),
      '--dsw-alias-interactive-bg-hover': pair((c) => c.subtleHover),
      '--dsw-alias-interactive-bg-hover-solid': pair((c) => (c === L ? '#f0f0f0' : c.card)),
      '--dsw-alias-interactive-bg-active': pair((c) => c.subtlePressed),
      '--dsw-alias-interactive-bg-hover-accent': { light: accent.tint.light, dark: accent.tint.dark },
      '--dsw-alias-interactive-bg-hover-danger': pair((c) => (c === L ? 'rgba(196, 43, 28, 0.06)' : 'rgba(255, 153, 164, 0.09)')),
      '--dsw-alias-switch-thumb': pair(() => '#ffffff'),

      // ---- Sidebar navigation (NavigationView) ----
      '--dsw-specific-sidebar-nav-item-hover': pair((c) => c.subtleHover),
      '--dsw-specific-sidebar-nav-item-active': pair((c) => (c === L ? 'rgba(0, 0, 0, 0.0605)' : 'rgba(255, 255, 255, 0.0837)')),
      '--dsw-specific-sidebar-nav-item-active-accent': { light: accent.tint.light, dark: accent.tint.dark },
      '--dsw-specific-selector': pair((c) => c.subtleHover),
      '--dsw-specific-tip': pair((c) => (c === L ? 'rgba(0, 0, 0, 0.0289)' : 'rgba(255, 255, 255, 0.0538)')),

      // ---- Inputs and composer ----
      '--dsw-specific-input-major': pair((c) => c.control),
      '--dsw-specific-login-input': pair((c) => c.control),
      '--dsw-specific-bubble': { light: accent.tint.light, dark: accent.tint.dark },
      '--dsw-specific-bubble-highlight': { light: accent.tintStrong.light, dark: accent.tintStrong.dark },

      // ---- Markdown and code ----
      '--dsw-alias-markdown-code-block': pair((c) => (c === L ? 'rgba(0, 0, 0, 0.0289)' : 'rgba(255, 255, 255, 0.0538)')),
      '--dsw-alias-markdown-code-block-banner': pair((c) => c.subtleHover),
      '--dsw-alias-markdown-inline-code': pair((c) => c.subtleHover),
      '--dsw-alias-markdown-code-segment-unselected': pair((c) => c.subtleHover),
      '--dsw-alias-markdown-code-segment-selected': pair((c) => (c === L ? '#ffffff' : 'rgba(255, 255, 255, 0.0837)')),
      '--dsw-alias-markdown-citation': pair((c) => c.subtleHover),
      '--dsw-alias-markdown-placeholder': pair((c) => c.subtleHover),
      '--dsw-alias-markdown-tag': pair((c) => c.subtleHover),
      '--dsw-alias-turn-trigger-bg': pair((c) => (c === L ? 'rgba(0, 0, 0, 0.0289)' : 'rgba(255, 255, 255, 0.0538)')),
      '--dsw-alias-turn-trigger-bg-hover': pair((c) => c.subtleHover),

      // ---- Scrollbars (ScrollBarThumbFill) ----
      '--dsw-alias-scrollbar-bg-l1': pair((c) => c.scrollThumb),
      '--dsw-alias-scrollbar-hover-l1': pair((c) => c.scrollThumbHover),
      '--dsw-alias-scrollbar-bg-l2': pair((c) => c.scrollThumb),
      '--dsw-alias-scrollbar-hover-l2': pair((c) => c.scrollThumbHover),

      // ---- Overlays: WinUI keeps tooltips and toasts dark in both palettes ----
      '--dsw-alias-tooltip-bg': pair((c) => (c === L ? '#2b2b2b' : 'rgba(58, 58, 58, 0.96)')),
      '--dsw-alias-tooltip-key-bg': pair(() => 'rgba(255, 255, 255, 0.09)'),
      '--dsw-alias-toast-bg': pair((c) => (c === L ? '#2b2b2b' : '#3a3a3a')),
      '--dsw-alias-toast-label': pair(() => '#ffffff'),

      // ---- Semantic states (SystemFillColor*) ----
      '--dsw-alias-state-error-primary': pair((c) => c.critical),
      '--dsw-alias-state-error-secondary': pair((c) => (c === L ? '#f1707b' : c.critical)),
      '--dsw-alias-state-success-primary': pair((c) => c.success),
      '--dsw-alias-state-success-secondary': pair((c) => (c === L ? '#6ccb5f' : c.success)),
      '--dsw-alias-state-success-tertiary': pair((c) => c.successBg),
      '--dsw-alias-state-warn-primary': pair((c) => c.caution),
      '--dsw-alias-state-warn-secondary': pair((c) => (c === L ? '#efb661' : c.caution)),
      '--dsw-alias-state-warn-tertiary': pair((c) => c.cautionBg),
      '--dsw-alias-state-warn-label': pair((c) => c.caution),
      '--dsw-alias-state-idle-primary': pair((c) => c.textTertiary),
      '--dsw-alias-code-diff-added': pair((c) => (c === L ? 'rgba(15, 123, 15, 0.08)' : 'rgba(108, 203, 95, 0.1)')),
      '--dsw-alias-code-diff-deleted': pair((c) => (c === L ? 'rgba(196, 43, 28, 0.08)' : 'rgba(255, 153, 164, 0.1)')),
      '--dsw-alias-file-diff-added-bg': pair((c) => (c === L ? '#e6f4e6' : '#123b12')),
      '--dsw-alias-file-diff-added-gutter': pair((c) => (c === L ? '#edf7ed' : '#12300f')),
      '--dsw-alias-file-diff-added-marker': pair((c) => (c === L ? '#0f7b0f' : '#6ccb5f')),
      '--dsw-alias-file-diff-deleted-bg': pair((c) => (c === L ? '#fce7e7' : '#3b1517')),
      '--dsw-alias-file-diff-deleted-gutter': pair((c) => (c === L ? '#fdeeee' : '#2f1013')),
      '--dsw-alias-file-diff-deleted-marker': pair((c) => (c === L ? '#c42b1c' : '#ff99a4')),

      // ---- Acrylic overlays (MenuFlyout material) ----
      '--dsw-menu-surface-fill': pair((c) => (c === L ? 'rgba(249, 249, 249, 0.86)' : 'rgba(44, 44, 44, 0.86)')),
      '--dsw-alias-menu-group-header-fill': pair((c) => (c === L ? 'rgba(249, 249, 249, 0.94)' : 'rgba(44, 44, 44, 0.94)')),
      '--dsw-specific-menu': pair((c) => (c === L ? 'rgba(249, 249, 249, 0.86)' : 'rgba(44, 44, 44, 0.86)')),
      '--dsw-menu-backdrop-filter': pair(() => 'blur(30px) saturate(125%)'),
      // SurfaceStrokeColorFlyout: the WinUI flyout/tooltip hairline, which is
      // NOT SurfaceStrokeColorDefault (#66757575 in both themes).
      '--dsh-winui-flyout-stroke': pair((c) => c.flyoutStroke),

      // ---- Elevation: Fluent favours a hairline plus a small flyout shadow ----
      '--dsw-elevation-stroke-color': pair((c) => c.stroke),
      '--dsw-shadow-lv1': pair((c) => (c === L ? '0 2px 4px rgba(0, 0, 0, 0.05)' : '0 2px 4px rgba(0, 0, 0, 0.26)')),
      '--dsw-shadow-lv2': pair((c) => (c === L ? '0 4px 8px rgba(0, 0, 0, 0.06)' : '0 4px 8px rgba(0, 0, 0, 0.3)')),
      '--dsw-shadow-lv3': pair((c) => (c === L ? '0 8px 16px rgba(0, 0, 0, 0.14)' : '0 8px 16px rgba(0, 0, 0, 0.34)')),
      '--dsw-mask-blur': pair(() => 'none'),

      // ---- Geometry: ControlCornerRadius / OverlayCornerRadius ----
      '--dsw-radius-xs': pair(() => '2px'),
      '--dsw-radius-sm': pair(() => '4px'),
      '--dsw-radius-md': pair(() => '4px'),
      '--dsw-radius-lg': pair(() => '8px'),
      '--dsw-radius-xl': pair(() => '8px'),
      '--dsw-radius-panel': pair(() => '12px'),
      '--dsw-focus-ring-width': pair(() => '2px'),
      '--dsw-focus-ring-color': pair((c) => c.focusOuter),

      // ---- Windows 11 scrollbar geometry ----
      // A 12px rail with a 2px thumb at rest; the stylesheet grows the thumb to
      // 6px on hover and 8px while dragging, matching the system scrollbar.
      '--dsh-scrollbar-width': pair(() => '12px'),
      '--dsh-scrollbar-thumb-border': pair(() => '5px'),
      '--dsh-scrollbar-track-margin': pair(() => '0px'),

      // ---- Text selection, keyed off the same accent ----
      '--dsh-winui-selection': { light: accent.selection.light, dark: accent.selection.dark },

      // ---- Typography ----
      '--dsw-font-family': pair(() => FONT_UI),
      '--ds-font-family-code': pair(() => FONT_MONO)
    }
  }

  /** Structural layer: everything a colour token cannot express. */
  var STYLESHEET = [
    '/* dsh-winui-skin — Fluent / WinUI 3 structural layer. Plugin-owned: removed with the plugin. */',

    '/* Windows 11 type ramp applied to the system UI font. */',
    'html body {',
    '  font-family: var(--dsw-font-family);',
    '  font-synthesis: none;',
    '  text-rendering: optimizeLegibility;',
    '  -webkit-font-smoothing: antialiased;',
    '}',

    '/* Cascadia for code surfaces, matching Windows Terminal. */',
    'html body code, html body pre, html body kbd, html body samp,',
    'html body [data-diff], html body [data-read], html body [data-search], html body [data-terminal] {',
    '  font-family: var(--ds-font-family-code);',
    '  font-variant-ligatures: contextual;',
    '}',

    '/* Mica: WinUI tints the app canvas from the desktop wallpaper. Web cannot',
    '   sample the wallpaper, so this reproduces the depth with a faint top-down',
    '   light wash over the SolidBackgroundFillColorBase canvas. */',
    'html body {',
    '  --dsh-winui-mica: linear-gradient(180deg, rgba(255, 255, 255, 0.6) 0px, rgba(255, 255, 255, 0) 360px);',
    '}',
    'html body[data-ds-dark-theme] {',
    '  --dsh-winui-mica: linear-gradient(180deg, rgba(255, 255, 255, 0.045) 0px, rgba(255, 255, 255, 0) 360px);',
    '}',
    'html body {',
    '  background-image: var(--dsh-winui-mica);',
    '  background-attachment: fixed;',
    '}',

    '/* Text selection uses the accent at low alpha, as in WinUI. */',
    'html body ::selection { background-color: var(--dsh-winui-selection); }',

    '/* Windows 11 scrollbar: transparent track, 2px rounded thumb that thickens',
    '   on hover and while dragging. */',
    'html body::-webkit-scrollbar, html body *::-webkit-scrollbar {',
    '  width: var(--dsh-scrollbar-width);',
    '  height: var(--dsh-scrollbar-width);',
    '}',
    'html body::-webkit-scrollbar-track, html body *::-webkit-scrollbar-track {',
    '  margin-block: var(--dsh-scrollbar-track-margin);',
    '  background: transparent;',
    '}',
    'html body::-webkit-scrollbar-thumb, html body *::-webkit-scrollbar-thumb {',
    '  border: var(--dsh-scrollbar-thumb-border) solid transparent;',
    '  border-radius: 999px;',
    '  background-color: var(--dsh-scrollbar-thumb);',
    '  background-clip: content-box;',
    '  transition: border-width 120ms cubic-bezier(0, 0, 0, 1);',
    '}',
    'html body::-webkit-scrollbar-thumb:hover, html body *::-webkit-scrollbar-thumb:hover {',
    '  border-width: 3px;',
    '  background-color: var(--dsh-scrollbar-thumb-hover);',
    '}',
    'html body::-webkit-scrollbar-thumb:active, html body *::-webkit-scrollbar-thumb:active {',
    '  border-width: 2px;',
    '}',
    'html body::-webkit-scrollbar-corner, html body *::-webkit-scrollbar-corner { background: transparent; }',

    '/* Fluent focus rect geometry only. The ring colour, its 2px width and every',
    '   suppression rule (automatic focus, pointer modality) stay owned by',
    "   ui-theme's focus.css: redeclaring the `outline` shorthand here forces",
    '   solid rings onto elements DSH deliberately leaves unringed, such as a',
    '   dialog title focused programmatically. */',
    'html body :focus-visible { outline-offset: -1px; }',

    '/* Acrylic flyouts carry the Windows 11 flyout hairline on top of the blur. */',
    'html body [data-menu-material] {',
    '  box-sizing: border-box;',
    '  border: 1px solid var(--dsh-winui-flyout-stroke);',
    '}',

    '/* Fluent links are underlined on hover only, with a thin 1px rule. */',
    'html body a { text-decoration-thickness: 1px; text-underline-offset: 2px; }',

    '/* WinUI selectors/host text do not use the platform default tap highlight. */',
    'html body { -webkit-tap-highlight-color: transparent; }',

    '/* The system-accent probe must never paint or hit-test. */',
    'html body [data-winui-skin-probe] { display: none !important; }'
  ].join('\n')

  /**
   * Install the three effects for exactly this plugin's lifetime.
   * @param ctx - owning client plugin context (requires the `theme` service).
   */
  function apply(ctx) {
    ctx.effect(function () {
      // Bind the OS accent, then keep it fresh: Windows fires no event for an
      // accent change, so re-read on a slow timer and whenever the page comes
      // back to the foreground.
      var probe = createAccentProbe()
      var system = readSystemAccent(probe)
      var signature = system === undefined ? 'none' : system.rgb.join(',') + '|' + system.onFill.join(',')
      var disposer = ctx.theme.overrideTokens(PLUGIN_ID, buildTokens(system))

      function refresh() {
        var next = readSystemAccent(probe)
        var nextSignature = next === undefined ? 'none' : next.rgb.join(',') + '|' + next.onFill.join(',')
        if (nextSignature === signature) return
        signature = nextSignature
        system = next
        // Re-stacking the same source replaces its whole layer, so the previous
        // disposer becomes a no-op and no layer is leaked.
        disposer = ctx.theme.overrideTokens(PLUGIN_ID, buildTokens(system))
      }

      var timer = setInterval(refresh, ACCENT_POLL_MS)
      addEventListener('focus', refresh)
      document.addEventListener('visibilitychange', refresh)
      return function () {
        clearInterval(timer)
        removeEventListener('focus', refresh)
        document.removeEventListener('visibilitychange', refresh)
        disposer()
        if (probe !== undefined) probe.remove()
      }
    }, 'winui-skin: Fluent token layer')

    ctx.effect(function () {
      if (typeof document === 'undefined') return function () {}
      var tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = PLUGIN_ID + '/winui.css'
      tag.textContent = STYLESHEET
      document.head.appendChild(tag)
      return function () { tag.remove() }
    }, 'winui-skin: Fluent stylesheet')
  }

  // Exported for the contract test: it drives buildTokens() directly to assert
  // that a system accent changes the accent tokens and that the WinUI default
  // is used when the engine cannot resolve one.
  exports.buildTokens = buildTokens
  exports.accentShades = accentShades
  exports.apply = apply
  exports.inject = ['theme']
  return module.exports
} })

// [end of dsh-winui-skin client bundle]

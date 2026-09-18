/**
 * dsh-jina — browser settings card.
 *
 * Renders the Jina Tools card in the Web UI Settings tab, backed by the
 * credentials Remote namespace (`remote.credentials`) with describe/set/unset.
 * Values cross the wire only on save, and the page shows configured state,
 * never the stored value.
 *
 * It also owns the plugin's `jina-tools` settings namespace through the
 * standard settings Remote namespace (`remote.settings`), where `proxyUrl`
 * and default tool behaviors are configured. Reads ride `settings.describe`,
 * writes ride `settings.mutate` fenced by the namespace revision the page read,
 * and external edits arrive as `settings/document-updated` and reload the card.
 *
 * It also runs the key health check: a GET to `/api/dsh-jina/primer`, which
 * answers with the key's Jina identity and credit balance — the same data
 * `jina_primer` reports — and with the proxy the probe actually ran through.
 */
function jinaClientFactory(require) {
    var React = require('react')
    var exports = {}
    var CRED = 'JINA_API_KEY'
    var NS = 'jina-tools'
    var PROXY_FIELD = 'proxyUrl'

    var PROXY_SOURCES = {
      setting: 'Settings card',
      envVar: 'Environment variable JINA_PROXY_URL',
      system: 'Windows system proxy (auto-discovered)',
      environment: 'Startup environment (HTTP_PROXY, etc.)',
      request: 'Specified per request',
      none: 'None (direct connection)',
    }

    var DEFAULT_TARGET_SELECTORS = 'article, main, [role="main"], [role="article"], .markdown-body, .content, #content, .main-content, #main-content, .post-content, .article-body, .entry-content, [itemprop="articleBody"], [itemprop="text"], [data-testid*="article"], [data-testid*="content"]'
    var DEFAULT_REMOVE_SELECTORS = 'header, footer, nav, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .navbar, .site-header, .site-footer, .cookie-banner, #cookie-banner, .consent-banner, #onetrust-banner-sdk, #onetrust-consent-sdk, .cookiebot, #CookiebotWidget, .didomi-popup-container, .ads, .ad, .advertisement, [id^="google_ads"], [id^="ad-"], [class*="-ad-"], .sidebar, #sidebar, .aside, .social-share, .comments, #comments, .menu, .breadcrumbs, .related-posts, .author-bio, .footer-nav, .popup, .modal, .overlay, .paywall, .paywall-overlay, .premium-gate, .subscription-gate, .newsletter-signup'
    var DEFAULT_WAIT_FOR_SELECTOR = 'article, main, [role="main"], #root, #app'

    var PRESET_TEMPLATES = {
      balanced: {
        label: 'Balanced (High Signal)',
        preset: 'agent',
        searchNum: '5',
        tokenBudget: '8000',
        engine: 'auto',
        retainImages: 'none',
        targetSelector: DEFAULT_TARGET_SELECTORS,
        removeSelector: DEFAULT_REMOVE_SELECTORS,
        waitForSelector: '',
        noCache: false,
        autoBypassCloudflare: true,
        removeOverlay: true,
        detachInvisibles: true,
        withShadowDom: false,
        withIframe: false,
      },
      research: {
        label: 'Deep Academic Research',
        preset: 'research',
        searchNum: '8',
        tokenBudget: '16000',
        engine: 'auto',
        retainImages: 'alt',
        targetSelector: DEFAULT_TARGET_SELECTORS,
        removeSelector: DEFAULT_REMOVE_SELECTORS,
        waitForSelector: '',
        noCache: false,
        autoBypassCloudflare: true,
        removeOverlay: true,
        detachInvisibles: true,
        withShadowDom: true,
        withIframe: true,
      },
      'clean-read': {
        label: 'Strict Clean Read (Aggressive Boilerplate Stripping)',
        preset: 'reader',
        searchNum: '5',
        tokenBudget: '10000',
        engine: 'auto',
        retainImages: 'none',
        targetSelector: 'article, main, [role="main"], .markdown-body',
        removeSelector: DEFAULT_REMOVE_SELECTORS + ', .menu, .breadcrumbs, .related-posts, .author-bio, .footer-nav',
        waitForSelector: '',
        noCache: false,
        autoBypassCloudflare: true,
        removeOverlay: true,
        detachInvisibles: true,
        withShadowDom: false,
        withIframe: false,
      },
      'fast-index': {
        label: 'Fast Indexing (Token-Capped)',
        preset: 'index',
        searchNum: '4',
        tokenBudget: '4000',
        engine: 'auto',
        retainImages: 'none',
        targetSelector: DEFAULT_TARGET_SELECTORS,
        removeSelector: DEFAULT_REMOVE_SELECTORS,
        waitForSelector: '',
        noCache: false,
        autoBypassCloudflare: false,
        removeOverlay: true,
        detachInvisibles: true,
        withShadowDom: false,
        withIframe: false,
      },
      'spa-resilient': {
        label: 'SPA & Heavy JavaScript (Headless Browser)',
        preset: 'agent',
        searchNum: '5',
        tokenBudget: '12000',
        engine: 'browser',
        retainImages: 'none',
        targetSelector: DEFAULT_TARGET_SELECTORS,
        removeSelector: DEFAULT_REMOVE_SELECTORS,
        waitForSelector: DEFAULT_WAIT_FOR_SELECTOR,
        noCache: true,
        autoBypassCloudflare: true,
        removeOverlay: true,
        detachInvisibles: true,
        withShadowDom: true,
        withIframe: false,
      },
      'effective-stealth': {
        label: 'Effective Stealth (Resilience & Anti-Bot Defense)',
        preset: 'agent',
        searchNum: '5',
        tokenBudget: '12000',
        engine: 'cf-browser-rendering',
        retainImages: 'none',
        targetSelector: DEFAULT_TARGET_SELECTORS,
        removeSelector: DEFAULT_REMOVE_SELECTORS,
        waitForSelector: DEFAULT_WAIT_FOR_SELECTOR,
        noCache: true,
        autoBypassCloudflare: true,
        removeOverlay: true,
        detachInvisibles: true,
        withShadowDom: true,
        withIframe: false,
      },
    }
    // Backward compatibility alias
    PRESET_TEMPLATES['adversarial-stealth'] = PRESET_TEMPLATES['effective-stealth']

    var PROXY_REJECTS = {
      scheme: 'Only http:// or https:// proxies are supported',
      invalid: 'Invalid address format',
      empty: 'Address is empty',
      type: 'Address is not a string',
    }

    var S = {
      card: { boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 16, boxShadow: 'var(--dsw-shadow-lv3)', overflow: 'hidden', margin: 0, listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2))' },
      header: { boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 12, border: 'none', background: 'transparent', cursor: 'pointer', padding: '14px 18px', fontFamily: 'inherit', textAlign: 'left', color: 'inherit' },
      headText: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
      name: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', lineHeight: '22px', margin: 0 },
      description: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.85))', margin: 0 },
      chevron: { flex: 'none', color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.85))', transition: 'transform .15s ease', display: 'block' },
      body: { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14, padding: '0 18px 18px' },
      row: { display: 'flex', gap: 8, alignItems: 'center' },
      input: { boxSizing: 'border-box', flex: 1, minWidth: 0, height: 36, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))', background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.15))', color: 'var(--dsw-alias-label-primary)', padding: '0 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none' },
      button: { boxSizing: 'border-box', height: 34, borderRadius: 8, border: 'none', padding: '0 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-2, #1e1e20)', fontFamily: 'inherit' },
      ghostButton: { boxSizing: 'border-box', height: 34, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))', padding: '0 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: 'transparent', color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.92))', fontFamily: 'inherit' },
      link: { color: 'var(--dsw-alias-brand-primary, #4b88ff)', textDecoration: 'none' },
      status: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.92))', margin: 0 },
      statusOk: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-success, #22c55e)', margin: 0 },
      statusBad: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-error, #ef4444)', margin: 0 },
      note: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.92))', margin: 0 },
      infoBox: { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))', border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.2))', borderRadius: 12, padding: '14px 16px' },
      infoHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      infoLabel: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', margin: 0 },
      smallButton: { boxSizing: 'border-box', height: 26, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))', padding: '0 10px', cursor: 'pointer', fontSize: 11, fontWeight: 500, background: 'transparent', color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.92))', fontFamily: 'inherit' },

      // Structured field styles
      fieldGroup: { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 6 },
      fieldLabel: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', margin: 0 },
      fieldHint: { fontSize: 11, lineHeight: 1.4, color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.75))', margin: 0 },
      formInput: { boxSizing: 'border-box', width: '100%', height: 34, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))', background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.18))', color: 'var(--dsw-alias-label-primary)', padding: '0 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' },
      formSelect: { boxSizing: 'border-box', width: '100%', height: 34, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))', background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.18))', color: 'var(--dsw-alias-label-primary)', padding: '0 8px', fontSize: 13, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 },
    }

    function Chevron(props) {
      return React.createElement('svg', {
        width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true,
        style: Object.assign({}, S.chevron, props.open ? { transform: 'rotate(180deg)' } : null),
      },
        React.createElement('path', {
          d: 'M3.5 5.5L7 9l3.5-3.5', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function JinaCard(props) {
      var ctx = props.ctx
      var remote = props.remote || (ctx && typeof ctx.get === 'function' ? ctx.get('remote') : undefined)
      var getCredentials = props.getCredentials
      var getSettings = props.getSettings
      var credentials = typeof getCredentials === 'function' ? getCredentials() : props.credentials
      var settings = typeof getSettings === 'function' ? getSettings() : props.settings

      var isPage = props.standalone === true || props.view === 'page'
      var [open, setOpen] = React.useState(isPage ? true : false)
      var [input, setInput] = React.useState('')
      var [status, setStatus] = React.useState('')
      var [statusKind, setStatusKind] = React.useState('info')
      var [view, setView] = React.useState(undefined)
      var [primer, setPrimer] = React.useState({ phase: 'loading', data: undefined, error: undefined })

      // Proxy state
      var [proxyView, setProxyView] = React.useState({ phase: 'ready', url: '', revision: undefined, writable: true, error: '' })
      var [proxyInput, setProxyInput] = React.useState('')
      var [proxyStatus, setProxyStatus] = React.useState('')
      var [proxyStatusKind, setProxyStatusKind] = React.useState('info')
      var proxyDirty = React.useRef(false)

      // Tool options state
      var [activePresetInput, setActivePresetInput] = React.useState('balanced')
      var [searchNumInput, setSearchNumInput] = React.useState('5')
      var [tokenBudgetInput, setTokenBudgetInput] = React.useState('')
      var [engineInput, setEngineInput] = React.useState('auto')
      var [retainImagesInput, setRetainImagesInput] = React.useState('none')
      var [waitForSelectorInput, setWaitForSelectorInput] = React.useState('')
      var [targetSelectorInput, setTargetSelectorInput] = React.useState(DEFAULT_TARGET_SELECTORS)
      var [removeSelectorInput, setRemoveSelectorInput] = React.useState(DEFAULT_REMOVE_SELECTORS)
      var [noCacheInput, setNoCacheInput] = React.useState(false)
      var [autoBypassCfInput, setAutoBypassCfInput] = React.useState(true)
      var [autoRemoveOverlayInput, setAutoRemoveOverlayInput] = React.useState(true)
      var [autoDetachInvisiblesInput, setAutoDetachInvisiblesInput] = React.useState(true)
      var [autoShadowDomInput, setAutoShadowDomInput] = React.useState(false)
      var [autoIframeInput, setAutoIframeInput] = React.useState(false)
      var [toolsStatus, setToolsStatus] = React.useState('')
      var [toolsStatusKind, setToolsStatusKind] = React.useState('info')
      var toolsDirty = React.useRef(false)

      var settingsApi = function () {
        if (typeof getSettings === 'function') {
          var s = getSettings()
          if (s) return s
        }
        if (settings) return settings
        try {
          if (ctx && typeof ctx.get === 'function') {
            var rs = ctx.get('remote.settings')
            if (rs && typeof rs.describe === 'function') return rs
          }
        } catch (err) {}
        try {
          return remote && remote.settings ? remote.settings : undefined
        } catch (err) {
          return undefined
        }
        var conn = ctx && typeof ctx.get === 'function' ? ctx.get('connection') : undefined
        var a = conn && conn.api ? conn.api : undefined
        if (a && a.settings) {
          return {
            describe: function () {
              return a.settings.describe({}).then(function (res) {
                if (res && res.result && res.result.ok) return { ok: true, value: res.result.value }
                return { ok: false, error: res && res.result && res.result.error }
              })
            },
            mutate: function (requestOrNs, ops, expectedRevision) {
              var payload = typeof requestOrNs === 'string' ? { ns: requestOrNs, ops: ops } : requestOrNs
              return a.settings.mutate(payload).then(function (res) {
                if (res && res.result && res.result.ok) return { ok: true, value: res.result.value }
                return { ok: false, error: res && res.result && res.result.error }
              })
            }
          }
        }
        return undefined
      }

      var credentialsApi = function () {
        if (typeof getCredentials === 'function') {
          var c = getCredentials()
          if (c) return c
        }
        if (credentials) return credentials
        try {
          if (ctx && typeof ctx.get === 'function') {
            var rc = ctx.get('remote.credentials')
            if (rc && typeof rc.describe === 'function') return rc
          }
        } catch (err) {}
        var r = remote || (ctx && typeof ctx.get === 'function' ? ctx.get('remote') : undefined)
        try {
          if (r && r.credentials && typeof r.credentials.describe === 'function') return r.credentials
        } catch (err) {}
        var conn = ctx && typeof ctx.get === 'function' ? ctx.get('connection') : undefined
        var a = conn && conn.api ? conn.api : undefined
        if (a && a.credentials) {
          return {
            describe: function (refs) {
              return a.credentials.describe({ refs: Array.isArray(refs) ? refs : [refs] }).then(function (res) {
                if (res && res.result && res.result.ok) return { ok: true, value: res.result.value.credentials }
                return { ok: false, error: res && res.result && res.result.error }
              })
            },
            set: function (ref, value) {
              return a.credentials.set({ ref: ref, value: value }).then(function (res) {
                return { ok: Boolean(res && res.result && res.result.ok) }
              })
            },
            unset: function (ref) {
              return a.credentials.unset({ ref: ref }).then(function (res) {
                return { ok: Boolean(res && res.result && res.result.ok) }
              })
            },
          }
        }
        return undefined
      }

      var refresh = function () {
        var creds = credentialsApi()
        if (creds === undefined) return
        creds.describe([CRED]).then(function (response) {
          if (!response || response.ok !== true) return
          setView(response.value[CRED])
        }, function () { /* keep previous view */ })
      }

      var loadPrimer = function () {
        setPrimer({ phase: 'loading', data: undefined, error: undefined })
        fetch('/api/dsh-jina/primer').then(function (r) { return r.json() }).then(function (payload) {
          if (payload && payload.ok === true) setPrimer({ phase: 'ok', data: payload, error: undefined })
          else setPrimer({ phase: 'error', data: undefined, error: (payload && payload.error) || 'HTTP ' + (payload && payload.status) })
        }, function (err) {
          setPrimer({ phase: 'error', data: undefined, error: String((err && err.message) || err) })
        })
      }

      var adoptProxy = function (row, writable) {
        var val = Object.assign({}, row && row.base, row && row.value, row && row.user)
        var url = typeof val[PROXY_FIELD] === 'string' ? val[PROXY_FIELD] : ''
        setProxyView({
          phase: 'ready',
          url: url,
          revision: row ? row.revision : undefined,
          writable: writable !== false,
          error: '',
        })
        if (!proxyDirty.current) setProxyInput(url)
        if (!toolsDirty.current) {
          if (typeof val.defaultPreset === 'string' && PRESET_TEMPLATES[val.defaultPreset]) {
            setActivePresetInput(val.defaultPreset)
          }
          if (typeof val.defaultSearchNum === 'number') {
            setSearchNumInput(String(val.defaultSearchNum))
          }
          var rawBudget = val.defaultTokenBudget
          if (rawBudget !== undefined && rawBudget !== null && String(rawBudget).trim() !== '' && !isNaN(Number(rawBudget))) {
            setTokenBudgetInput(String(rawBudget))
          } else {
            setTokenBudgetInput('')
          }
          if (typeof val.defaultEngine === 'string' && val.defaultEngine !== '') {
            setEngineInput(val.defaultEngine)
          }
          if (typeof val.defaultRetainImages === 'string' && val.defaultRetainImages !== '') {
            setRetainImagesInput(val.defaultRetainImages)
          }
          if (typeof val.defaultWaitForSelector === 'string') {
            setWaitForSelectorInput(val.defaultWaitForSelector)
          }
          if (typeof val.defaultTargetSelector === 'string') {
            setTargetSelectorInput(val.defaultTargetSelector)
          }
          if (typeof val.defaultRemoveSelector === 'string') {
            setRemoveSelectorInput(val.defaultRemoveSelector)
          }
          if (typeof val.defaultNoCache === 'boolean') {
            setNoCacheInput(val.defaultNoCache)
          }
          if (typeof val.autoBypassCloudflare === 'boolean') {
            setAutoBypassCfInput(val.autoBypassCloudflare)
          }
          if (typeof val.defaultRemoveOverlay === 'boolean') {
            setAutoRemoveOverlayInput(val.defaultRemoveOverlay)
          }
          if (typeof val.defaultDetachInvisibles === 'boolean') {
            setAutoDetachInvisiblesInput(val.defaultDetachInvisibles)
          }
          if (typeof val.defaultWithShadowDom === 'boolean') {
            setAutoShadowDomInput(val.defaultWithShadowDom)
          }
          if (typeof val.defaultWithIframe === 'boolean') {
            setAutoIframeInput(val.defaultWithIframe)
          }
        }
        return url
      }

      var loadProxy = function () {
        var api = settingsApi()
        if (api === undefined || typeof api.describe !== 'function') {
          setProxyView(function (prev) {
            return Object.assign({}, prev, { phase: 'ready', writable: true, error: '' })
          })
          return
        }
        api.describe().then(function (response) {
          if (!response || response.ok !== true) {
            var message = (response && response.error && response.error.message) || 'settings.describe failed'
            setProxyView(function (prev) {
              return Object.assign({}, prev, { phase: 'ready', writable: true, error: message })
            })
            return
          }
          var doc = response.value || {}
          var rows = Array.isArray(doc.namespaces) ? doc.namespaces : []
          var row = rows.filter(function (entry) { return entry && entry.ns === NS })[0]
          if (row === undefined) {
            adoptProxy({ value: {}, revision: doc.revision }, doc.writable !== false)
            return
          }
          adoptProxy(row, doc.writable !== false)
        }, function (err) {
          setProxyView(function (prev) {
            return Object.assign({}, prev, { phase: 'ready', writable: true, error: String((err && err.message) || err) })
          })
        })
      }

      var writeProxy = function (ops, okMessage) {
        var api = settingsApi()
        if (api === undefined || typeof api.mutate !== 'function') {
          setProxyStatusKind('bad')
          setProxyStatus('Settings service unavailable in this environment; unable to save.')
          setToolsStatusKind('bad')
          setToolsStatus('Settings service unavailable in this environment; unable to save.')
          return
        }
        if (proxyView.writable === false) {
          setProxyStatusKind('bad')
          setProxyStatus('Current environment is read-only (settings document is not writable); cannot save here.')
          setToolsStatusKind('bad')
          setToolsStatus('Current environment is read-only (settings document is not writable); cannot save here.')
          return
        }
        setProxyStatusKind('info')
        setProxyStatus('Saving…')
        setToolsStatusKind('info')
        setToolsStatus('Saving…')
        api.mutate(NS, ops, proxyView.revision).then(function (response) {
          if (response && response.ok === true) {
            toolsDirty.current = false
            proxyDirty.current = false
            adoptProxy(response.value, proxyView.writable)
            setProxyStatusKind('ok')
            setProxyStatus(okMessage)
            setToolsStatusKind('ok')
            setToolsStatus(okMessage)
            loadPrimer()
          } else {
            var message = (response && response.error && (response.error.message || response.error.code)) || 'Unknown error'
            setProxyStatusKind('bad')
            setProxyStatus('Save failed: ' + message)
            setToolsStatusKind('bad')
            setToolsStatus('Save failed: ' + message)
          }
        }, function (err) {
          setProxyStatusKind('bad')
          setProxyStatus('Save failed. Please try again.')
          setToolsStatusKind('bad')
          setToolsStatus('Save failed: ' + String((err && err.message) || err))
        })
      }

      React.useEffect(function () {
        refresh()
        loadProxy()
        loadPrimer()
      }, [])

      React.useEffect(function () {
        if (!remote || typeof remote.$on !== 'function') return
        var offCreds = remote.$on('credentials/reference-updated', function (payload) {
          if (!payload || !Array.isArray(payload.refs)) return
          if (payload.refs.indexOf(CRED) !== -1) {
            refresh()
            loadPrimer()
          }
        })
        var offSettings = remote.$on('settings/document-updated', function () {
          proxyDirty.current = false
          toolsDirty.current = false
          loadProxy()
        })
        return function () {
          if (typeof offCreds === 'function') offCreds()
          if (typeof offSettings === 'function') offSettings()
        }
      }, [remote])

      function onInput(e) { setInput(e.target.value) }

      function onSave() {
        var value = input.trim()
        if (value === '') {
          setStatusKind('bad')
          setStatus('Please enter an API key.')
          return
        }
        var creds = credentialsApi()
        if (creds === undefined) {
          setStatusKind('bad')
          setStatus('Credentials service unavailable in this environment; unable to save.')
          return
        }
        setStatusKind('info')
        setStatus('Saving…')
        creds.set(CRED, value).then(function (response) {
          if (response && response.ok === true) {
            setStatusKind('ok')
            setStatus('Saved.')
            setInput('')
            refresh()
            loadPrimer()
          } else {
            setStatusKind('bad')
            setStatus('Save failed: ' + String((response && response.error && response.error.message) || 'Unknown error'))
          }
        }, function () {
          setStatusKind('bad')
          setStatus('Save failed. Please try again.')
        })
      }

      function onClear() {
        var creds = credentialsApi()
        if (creds === undefined) {
          setStatusKind('bad')
          setStatus('Credentials service unavailable in this environment; unable to clear.')
          return
        }
        setStatusKind('info')
        setStatus('Clearing…')
        creds.unset(CRED).then(function (response) {
          if (response && response.ok === true) {
            setStatusKind('ok')
            setStatus('Cleared.')
            setInput('')
            refresh()
            loadPrimer()
          } else {
            setStatusKind('bad')
            setStatus('Clear failed: ' + String((response && response.error && response.error.message) || 'Unknown error'))
          }
        }, function () {
          setStatusKind('bad')
          setStatus('Clear failed. Please try again.')
        })
      }

      var configured = view ? view.configured === true : false
      var writable = view ? view.writable === true : false
      var shown = view === undefined
        ? 'Reading settings…'
        : configured
          ? 'API key configured (source: ' + String(view.source || 'local storage') + '). Paste a new key and save to overwrite.'
          : 'No API key configured.'

      var statusStyle = statusKind === 'ok' ? S.statusOk : statusKind === 'bad' ? S.statusBad : S.status

      function onProxyInput(e) {
        proxyDirty.current = true
        setProxyInput(e.target.value)
      }

      function onProxySave() {
        var value = proxyInput.trim()
        if (value === '') {
          setProxyStatusKind('bad')
          setProxyStatus('Please enter a local proxy address, e.g. http://127.0.0.1:7897.')
          return
        }
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) value = 'http://' + value
        if (!/^https?:\/\//i.test(value)) {
          setProxyStatusKind('bad')
          setProxyStatus('Only http:// or https:// proxies are supported (e.g. http://127.0.0.1:7897). socks:// is not supported by the network helper.')
          return
        }
        try {
          var parsed = new URL(value)
          if (!parsed.hostname) throw new Error('no host')
        } catch (err) {
          setProxyStatusKind('bad')
          setProxyStatus('Please enter "host:port" (e.g. 127.0.0.1:7897) or a full URL (e.g. http://127.0.0.1:7897).')
          return
        }
        proxyDirty.current = false
        writeProxy([{ op: 'set', path: [PROXY_FIELD], value: value }], 'Saved. Takes effect on the next tool call.')
      }

      function onProxyClear() {
        proxyDirty.current = false
        writeProxy([{ op: 'unset', path: [PROXY_FIELD] }], 'Cleared. Returned to auto-detection (system proxy / environment variables).')
      }

      function applyPreset(presetKey) {
        var t = PRESET_TEMPLATES[presetKey]
        if (!t) return
        toolsDirty.current = true
        setActivePresetInput(presetKey)
        setSearchNumInput(t.searchNum)
        setTokenBudgetInput(t.tokenBudget)
        setEngineInput(t.engine)
        setRetainImagesInput(t.retainImages)
        setTargetSelectorInput(t.targetSelector)
        setRemoveSelectorInput(t.removeSelector)
        setWaitForSelectorInput(t.waitForSelector)
        setNoCacheInput(t.noCache)
        setAutoBypassCfInput(t.autoBypassCloudflare)
        if (typeof t.removeOverlay === 'boolean') setAutoRemoveOverlayInput(t.removeOverlay)
        if (typeof t.detachInvisibles === 'boolean') setAutoDetachInvisiblesInput(t.detachInvisibles)
        if (typeof t.withShadowDom === 'boolean') setAutoShadowDomInput(t.withShadowDom)
        if (typeof t.withIframe === 'boolean') setAutoIframeInput(t.withIframe)
        setToolsStatusKind('info')
        setToolsStatus('Loaded "' + t.label + '" preset into draft. Click "Save Options" to persist.')
      }

      function onSaveTools() {
        var ops = []
        if (activePresetInput) ops.push({ op: 'set', path: ['defaultPreset'], value: activePresetInput })

        var num = parseInt(searchNumInput, 10)
        if (!isNaN(num) && num > 0) ops.push({ op: 'set', path: ['defaultSearchNum'], value: num })
        else ops.push({ op: 'unset', path: ['defaultSearchNum'] })

        var budget = parseInt(tokenBudgetInput, 10)
        if (!isNaN(budget) && budget > 0) ops.push({ op: 'set', path: ['defaultTokenBudget'], value: budget })
        else ops.push({ op: 'unset', path: ['defaultTokenBudget'] })

        if (engineInput && engineInput !== 'auto') ops.push({ op: 'set', path: ['defaultEngine'], value: engineInput })
        else ops.push({ op: 'unset', path: ['defaultEngine'] })

        if (retainImagesInput && retainImagesInput !== 'none') ops.push({ op: 'set', path: ['defaultRetainImages'], value: retainImagesInput })
        else ops.push({ op: 'unset', path: ['defaultRetainImages'] })

        if (waitForSelectorInput.trim() !== '') ops.push({ op: 'set', path: ['defaultWaitForSelector'], value: waitForSelectorInput.trim() })
        else ops.push({ op: 'unset', path: ['defaultWaitForSelector'] })

        if (targetSelectorInput.trim() !== '') ops.push({ op: 'set', path: ['defaultTargetSelector'], value: targetSelectorInput.trim() })
        else ops.push({ op: 'unset', path: ['defaultTargetSelector'] })

        if (removeSelectorInput.trim() !== '') ops.push({ op: 'set', path: ['defaultRemoveSelector'], value: removeSelectorInput.trim() })
        else ops.push({ op: 'unset', path: ['defaultRemoveSelector'] })

        if (noCacheInput === true) ops.push({ op: 'set', path: ['defaultNoCache'], value: true })
        else ops.push({ op: 'unset', path: ['defaultNoCache'] })

        if (autoBypassCfInput === false) ops.push({ op: 'set', path: ['autoBypassCloudflare'], value: false })
        else ops.push({ op: 'set', path: ['autoBypassCloudflare'], value: true })

        if (autoRemoveOverlayInput === false) ops.push({ op: 'set', path: ['defaultRemoveOverlay'], value: false })
        else ops.push({ op: 'set', path: ['defaultRemoveOverlay'], value: true })

        if (autoDetachInvisiblesInput === false) ops.push({ op: 'set', path: ['defaultDetachInvisibles'], value: false })
        else ops.push({ op: 'set', path: ['defaultDetachInvisibles'], value: true })

        if (autoShadowDomInput === true) ops.push({ op: 'set', path: ['defaultWithShadowDom'], value: true })
        else ops.push({ op: 'unset', path: ['defaultWithShadowDom'] })

        if (autoIframeInput === true) ops.push({ op: 'set', path: ['defaultWithIframe'], value: true })
        else ops.push({ op: 'unset', path: ['defaultWithIframe'] })

        setToolsStatusKind('info')
        setToolsStatus('Saving tool options…')
        writeProxy(ops, 'Tool options saved successfully.')
      }

      function onResetTools() {
        toolsDirty.current = false
        applyPreset('balanced')
        var ops = [
          { op: 'unset', path: ['defaultPreset'] },
          { op: 'unset', path: ['defaultSearchNum'] },
          { op: 'unset', path: ['defaultTokenBudget'] },
          { op: 'unset', path: ['defaultEngine'] },
          { op: 'unset', path: ['defaultRetainImages'] },
          { op: 'unset', path: ['defaultWaitForSelector'] },
          { op: 'unset', path: ['defaultTargetSelector'] },
          { op: 'unset', path: ['defaultRemoveSelector'] },
          { op: 'unset', path: ['defaultNoCache'] },
          { op: 'unset', path: ['autoBypassCloudflare'] },
          { op: 'unset', path: ['defaultRemoveOverlay'] },
          { op: 'unset', path: ['defaultDetachInvisibles'] },
          { op: 'unset', path: ['defaultWithShadowDom'] },
          { op: 'unset', path: ['defaultWithIframe'] },
        ]
        setToolsStatusKind('info')
        setToolsStatus('Resetting tool options to Balanced defaults…')
        writeProxy(ops, 'Tool options reset to Balanced defaults.')
      }

      var proxyConfigured = typeof proxyView.url === 'string' && proxyView.url.trim() !== ''
      var proxyShown
      if (proxyView.phase === 'loading') proxyShown = 'Reading settings…'
      else if (proxyView.error) proxyShown = proxyView.error + ' Auto-detection remains active: Windows system proxy, startup environment variables (HTTP_PROXY / HTTPS_PROXY).'
      else if (proxyConfigured) proxyShown = 'Configured: ' + proxyView.url + ' (used on next tool call).'
      else proxyShown = 'Not configured: using auto-detection (Windows system proxy → startup environment variables).'

      var proxyStatusStyle = proxyStatusKind === 'ok' ? S.statusOk : proxyStatusKind === 'bad' ? S.statusBad : S.status
      var isReadOnly = proxyView.writable === false && proxyView.phase === 'ready'

      var proxyBlock = React.createElement('div', { style: S.infoBox },
        React.createElement('div', { style: S.infoHead },
          React.createElement('p', { style: S.infoLabel }, 'Local Proxy (Optional)'),
          proxyConfigured
            ? React.createElement('button', { type: 'button', style: S.smallButton, onClick: onProxyClear, disabled: isReadOnly }, 'Clear')
            : null),
        React.createElement('p', { style: S.note }, 'When proxy software only listens on a local port without enabling the system proxy, auto-detection cannot find it — enter its address here (e.g. http://127.0.0.1:7897). Supports http:// and https:// (scheme may be omitted).'),
        React.createElement('div', { style: S.row },
          React.createElement('input', {
            style: S.input,
            type: 'text',
            placeholder: 'http://127.0.0.1:7897',
            value: proxyInput,
            onChange: onProxyInput,
            autoComplete: 'off',
            spellCheck: false,
            disabled: isReadOnly,
          }),
          React.createElement('button', {
            type: 'button',
            style: S.button,
            onClick: onProxySave,
            disabled: isReadOnly,
          }, 'Save')),
        proxyStatus !== '' ? React.createElement('p', { style: proxyStatusStyle }, proxyStatus) : null,
        React.createElement('p', { style: S.note }, proxyShown),
        isReadOnly
          ? React.createElement('p', { style: S.note }, 'Current environment is read-only (settings document is not writable); configure via JINA_PROXY_URL environment variable instead.')
          : null)

      // Tool Options & Extraction Behavior Block
      var toolsStatusStyle = toolsStatusKind === 'ok' ? S.statusOk : toolsStatusKind === 'bad' ? S.statusBad : S.status
      var toolsOptionsBlock = React.createElement('div', { style: S.infoBox },
        React.createElement('div', { style: S.infoHead },
          React.createElement('p', { style: S.infoLabel }, 'Tool Defaults & Extraction Behavior'),
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('button', {
              type: 'button',
              style: S.ghostButton,
              onClick: onResetTools,
              disabled: isReadOnly,
            }, 'Reset'),
            React.createElement('button', {
              type: 'button',
              style: S.button,
              onClick: onSaveTools,
              disabled: isReadOnly,
            }, 'Save Options'))),
        React.createElement('p', { style: S.note }, 'Configure default behavior for jina_web_search, jina_read, jina_extract, and jina_chunk. Parameters specified directly by an agent in a tool call take precedence over these defaults.'),

        // Preset Quick-Switcher Bar
        React.createElement('div', { style: Object.assign({}, S.fieldGroup, { background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.1))', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25))' }) },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 } },
            React.createElement('label', { style: Object.assign({}, S.fieldLabel, { fontSize: 13 }) }, '⚡ High-Leverage Extraction Preset:'),
            React.createElement('select', {
              style: Object.assign({}, S.formSelect, { width: 'auto', minWidth: 260, height: 32 }),
              value: activePresetInput,
              onChange: function (e) { applyPreset(e.target.value) },
              disabled: isReadOnly,
            },
              React.createElement('option', { value: 'balanced' }, 'Balanced (Default: Coding, Docs & High Signal)'),
              React.createElement('option', { value: 'research' }, 'Deep Academic Research (High Tokens & Vision)'),
              React.createElement('option', { value: 'clean-read' }, 'Strict Clean Read (Aggressive Noise Stripping)'),
              React.createElement('option', { value: 'fast-index' }, 'Fast Indexing (Token Efficient)'),
              React.createElement('option', { value: 'spa-resilient' }, 'SPA & Dynamic JS (Wait for DOM hydration)'))),
          React.createElement('p', { style: S.fieldHint }, 'Selecting a preset pre-configures CSS target/remove selectors, token caps, and wait timers optimized for specific tasks.')),

        // Section 1: Search Defaults
        React.createElement('div', { style: S.grid },
          React.createElement('div', { style: S.fieldGroup },
            React.createElement('label', { style: S.fieldLabel }, 'Search Result Count'),
            React.createElement('input', {
              style: S.formInput,
              type: 'number',
              min: 1,
              max: 20,
              value: searchNumInput,
              onChange: function (e) {
                toolsDirty.current = true
                setSearchNumInput(e.target.value)
              },
              disabled: isReadOnly,
            }),
            React.createElement('p', { style: S.fieldHint }, 'Default result count for jina_web_search (1–20, default: 5).')),
          React.createElement('div', { style: S.fieldGroup },
            React.createElement('label', { style: S.fieldLabel }, 'Default Search / Crawl Engine'),
            React.createElement('select', {
              style: S.formSelect,
              value: engineInput,
              onChange: function (e) {
                toolsDirty.current = true
                setEngineInput(e.target.value)
              },
              disabled: isReadOnly,
            },
              React.createElement('option', { value: 'auto' }, 'Auto / Default (Fastest)'),
              React.createElement('option', { value: 'google' }, 'Google (Comprehensive)'),
              React.createElement('option', { value: 'bing' }, 'Bing'),
              React.createElement('option', { value: 'reader' }, 'Reader Direct (r.jina.ai)'),
              React.createElement('option', { value: 'cf-browser-rendering' }, 'Cloudflare Anti-Bot Bypass')),
            React.createElement('p', { style: S.fieldHint }, 'cf-browser-rendering bypasses Cloudflare turnstile and bot protections.'))),

        // Section 2: Reader & Extraction Defaults
        React.createElement('div', { style: S.grid },
          React.createElement('div', { style: S.fieldGroup },
            React.createElement('label', { style: S.fieldLabel }, 'Token Budget Cap'),
            React.createElement('input', {
              style: S.formInput,
              type: 'number',
              placeholder: 'e.g. 8000 (empty = uncapped)',
              value: tokenBudgetInput,
              onChange: function (e) {
                toolsDirty.current = true
                setTokenBudgetInput(e.target.value)
              },
              disabled: isReadOnly,
            }),
            React.createElement('p', { style: S.fieldHint }, 'Hard token limit on extracted markdown to prevent context bloat.')),
          React.createElement('div', { style: S.fieldGroup },
            React.createElement('label', { style: S.fieldLabel }, 'Retain Images Policy'),
            React.createElement('select', {
              style: S.formSelect,
              value: retainImagesInput,
              onChange: function (e) {
                toolsDirty.current = true
                setRetainImagesInput(e.target.value)
              },
              disabled: isReadOnly,
            },
              React.createElement('option', { value: 'none' }, 'None (Fast, Text Only)'),
              React.createElement('option', { value: 'all' }, 'All (Include Image Links)'),
              React.createElement('option', { value: 'alt' }, 'Alt Text Only (Compact)')),
            React.createElement('p', { style: S.fieldHint }, 'Controls how raster images are represented in extracted markdown.'))),

        // Section 3: DOM Selectors & SPA Scraping
        React.createElement('div', { style: S.grid },
          React.createElement('div', { style: S.fieldGroup },
            React.createElement('label', { style: S.fieldLabel }, 'Default Target CSS Selector'),
            React.createElement('input', {
              style: S.formInput,
              type: 'text',
              placeholder: 'e.g. article, .markdown-body, main',
              value: targetSelectorInput,
              onChange: function (e) {
                toolsDirty.current = true
                setTargetSelectorInput(e.target.value)
              },
              disabled: isReadOnly,
            }),
            React.createElement('p', { style: S.fieldHint }, 'CSS selector to isolate the main content and eliminate boilerplate.')),
          React.createElement('div', { style: S.fieldGroup },
            React.createElement('label', { style: S.fieldLabel }, 'Default Wait-For Selector (SPA)'),
            React.createElement('input', {
              style: S.formInput,
              type: 'text',
              placeholder: 'e.g. div#app, main, .content',
              value: waitForSelectorInput,
              onChange: function (e) {
                toolsDirty.current = true
                setWaitForSelectorInput(e.target.value)
              },
              disabled: isReadOnly,
            }),
            React.createElement('p', { style: S.fieldHint }, 'Pauses extraction until dynamic client-side JS renders this selector.')),
          React.createElement('div', { style: S.fieldGroup },
            React.createElement('label', { style: S.fieldLabel }, 'Default Remove Selector'),
            React.createElement('input', {
              style: S.formInput,
              type: 'text',
              placeholder: 'e.g. .cookie-banner, nav, footer, .ad',
              value: removeSelectorInput,
              onChange: function (e) {
                toolsDirty.current = true
                setRemoveSelectorInput(e.target.value)
              },
              disabled: isReadOnly,
            }),
            React.createElement('p', { style: S.fieldHint }, 'CSS elements to strip out prior to markdown conversion.'))),

        // Section 4: Automations & Cache Toggle
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 } },
          React.createElement('label', { style: Object.assign({}, S.note, { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }) },
            React.createElement('input', {
              type: 'checkbox',
              checked: autoBypassCfInput,
              onChange: function (e) {
                toolsDirty.current = true
                setAutoBypassCfInput(e.target.checked)
              },
              disabled: isReadOnly,
            }),
            'Automated Cloudflare Turnstile Bypass (auto-retries with browser rendering on 403 / captcha challenge)'),
          React.createElement('label', { style: Object.assign({}, S.note, { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }) },
            React.createElement('input', {
              type: 'checkbox',
              checked: autoRemoveOverlayInput,
              onChange: function (e) {
                toolsDirty.current = true
                setAutoRemoveOverlayInput(e.target.checked)
              },
              disabled: isReadOnly,
            }),
            'Remove Modal & Paywall Overlays (X-Remove-Overlay: strips cookie walls, popups, and paywall backdrops)'),
          React.createElement('label', { style: Object.assign({}, S.note, { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }) },
            React.createElement('input', {
              type: 'checkbox',
              checked: autoDetachInvisiblesInput,
              onChange: function (e) {
                toolsDirty.current = true
                setAutoDetachInvisiblesInput(e.target.checked)
              },
              disabled: isReadOnly,
            }),
            'Detach Invisible Honeypots & Decoys (X-Detach-Invisibles: purges hidden tracking spans and scraper traps)'),
          React.createElement('label', { style: Object.assign({}, S.note, { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }) },
            React.createElement('input', {
              type: 'checkbox',
              checked: autoShadowDomInput,
              onChange: function (e) {
                toolsDirty.current = true
                setAutoShadowDomInput(e.target.checked)
              },
              disabled: isReadOnly,
            }),
            'Traverse Shadow DOM (X-With-Shadow-Dom: penetrates Web Components and client-side custom elements)'),
          React.createElement('label', { style: Object.assign({}, S.note, { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }) },
            React.createElement('input', {
              type: 'checkbox',
              checked: autoIframeInput,
              onChange: function (e) {
                toolsDirty.current = true
                setAutoIframeInput(e.target.checked)
              },
              disabled: isReadOnly,
            }),
            'Inline Embedded Iframes (X-With-Iframe: extracts content inside embedded frame documents)'),
          React.createElement('label', { style: Object.assign({}, S.note, { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }) },
            React.createElement('input', {
              type: 'checkbox',
              checked: noCacheInput,
              onChange: function (e) {
                toolsDirty.current = true
                setNoCacheInput(e.target.checked)
              },
              disabled: isReadOnly,
            }),
            'Force fresh crawl by default (bypass Jina CDN cache)')),
        toolsStatus !== '' ? React.createElement('p', { style: toolsStatusStyle }, toolsStatus) : null)

      // Key health block
      var primerLines
      if (primer.phase === 'loading') {
        primerLines = [React.createElement('p', { key: 'p', style: S.status }, 'Connecting to Jina to verify key…')]
      } else if (primer.phase === 'error') {
        primerLines = [
          React.createElement('p', { key: 'e', style: S.statusBad }, '❌ Unable to connect to Jina: ' + String(primer.error)),
          React.createElement('p', { key: 'h', style: S.note }, 'Verify that the local proxy is running and matches the configured address/port (if empty, verify VPN/system proxy is enabled or environment variables are set), then click "Refresh" on the right to retry.'),
        ]
      } else {
        var d = primer.data || {}
        var balance = typeof d.balanceLeft === 'number' ? d.balanceLeft.toLocaleString('en-US') + ' credits' : 'Unknown'
        var kindLabel = d.hasKey
          ? d.keyKind === 'credential' ? 'API key saved on this page' : 'Key file (jina-api-key.txt)'
          : 'No key detected (Jina anonymous free tier)'
        primerLines = [
          React.createElement('p', { key: 's', style: S.statusOk }, '✅ Connected successfully, key is valid'),
          d.authenticatedAs ? React.createElement('p', { key: 'i', style: S.note }, 'Identity: ' + d.authenticatedAs) : null,
          React.createElement('p', { key: 'b', style: S.note }, 'Balance: ' + balance),
          React.createElement('p', { key: 'k', style: S.note }, 'Active Source: ' + kindLabel),
        ].filter(Boolean)
      }

      var probe = (primer.data && primer.data.proxy) || {}
      var probeLabel = probe.source
        ? probe.url
          ? probe.url + ' (source: ' + String(PROXY_SOURCES[probe.source] || probe.source || 'Unknown') + ')'
          : String(PROXY_SOURCES[probe.source] || probe.source)
        : 'None (direct connection)'

      var probeLines = [React.createElement('p', { key: 'pr', style: S.note }, 'Proxy used for this probe: ' + probeLabel)]
      if (probe.rejected && probe.rejected.length > 0) {
        var rejectReason = PROXY_REJECTS[probe.rejected[0].reason] || probe.rejected[0].reason
        probeLines.push(React.createElement('p', { key: 'rj', style: S.statusBad }, '⚠️ Saved proxy "' + probe.rejected[0].value + '" is unusable (' + rejectReason + '); fell back to auto-detection.'))
      }

      var primerBlock = React.createElement('div', { style: S.infoBox },
        React.createElement('div', { style: S.infoHead },
          React.createElement('p', { style: S.infoLabel }, 'API Key / Connection Check'),
          React.createElement('button', {
            type: 'button',
            style: S.smallButton,
            onClick: loadPrimer,
            disabled: primer.phase === 'loading',
          }, 'Refresh')),
        primerLines,
        probeLines)

      var rootTag = isPage ? 'div' : 'li'
      return React.createElement(rootTag, { style: Object.assign({}, S.card, isPage ? { margin: '8px 0' } : null) },
        React.createElement('button', {
          type: 'button',
          style: S.header,
          'aria-expanded': open,
          onClick: function () { setOpen(!open) },
        },
          React.createElement('div', { style: S.headText },
            React.createElement('p', { style: S.name }, 'Jina Tools'),
            React.createElement('span', { style: S.description }, 'API key, local proxy, scraping presets, and anti-bot configuration for Jina AI tools.')),
          React.createElement(Chevron, { open: open })),
        open
          ? React.createElement('div', { style: S.body },
            React.createElement('p', { style: S.note }, 'Tools like jina_web_search and jina_read prioritize the key saved here. Free keys can be obtained at ', React.createElement('a', { style: S.link, href: 'https://jina.ai/?sui=apikey', target: '_blank', rel: 'noreferrer' }, 'jina.ai'), ' to get a key.'),
            React.createElement('div', { style: S.row },
              React.createElement('input', {
                style: S.input,
                type: 'password',
                placeholder: 'Paste API key…',
                value: input,
                onChange: onInput,
                autoComplete: 'off',
                spellCheck: false,
                disabled: !writable,
              }),
              React.createElement('button', {
                type: 'button',
                style: S.button,
                onClick: onSave,
                disabled: !writable,
              }, 'Save'),
              configured
                ? React.createElement('button', { type: 'button', style: S.ghostButton, onClick: onClear, disabled: !writable }, 'Clear')
                : null),
            status !== '' ? React.createElement('p', { style: statusStyle }, status) : null,
            React.createElement('p', { style: S.note }, shown),
            toolsOptionsBlock,
            proxyBlock,
            primerBlock,
            view !== undefined && !writable ? React.createElement('p', { style: S.note }, 'Current environment is read-only: key is provided via environment variables or file; cannot be modified here.') : null,
            React.createElement('p', { style: S.note }, 'Key resolution order: 1. Tool argument apiKey; 2. Key saved on this page (credential reference ' + CRED + ', persisted in dsh credential store); 3. jina-api-key.txt in session workspace; 4. jina-api-key.txt in dsh home directory. Takes effect immediately after saving.'),
            React.createElement('p', { style: S.note }, 'Proxy precedence: 1. Address saved in "Local Proxy" on this page; 2. JINA_PROXY_URL environment variable; 3. Windows system proxy (auto-discovered, self-heals across port changes); 4. Inherited startup environment HTTP_PROXY / HTTPS_PROXY. Only http(s) proxies can be used by the network helper. If local proxy software only listens on a port without enabling system proxy, enter it in "Local Proxy" above.'))
          : null)
    }

    exports.name = '@martinm86867-ops/dsh-jina'
    exports.inject = ['slots', 'remote', 'remote.credentials', 'remote.settings']

    exports.apply = function (ctx) {
      var slots = ctx.slots

      function getApi() {
        var conn = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
        return conn && conn.api ? conn.api : undefined
      }

      function getCredentials() {
        try {
          if (ctx && typeof ctx.get === 'function') {
            var rc = ctx.get('remote.credentials')
            if (rc && typeof rc.describe === 'function') return rc
          }
        } catch (e) {}
        var r = typeof ctx.get === 'function' ? ctx.get('remote') : undefined
        try {
          if (r && r.credentials && typeof r.credentials.describe === 'function') return r.credentials
        } catch (e) {}
        var api = getApi()
        if (api && api.credentials) {
          return {
            describe: function (refs) {
              return api.credentials.describe({ refs: Array.isArray(refs) ? refs : [refs] }).then(function (res) {
                if (res && res.result && res.result.ok) {
                  return { ok: true, value: res.result.value.credentials }
                }
                return { ok: false, error: res && res.result && res.result.error }
              })
            },
            set: function (ref, value) {
              return api.credentials.set({ ref: ref, value: value }).then(function (res) {
                return { ok: Boolean(res && res.result && res.result.ok) }
              })
            },
            unset: function (ref) {
              return api.credentials.unset({ ref: ref }).then(function (res) {
                return { ok: Boolean(res && res.result && res.result.ok) }
              })
            },
          }
        }
        return undefined
      }

      function getSettings() {
        try {
          if (ctx && typeof ctx.get === 'function') {
            var rs = ctx.get('remote.settings')
            if (rs && typeof rs.describe === 'function') return rs
          }
        } catch (e) {}
        var r = typeof ctx.get === 'function' ? ctx.get('remote') : undefined
        try {
          if (r && r.settings && typeof r.settings.describe === 'function') return r.settings
        } catch (e) {}
        var api = getApi()
        if (api && api.settings) {
          return {
            describe: function () {
              return api.settings.describe({}).then(function (res) {
                if (res && res.result && res.result.ok) {
                  return { ok: true, value: res.result.value }
                }
                return { ok: false, error: res && res.result && res.result.error }
              })
            },
            mutate: function (requestOrNs, ops, expectedRevision) {
              var payload = typeof requestOrNs === 'string'
                ? { ns: requestOrNs, ops: ops }
                : requestOrNs
              return api.settings.mutate(payload).then(function (res) {
                if (res && res.result && res.result.ok) {
                  return { ok: true, value: res.result.value }
                }
                return { ok: false, error: res && res.result && res.result.error }
              })
            },
          }
        }
        return undefined
      }

      function renderCard(slotProps) {
        if (slotProps && slotProps.view === 'summary') {
          return 'API key, local proxy, scraping presets, and anti-bot configuration for Jina AI tools.'
        }
        return React.createElement(JinaCard, {
          ctx: ctx,
          remote: typeof ctx.get === 'function' ? ctx.get('remote') : undefined,
          getCredentials: getCredentials,
          getSettings: getSettings,
          view: slotProps ? slotProps.view : 'page',
          standalone: true,
        })
      }

      // 1. Bundle-level configuration for the new Plugins page (keys: '@martinm86867-ops/dsh-jina' and 'dsh-jina')
      ctx.slots.inject('plugins.bundle.config', function () {
        slots.register({ name: 'plugins.bundle.config', key: '@martinm86867-ops/dsh-jina' }, renderCard)
        return slots.register({ name: 'plugins.bundle.config', key: 'dsh-jina' }, renderCard)
      })

      // 2. Row-level configuration for the jina-tools row (keys: '@martinm86867-ops/dsh-jina#jina-tools' and 'dsh-jina#jina-tools')
      ctx.slots.inject('plugins.row.config', function () {
        slots.register({ name: 'plugins.row.config', key: '@martinm86867-ops/dsh-jina#jina-tools' }, renderCard)
        return slots.register({ name: 'plugins.row.config', key: 'dsh-jina#jina-tools' }, renderCard)
      })

      // 3. Legacy Settings section slot (key: 'jina-tools') for earlier dsh versions
      ctx.slots.inject('settings.plugin.item', function () {
        return slots.register(
          { name: 'settings.plugin.item', key: 'jina-tools' },
          function (slotProps) {
            return React.createElement(JinaCard, {
              ctx: ctx,
              remote: typeof ctx.get === 'function' ? ctx.get('remote') : undefined,
              getCredentials: getCredentials,
              getSettings: getSettings,
              view: slotProps ? slotProps.view : undefined,
            })
          },
        )
      })
    }

    return exports
}

if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
  window.__ModuleLoader__.load({
    id: '@martinm86867-ops/dsh-jina',
    factory: jinaClientFactory,
  })

  try {
    window.__ModuleLoader__.load({
      id: 'dsh-jina',
      factory: jinaClientFactory,
    })
  } catch (e) {}
}

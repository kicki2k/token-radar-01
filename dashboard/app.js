// Token Launch Radar — the dashboard page.
//
// Reads window.RADAR from data.js (written beside dashboard/ by main.ts)
// and renders the ranked pre-token board, a live-token view kept apart
// from the ranking, a model panel whose two weights can be moved in a
// sandbox, and a detail drawer per protocol with the model's workings
// and the protocol's farm plan. No fetch, no network: every number on
// the page is recomputed here from the same figures board.json carries.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var state = {
    q: '', category: 'all', chain: 'all', watchOnly: false,
    tab: 'board', sort: 'implied', dir: -1, selected: null,
    gw: M.growth_weight, ms: M.maturity_span
  };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 60) return Math.round(days / 30.4) + 'mo';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // The model, recomputed in the page: peer multiple from the live
  // market, momentum from 7-day TVL change, maturity from age with no
  // token on record, breadth from chain count. With the sandbox weights
  // at their defaults this returns exactly the board's implied value.
  function ageFactor(row) {
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    return age / (age + M.maturity_half_days);
  }
  function impliedOf(row, gw, ms) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, M.growth_floor_pct, M.growth_cap_pct);
    var momentum = 1 + (growth / 100) * gw;
    var maturity = M.maturity_base + ms * ageFactor(row);
    var extra = clamp((row.chains ? row.chains.length : 1) - 1, 0, M.breadth_max_extra_chains);
    var breadth = 1 + M.breadth_per_chain * extra;
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * momentum * maturity * breadth));
  }
  function sandboxActive() { return state.gw !== M.growth_weight || state.ms !== M.maturity_span; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'peer') { av = a.peer_multiple; bv = b.peer_multiple; }
      else { av = impliedOf(a, state.gw, state.ms); bv = impliedOf(b, state.gw, state.ms); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'ring', 'aria-hidden': 'true' }),
        el('div', null,
          el('div', { class: 'brand-name', text: 'Token Launch Radar' }),
          el('div', { class: 'brand-sub', text: 'peer-calibrated · model ' + DATA.model_version })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', null, 'Watchlist floor ', el('b', { text: fmtUsd(DATA.floor_usd) }))
      )
    );
  }

  function medianImplied() {
    var vals = DATA.rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    return vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  }

  function lede() {
    var kpis = el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('b', null, String(DATA.watchlist_size), el('em', { text: ' / ' + DATA.watchlist_size })), el('span', { text: 'watchlist protocols covered' })),
      el('div', { class: 'kpi' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'pre-token protocols ranked' })),
      el('div', { class: 'kpi' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'early finds beyond the watchlist' })),
      el('div', { class: 'kpi' }, el('b', { text: fmtUsd(medianImplied()) }), el('span', { text: 'median implied launch value' }))
    );
    return el('section', { class: 'lede' },
      el('div', null,
        el('div', { class: 'kicker', text: 'Which pre-token protocol is worth farming next?' }),
        el('h1', { text: 'Every protocol that records no token, ranked by what its launch would be worth' }),
        el('p', { class: 'body', text: '' },
          'The watchlist is the floor: all ' + DATA.watchlist_size + ' protocols above ' + fmtUsd(DATA.floor_usd) + ' of TVL with no token on record are here, and the radar adds ',
          el('b', { text: DATA.early_size + ' early finds' }),
          ' the list leaves out. Each implied value is calibrated from the ' + DATA.live_total + ' protocols whose tokens already trade — the market\'s own price per dollar of TVL, per category — then adjusted for momentum, maturity and reach. A protocol "records no token" on DefiLlama\'s index; that is a record, not a proof, and an implied value is this model\'s claim, not a price.'
        )
      ),
      kpis
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', 'aria-label': 'Watchlist only' });
    if (state.watchOnly) watchBox.setAttribute('checked', 'checked');
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; writeHash(); render(); });
    var boardTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'board'; render(); } });
    var liveTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens (set aside)', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Scope' }), el('label', { class: 'check' }, watchBox, 'Watchlist only')),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }), el('div', { class: 'tabs' }, boardTab, liveTab)),
      el('span', { class: 'count', text: state.tab === 'board' ? visibleRows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live protocols shown' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        render();
      } }, label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null)
    );
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the category, chain and scope filters to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render();
        } })
      ));
    }
    var values = list.map(function (r) { return impliedOf(r, state.gw, state.ms); });
    var max = Math.max.apply(null, values.concat([1]));
    var tbody = el('tbody');
    list.forEach(function (r, i) {
      var value = values[i];
      var growthCls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'chain unlisted') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthCls, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.peer_multiple.toFixed(2) + 'x' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((value / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(value) })
        )),
        el('td', null, r.on_watchlist
          ? el('span', { class: 'tag watch', text: 'watchlist' })
          : el('span', { class: 'tag early', text: 'early find' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: sandboxActive()
            ? 'Sandbox ranking: implied values recomputed with your weights. Select a row for its model and farm plan.'
            : 'Pre-token protocols by implied launch value. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('peer', 'Peer x'),
            sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'Radar' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'chain unlisted') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl === null ? 'n/a' : r.mcap_tvl.toFixed(2) + 'x' }),
        el('td', null, el('span', { class: 'tag live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Set aside, not ranked: these protocols already trade, so their market cap is a fact. Their category medians are what calibrate the pre-token board.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'MCap / TVL' }), el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function sliderRow(label, min, max, step, value, apply) {
    var out = el('output', { text: value.toFixed(2) });
    var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    input.addEventListener('input', function () { out.textContent = Number(input.value).toFixed(2); });
    input.addEventListener('change', function () { apply(Number(input.value)); render(); });
    return el('div', { class: 'slider' }, el('span', { text: label }), input, out);
  }

  function modelPanel() {
    var note = sandboxActive()
      ? el('p', { class: 'sandbox-note', text: 'Sandbox weights differ from the board model — the table above is re-ranked with them. Reset both to ' + M.growth_weight.toFixed(2) + ' / ' + M.maturity_span.toFixed(2) + ' to return to the published board.' })
      : el('p', { class: 'sub', text: 'Move a weight to re-rank the board with your own assumptions. The published board uses growth weight ' + M.growth_weight.toFixed(2) + ' and maturity span ' + M.maturity_span.toFixed(2) + '.' });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the implied value is calibrated' }),
      el('p', { class: 'sub', text: 'No protocol name is scored by hand. The peer multiple is the median market-cap / TVL of the live protocols in the same category (sample of at least ' + M.peer_min_sample + ', blended ' + Math.round(M.peer_blend_category * 100) + '% toward the global median of ' + DATA.global_multiple.toFixed(2) + 'x), so the pre-token board is priced by the market that already exists.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl ', el('span', { class: 'v', text: '× peer_multiple' }), ' × (1 + clamp(7d growth, ' + M.growth_floor_pct + ', ' + M.growth_cap_pct + ') / 100 × ', el('span', { class: 'v', text: 'growth_weight' }), ') × (' + M.maturity_base + ' + ', el('span', { class: 'v', text: 'maturity_span' }), ' × age / (age + ' + M.maturity_half_days + 'd)) × (1 + 0.03 × extra chains, max 5) )'
      ),
      el('div', { class: 'sliders' },
        sliderRow('Growth weight', 0, 1, 0.05, state.gw, function (v) { state.gw = v; }),
        sliderRow('Maturity span', 0, 1, 0.05, state.ms, function (v) { state.ms = v; })
      ),
      note
    );
  }

  function peersPanel() {
    var top = DATA.categories.slice(0, 10);
    var max = Math.max.apply(null, top.map(function (c) { return c.multiple; }).concat([0.01]));
    var body = el('div', null, top.map(function (c) {
      return el('div', { class: 'peer-row' },
        el('span', { text: c.category }),
        el('span', { class: 'peer-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round((c.multiple / max) * 100)) + '%' })),
        el('span', { class: 'num', text: c.multiple.toFixed(2) + 'x' }),
        el('span', { class: 'sub num', text: 'n=' + c.live_sample })
      );
    }));
    return el('section', { class: 'panel peers' },
      el('h2', { text: 'Peer multiples by category' }),
      el('p', { class: 'sub', text: 'Median market value per $1 of TVL among live-token protocols in the snapshot, blended toward the global median. Thin categories borrow the global figure.' }),
      body
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function multRow(label, value, share) {
    return el('div', null,
      el('div', null, el('span', { text: label }), el('b', { class: 'num', text: value })),
      el('div', { class: 'mbar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.min(100, Math.round(share * 100))) + '%' }))
    );
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var boardValue = row.implied_value_usd;
    var recomputed = impliedOf(row, M.growth_weight, M.maturity_span);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · watchlist' : ' · early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'chain unlisted') })
      ),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var eq = el('div', { class: 'equation' });
    eq.appendChild(el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })));
    eq.appendChild(multRow('Peer multiple (' + (row.category || 'Uncategorised') + ', ' + (row.peer_sample > 0 ? 'median of ' + row.peer_sample + ' live peers' : 'global median, no live peers in category') + ')', row.peer_multiple.toFixed(2) + 'x', row.peer_multiple / 2));
    eq.appendChild(multRow('Momentum × (7d ' + fmtPct(row.change_7d) + ')', row.momentum_multiplier.toFixed(3) + 'x', row.momentum_multiplier / 2));
    eq.appendChild(multRow('Maturity × (age ' + fmtAge(row.age_days) + ', no token on record)', row.maturity_multiplier.toFixed(3) + 'x', row.maturity_multiplier / 1.4));
    eq.appendChild(multRow('Breadth × (' + (row.chains ? row.chains.length : 0) + ' chains)', row.breadth_multiplier.toFixed(3) + 'x', row.breadth_multiplier / 1.2));
    eq.appendChild(el('div', { class: 'total' }, el('span', { text: 'Implied launch value' }), el('b', { class: 'num', text: fmtUsd(boardValue) })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — model ' + DATA.model_version }),
      eq,
      el('p', { class: 'sub', text: 'This page recomputes the row as ' + fmtUsd(recomputed) + (recomputed === boardValue ? ' — the same figure board.json carries.' : ' — which differs from the board, so the data would be stale.') + ' An estimate from the snapshot record, not a price and not a launch prediction.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — ' + row.farm_steps.length + ' steps' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    if (state.tab === 'board') {
      var grid = el('div', { class: 'grid2' });
      grid.appendChild(modelPanel());
      grid.appendChild(peersPanel());
      shell.appendChild(grid);
    }
    shell.appendChild(el('p', { class: 'foot', text: 'Method and limits: implied values follow only from the snapshot\'s own figures — TVL, seven-day change, listing age and chain count — calibrated against live-token peers in the same snapshot. The snapshot records no token for the ranked protocols; a record can lag reality, and nothing here predicts that a token will be issued. Farm plans are activity plans with estimated costs, not financial advice.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();

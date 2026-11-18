// Token Launch Radar — the valuation and farming model.
//
// One sealed DefiLlama snapshot goes in; one ranked board of pre-token
// protocols comes out. The board always covers the snapshot's watchlist
// (that list is a floor, never a ceiling) and adds every other rankable
// pre-token protocol the snapshot carries, so the radar also surfaces
// candidates below the watchlist's $50M floor and candidates the
// watchlist rule set aside.
//
// The implied value is calibrated from the snapshot itself, not from a
// table of constants and never from a list of names:
//
//   1. Peer multiple. Protocols whose token already trades reveal what
//      the market pays per dollar of TVL. For each category we take the
//      median market-cap / TVL ratio of its live protocols (at least
//      PEER_MIN_SAMPLE of them, otherwise the category borrows the
//      global median) and blend it toward the global median, so a thin
//      or wild category cannot dominate a ranking on its own.
//   2. Momentum. The seven-day TVL change, clamped, scales the peer
//      value up or down: a protocol gathering TVL into a launch is
//      worth more than the same TVL standing still.
//   3. Maturity. Age enters as age / (age + 365 days): the longer a
//      protocol has run with no token on record, the more of its value
//      the model credits, with diminishing returns and no hard cliff.
//   4. Breadth. Each extra chain beyond the first adds a small bonus,
//      capped: distribution is worth something, not everything.
//
//   implied = round( tvl_usd * peer_multiple * momentum * maturity * breadth )
//
// Live-token protocols never enter the ranking. They are reported
// separately, with the market's own numbers, because a market cap that
// exists is a fact and a modelled one is a claim; mixing the two would
// make the board unreadable. Every function below is pure arithmetic on
// the snapshot's ten fields, so two runs over the same bytes agree byte
// for byte.

/** One protocol exactly as the sealed snapshot carries it. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document: header fields plus the protocol universe. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Tunable constants of the model, published to the dashboard as-is. */
export interface ModelConstants {
  peer_min_sample: number;
  peer_blend_category: number;
  peer_floor: number;
  peer_cap: number;
  global_floor: number;
  global_cap: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  growth_weight: number;
  maturity_base: number;
  maturity_span: number;
  maturity_half_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
}

export const MODEL: ModelConstants = {
  peer_min_sample: 4,
  peer_blend_category: 0.65,
  peer_floor: 0.08,
  peer_cap: 5,
  global_floor: 0.1,
  global_cap: 4,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  growth_weight: 0.55,
  maturity_base: 0.7,
  maturity_span: 0.6,
  maturity_half_days: 365,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 5,
};

/** Version tag the dashboard prints next to the formula. */
export const MODEL_VERSION = 'radar-2-peer';

/** Live-token protocols shown in the dashboard's separate live view. */
export const LIVE_ROWS = 24;

/** One farm step before it is flattened to a board string. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A ranked board row: the gate's five fields plus the model's workings. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_sample: number;
    growth_pct: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** A board row in the compact shape the dashboard renders. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  peer_multiple: number;
  peer_sample: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol, kept apart from the ranking on purpose. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** One category's calibrated peer multiple, for the dashboard table. */
export interface CategoryMultiple {
  category: string;
  live_sample: number;
  multiple: number;
}

/** Everything the dashboard needs, computed once in buildRadar. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  pre_token_total: number;
  live_total: number;
  categories: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Raised when the snapshot is not the shape this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Whole days between the listing day and the snapshot day; null if unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** The median of a non-empty list, computed on a sorted copy. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A protocol records a live token when any token field is present. */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** A protocol is pre-token when its record carries no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return !hasToken(p);
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_NAME = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Categories that are never a launch candidate of their own: exchanges,
 * bridges and staking wrappers are conduits or receipts for a token
 * that already trades (WBTC and USDT0 live here), exactly as the
 * watchlist rule treats them.
 */
const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/**
 * Whether a pre-token protocol belongs on the radar: not an exchange,
 * not a bridge or staking product of a token that already trades, not
 * a versioned pool of another protocol, and not a wrapped or staked
 * product wearing another token's value. The same exclusions the
 * watchlist rule uses, applied to the whole snapshot.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_NAME.test(p.name)) return false;
  if (EXCHANGE_NAME.test(p.name)) return false;
  return true;
}

/** The calibrated peer multiples: one global figure plus per-category blends. */
export interface PeerCalibration {
  global: number;
  byCategory: Map<string, { multiple: number; sample: number }>;
}

/**
 * Derive the peer multiples from the snapshot's live protocols. Only
 * protocols with both a market cap and a positive TVL reveal a ratio;
 * ratios are clamped before the median so one mispriced micro-cap
 * cannot pull a whole category with it.
 */
export function calibratePeers(snapshot: Snapshot, model: ModelConstants = MODEL): PeerCalibration {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, model.peer_floor, model.peer_cap);
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = all.length === 0 ? 1 : clamp(median(all), model.global_floor, model.global_cap);
  const byCategory = new Map<string, { multiple: number; sample: number }>();
  for (const [category, ratios] of ratiosByCategory) {
    if (ratios.length < model.peer_min_sample) {
      byCategory.set(category, { multiple: global, sample: ratios.length });
    } else {
      const own = clamp(median(ratios), model.peer_floor, model.peer_cap);
      const blended = model.peer_blend_category * own + (1 - model.peer_blend_category) * global;
      byCategory.set(category, { multiple: blended, sample: ratios.length });
    }
  }
  return { global, byCategory };
}

/** The four multipliers and the implied value for one protocol. */
export interface Scored {
  implied: number;
  peerMultiple: number;
  peerSample: number;
  growthPct: number;
  momentum: number;
  maturity: number;
  breadth: number;
  age: number | null;
}

export function scoreProtocol(p: SnapshotProtocol, asOf: string, peers: PeerCalibration, model: ModelConstants = MODEL): Scored {
  const peer = peers.byCategory.get(p.category ?? 'Uncategorised') ?? { multiple: peers.global, sample: 0 };
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = clamp(rawGrowth, model.growth_floor_pct, model.growth_cap_pct);
  const momentum = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturity = model.maturity_base + model.maturity_span * (ageForModel / (ageForModel + model.maturity_half_days));
  const extraChains = clamp(p.chains.length - 1, 0, model.breadth_max_extra_chains);
  const breadth = 1 + model.breadth_per_chain * extraChains;
  const implied = Math.max(1, Math.round(p.tvl_usd * peer.multiple * momentum * maturity * breadth));
  return { implied, peerMultiple: peer.multiple, peerSample: peer.sample, growthPct, momentum, maturity, breadth, age };
}

// ------------------------------------------------------------------ farm plans

/** Flatten one step to its board string, inside the gate's 20..600 window. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check weekly.`;
  return s;
}

function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A realistic per-transaction gas figure for the protocol's first chain. */
function gasUsd(chain: string): number {
  switch (chain) {
    case 'Ethereum': return 14;
    case 'Solana': return 1;
    case 'Base': return 1;
    case 'Arbitrum': return 2;
    case 'Optimism': return 2;
    case 'Polygon': return 1;
    case 'Avalanche': return 3;
    case 'Binance': return 2;
    case 'Bitcoin': return 6;
    default: return 4;
  }
}

/** Working capital for one farm position, scaled to the protocol's size. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 75;
}

/** Weeks to keep a position, from the protocol's age: younger, longer. */
function holdWeeksFor(age: number | null): number {
  if (age === null) return 8;
  if (age < 180) return 10;
  if (age < 365) return 8;
  if (age < 730) return 6;
  return 5;
}

/** The two protocol-specific actions of a plan, chosen by category. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC as collateral in ${name} on ${chain} and leave the position open.`,
      `Borrow about 30% against that collateral, repay it after a week, and repeat once so both sides of the market record your wallet.`,
    ];
  }
  if (c.includes('dex') || c.includes('aggregator')) {
    return [
      `Provide $${capital} of liquidity to the busiest ${name} pool on ${chain}, split evenly across both assets of the pair.`,
      `Route one swap of about $50 through ${name} each week, alternating the direction, so the wallet shows trading activity as well as liquidity.`,
    ];
  }
  if (c.includes('bridge') || c.includes('canonical')) {
    return [
      `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then use the bridged funds inside one app on the destination chain.`,
      `Bridge about a third of the position back two weeks later and bridge in again, so both directions and both chains record the wallet.`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the same wallet.`,
      `Claim or compound the staking rewards once a month and leave the principal untouched, so the holding period reads as one continuous stake.`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small position hedged with an opposite spot holding, so the farm is the activity, not the price bet.`,
      `Close and reopen the hedge once a week at roughly the same size, keeping total fees under about $10 a month.`,
    ];
  }
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) {
    return [
      `Deposit $${capital} into the largest ${name} vault on ${chain} and keep the vault shares in the farming wallet.`,
      `Move about a quarter of the position into a second ${name} vault after the first month, so the wallet holds more than one product surface.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund the farming wallet with $${capital} on ${name} and place one position of about $25 in a liquid, long-dated market.`,
      `Place one further position each week in a different market category, keeping each ticket small enough that no single outcome matters.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of the ${name} yield asset on ${chain} after its onboarding check and hold the asset in the farming wallet.`,
      `Add about $25 a month to the position while it is open, so the balance history shows steady use rather than one deposit.`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`,
      `Provide about $50 of that stable asset to its main liquidity pool, so the wallet both holds and supplies the asset.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy NFT in the farming wallet.`,
      `Renew the cover once before it lapses, so the wallet shows a second policy period rather than a single trial.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} through its main product surface and keep the position open.`,
    `Use a second ${name} surface in the same wallet (a different pool, vault or market) with about $50, so the activity is not a single deposit.`,
  ];
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * duration, all derived from the protocol's own category, chains, TVL
 * and age. Nothing here is written per protocol by hand.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const gas = gasUsd(chain);
  const capital = capitalFor(p);
  const weeks = holdWeeksFor(age);
  const [core, second] = actionsFor(p, capital, chain);
  return [
    {
      text: `Set up one fresh wallet for ${p.name} only, fund it from your main wallet in a single transfer, and store the seed phrase offline.`,
      cost: `about $${gas} of gas to fund and make the first transaction on ${chain}`,
      time: '10 minutes',
    },
    {
      text: core,
      cost: `$${capital} of working capital and about $${gas} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: second,
      cost: `about $${gas * 2} of gas across the two actions`,
      time: '15 minutes',
    },
    {
      text: `Repeat one small qualifying action every week for ${weeks} weeks (a deposit top-up, a swap, a claim or a vote), always from the same wallet.`,
      cost: `about $${gas} of gas a week, roughly $${gas * weeks} over the whole plan`,
      time: `10 minutes a week for ${weeks} weeks`,
    },
    {
      text: `Hold the main position for the full ${weeks} weeks without withdrawing below half of the starting capital, so weekly snapshots keep counting the wallet.`,
      cost: `the $${capital} stays committed for ${weeks} weeks`,
      time: `${weeks} weeks`,
    },
    {
      text: `Once a month, open the protocol's own points, rewards or governance page from the link on its official site and record what the wallet has earned; never follow a claim link from a message or a search ad.`,
      cost: 'nothing to check, and never pay a fee to claim',
      time: '10 minutes a month',
    },
    {
      text: `Keep a farm log with the wallet address, every transaction hash and the dates; when you finish, withdraw in two steps a week apart instead of one full exit.`,
      cost: `about $${gas * 2} of gas to unwind`,
      time: '15 minutes at the end',
    },
  ];
}

// ------------------------------------------------------------------ the board

/** The ranked board: watchlist first as a floor, then every rankable peer. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = calibratePeers(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, peers, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: s.age,
    on_watchlist: watch.has(p.slug),
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.peerMultiple),
      peer_sample: s.peerSample,
      growth_pct: s.growthPct,
      momentum_multiplier: round4(s.momentum),
      maturity_multiplier: round4(s.maturity),
      breadth_multiplier: round4(s.breadth),
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  }));
}

/** Live-token protocols by market cap, with the market's own ratio shown. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => hasToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The board plus everything the dashboard renders, in one pass. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const peers = calibratePeers(snapshot, model);
  const board = buildBoard(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const categories: CategoryMultiple[] = [...peers.byCategory.entries()]
    .map(([category, v]) => ({ category, live_sample: v.sample, multiple: round4(v.multiple) }))
    .sort((a, b) => b.live_sample - a.live_sample || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(peers.global),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    pre_token_total: snapshot.protocols.filter(isPreToken).length,
    live_total: snapshot.protocols.filter(hasToken).length,
    categories,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      on_watchlist: r.on_watchlist,
      implied_value_usd: r.implied_value_usd,
      // The unrounded multiple, so the page recomputes the board's exact
      // figure; board.json carries the rounded display value instead.
      peer_multiple: peers.byCategory.get(r.category ?? 'Uncategorised')?.multiple ?? peers.global,
      peer_sample: peers.byCategory.get(r.category ?? 'Uncategorised')?.sample ?? 0,
      momentum_multiplier: r.model.momentum_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      farm_steps: r.farm_steps,
    })),
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** Parse and shape-check the snapshot text; refuse anything off-shape. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string' || o.source.length === 0) throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no usable floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json watchlist is not a slug list');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks slug, name or tvl_usd`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Null when the board passes the gate's shape, else the first problem. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'board holds a duplicate slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is missing or duplicated`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script assignment: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

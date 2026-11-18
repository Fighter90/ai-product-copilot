import type { UtmStat } from '@pca/shared';
import { intTooltip } from './echart-format';

/** Terminal node of the flow — all campaign→applications links converge here. */
// i18n: ignore — internal node id, renamed via the `labels` argument at the call site
export const SANKEY_TERMINAL = 'Заявки';

/** Label used for sources without UTM («(none)» / empty). */
// i18n: ignore — internal node id, renamed via the `labels` argument at the call site
export const SANKEY_NO_UTM = 'без UTM';

interface SankeyNode {
  readonly name: string;
}

interface SankeyLink {
  readonly source: string;
  readonly target: string;
  readonly value: number;
}

/** Normalise an empty / «(none)» source to the «без UTM» bucket. */
function normalizeSource(source: string): string {
  return source === '' || source === '(none)' ? SANKEY_NO_UTM : source;
}

/**
 * ECharts Sankey option for the «UTM-источник → кампания → заявки» flow.
 *
 * Nodes = distinct sources + distinct campaigns + the terminal «Заявки» node.
 * Links: each (source → campaign) carries Σvisits; each (campaign → «Заявки») carries ΣgoalReaches.
 * Zero-weight links are dropped, node names are de-duplicated, and node labels are kept distinct
 * even when a source and a campaign share a name (prefixed internally) so ECharts doesn't merge them.
 */
export function utmSankeyOption(
  utm: UtmStat[],
  labels?: { terminal: string; noUtm: string },
): object {
  const option = buildUtmSankey(utm);
  if (!labels) return option;
  // Node ids may carry an internal "src:"/"camp:" prefix — keep it, rename only the label part.
  const rename = (n: string): string => {
    const m = /^(src:|camp:)?(.*)$/s.exec(n)!;
    const base =
      m[2] === SANKEY_TERMINAL ? labels.terminal : m[2] === SANKEY_NO_UTM ? labels.noUtm : m[2];
    return (m[1] ?? '') + base;
  };
  // Structural copy that keeps functions (label formatters) intact — unlike a JSON round-trip.
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    }
    if (typeof v === 'string' && (key === 'name' || key === 'source' || key === 'target')) {
      return rename(v);
    }
    return v;
  };
  return walk(option) as object;
}

function buildUtmSankey(utm: UtmStat[]): object {
  const sourceCampaignVisits = new Map<string, number>();
  const campaignReaches = new Map<string, number>();

  for (const u of utm) {
    const source = normalizeSource(u.utmSource);
    const campaign =
      u.utmCampaign === '' || u.utmCampaign === '(none)' ? SANKEY_NO_UTM : u.utmCampaign;

    const scKey = `${source}\u0000${campaign}`;
    sourceCampaignVisits.set(scKey, (sourceCampaignVisits.get(scKey) ?? 0) + u.visits);
    campaignReaches.set(campaign, (campaignReaches.get(campaign) ?? 0) + u.goalReaches);
  }

  // Distinct node names. Source and campaign nodes are namespaced so a value that appears as both
  // (e.g. «vk» source and «vk» campaign) yields two distinct Sankey nodes rather than a self-loop.
  const nodeNames = new Set<string>();
  const links: SankeyLink[] = [];

  for (const [scKey, value] of sourceCampaignVisits) {
    if (value <= 0) continue;
    const [source, campaign] = scKey.split('\u0000');
    const sourceNode = `src:${source as string}`;
    const campaignNode = `camp:${campaign as string}`;
    nodeNames.add(sourceNode);
    nodeNames.add(campaignNode);
    links.push({ source: sourceNode, target: campaignNode, value });
  }

  for (const [campaign, reaches] of campaignReaches) {
    if (reaches <= 0) continue;
    const campaignNode = `camp:${campaign}`;
    nodeNames.add(campaignNode);
    nodeNames.add(SANKEY_TERMINAL);
    links.push({ source: campaignNode, target: SANKEY_TERMINAL, value: reaches });
  }

  const nodes: SankeyNode[] = [...nodeNames].map((name) => ({ name }));

  return {
    tooltip: { trigger: 'item', ...intTooltip },
    series: [
      {
        type: 'sankey',
        emphasis: { focus: 'adjacency' },
        // ANA-197: the bottom node clipped against the card edge — an explicit bottom margin
        // (the ECharts sankey default of 5% was too tight at the card's chart height).
        bottom: 28,
        nodeAlign: 'left',
        // ANA-184 (регресс 15.11): метки перекрывались в плотных кластерах — больше вертикального
        // воздуха между узлами и скрытие пересекающихся меток (тултип остаётся на hover).
        nodeGap: 14,
        labelLayout: { hideOverlap: true },
        label: {
          formatter: (p: { name: string }) => p.name.replace(/^src:/, '').replace(/^camp:/, ''),
        },
        data: nodes,
        links,
      },
    ],
  };
}

import type { HeatPublishState, HeatVersion } from './types'

// 热力发布领域独立持久化：与业务条目存储分开，但服务层在一次状态提交里完成全部写入，
// 任一校验失败都不会落盘，保证两侧不产生半成品。
const STORAGE_KEY = 'data-product-ops:heat-publish'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 播种时刻固定，保证每次重置后版本号、时间和覆盖率都可复现。
const SEED_VERSIONS: HeatVersion[] = [
  {
    id: 'HEATVER-0001',
    heatCode: 'HEAT-0001',
    versionNo: 1,
    calculatedAt: '2026-11-08T09:30:00.000Z',
    aggregation: '元素级',
    timeRange: '2026-10-01 至 2026-10-31',
    minSample: 5000,
    sampleSize: 6200,
    coverageRate: 1.24,
    qualified: true,
  },
  {
    // 验收主线：HEAT-0002 页面聚合，初始覆盖率未达最小样本，只能保存草稿
    id: 'HEATVER-0002',
    heatCode: 'HEAT-0002',
    versionNo: 1,
    calculatedAt: '2026-11-09T10:00:00.000Z',
    aggregation: '页面级',
    timeRange: '2026-10-01 至 2026-11-07',
    minSample: 8000,
    sampleSize: 5600,
    coverageRate: 0.7,
    qualified: false,
  },
  {
    id: 'HEATVER-0003',
    heatCode: 'HEAT-0003',
    versionNo: 1,
    calculatedAt: '2026-11-10T14:20:00.000Z',
    aggregation: '区域级',
    timeRange: '2026-10-15 至 2026-11-10',
    minSample: 3000,
    sampleSize: 4100,
    coverageRate: 1.37,
    qualified: true,
  },
]

function buildSeed(): HeatPublishState {
  return {
    versions: clone(SEED_VERSIONS),
    drafts: [],
    records: [],
    batches: [
      {
        batchNo: 'PUB-20261114-001',
        status: '打开',
        openedAt: '2026-11-14T08:00:00.000Z',
        closedAt: null,
      },
    ],
    receipts: [],
    seq: { version: 3, draft: 0, record: 0, batch: 1, receipt: 0 },
  }
}

function withFallback(stored: Partial<HeatPublishState> | null): HeatPublishState {
  const seed = buildSeed()
  if (!stored) {
    return seed
  }
  return {
    versions: Array.isArray(stored.versions) ? stored.versions : seed.versions,
    drafts: Array.isArray(stored.drafts) ? stored.drafts : seed.drafts,
    records: Array.isArray(stored.records) ? stored.records : seed.records,
    batches: Array.isArray(stored.batches) && stored.batches.length > 0 ? stored.batches : seed.batches,
    receipts: Array.isArray(stored.receipts) ? stored.receipts : seed.receipts,
    seq: { ...seed.seq, ...(stored.seq ?? {}) },
  }
}

let cache: HeatPublishState | null = null

export function heatPublishState(): HeatPublishState {
  if (cache !== null) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = buildSeed()
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cache = buildSeed()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    return cache
  }
  try {
    cache = withFallback(JSON.parse(raw) as Partial<HeatPublishState>)
  } catch {
    cache = buildSeed()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  }
  return cache
}

/** 服务层唯一的落盘入口：整棵状态树一次性替换，失败抛错由调用方处理，不产生半成品。 */
export function commitHeatPublish(state: HeatPublishState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetHeatPublish(): HeatPublishState {
  const seed = buildSeed()
  commitHeatPublish(seed)
  return seed
}

export function heatPublishStorageKey(): string {
  return STORAGE_KEY
}

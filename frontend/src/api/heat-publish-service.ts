import { listRows } from '@/data/local-store'
import { commitHeatPublish, heatPublishState } from '@/data/heat-publish/store'
import type {
  ChartDraft,
  ChartPublishRecord,
  ExternalReceipt,
  FieldCheck,
  HeatPublishState,
  HeatVersion,
  PublishBatch,
  ServiceResult,
} from '@/data/heat-publish/types'
import type { EntryRow } from '@/data/types'

// 热力发布领域服务：页面只做渲染，最小样本闸门、版本固定、幂等发布、原子落盘与回执解析
// 全部集中在这里。所有写操作先在克隆状态上完成全部校验，最后一次性 commit，
// 任何一步失败都直接返回，两侧（领域状态与业务条目）都不会出现半成品。

function pad(value: number, length = 4): string {
  return String(value).padStart(length, '0')
}

function text(row: EntryRow, field: string): string {
  const value = row[field]
  return value === undefined || value === null ? '' : String(value)
}

function number(row: EntryRow, field: string): number {
  const value = Number(row[field])
  return Number.isFinite(value) ? value : 0
}

function nowIso(): string {
  return new Date().toISOString()
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// 确定性伪随机：重算样本量可复现，避免纯前端环境用 Math.random 导致验收结果漂移。
function seededSample(heatCode: string, versionNo: number, minSample: number): number {
  const source = `${heatCode}#v${versionNo}`
  let hash = 0
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 9973
  }
  // 落在最小样本的 55%~145% 区间，保证既有不达标的版本也有达标的版本
  return Math.round(minSample * (0.55 + (hash % 91) / 100))
}

function heatRows(): EntryRow[] {
  return listRows('heatmap')
}

function dataVizRows(): EntryRow[] {
  return listRows('dataviz')
}

export function findHeatPlan(heatCode: string): EntryRow | undefined {
  return heatRows().find((row) => text(row, '方案编号') === heatCode)
}

export function findDataViz(dataVizCode: string): EntryRow | undefined {
  return dataVizRows().find((row) => text(row, '配置编号') === dataVizCode)
}

export function listHeatVersions(heatCode?: string): HeatVersion[] {
  const state = heatPublishState()
  const versions = heatCode
    ? state.versions.filter((item) => item.heatCode === heatCode)
    : [...state.versions]
  return versions.sort((a, b) => b.versionNo - a.versionNo)
}

export function latestHeatVersion(heatCode: string): HeatVersion | undefined {
  return listHeatVersions(heatCode)[0]
}

export function listDrafts(): ChartDraft[] {
  return [...heatPublishState().drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function listPublishRecords(heatCode?: string): ChartPublishRecord[] {
  const state = heatPublishState()
  const records = heatCode
    ? state.records.filter((item) => item.heatCode === heatCode)
    : [...state.records]
  return records.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export function listReceipts(batchNo?: string): ExternalReceipt[] {
  const state = heatPublishState()
  const receipts = batchNo
    ? state.receipts.filter((item) => item.batchNo === batchNo)
    : [...state.receipts]
  return receipts.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

export function listBatches(): PublishBatch[] {
  return [...heatPublishState().batches].sort((a, b) => b.openedAt.localeCompare(a.openedAt))
}

export function currentBatch(): PublishBatch | undefined {
  return heatPublishState().batches.find((batch) => batch.status === '打开')
}

/** 显式开新批次：已有打开批次时直接复用，保证任意时刻只有一个当前批。 */
export function openNewBatch(): ServiceResult<PublishBatch> {
  const state = heatPublishState()
  const open = state.batches.find((batch) => batch.status === '打开')
  if (open) {
    return { ok: true, message: `当前已有打开批次 ${open.batchNo}，已直接复用`, data: open }
  }
  const cloned: HeatPublishState = JSON.parse(JSON.stringify(state)) as HeatPublishState
  const next: PublishBatch = {
    batchNo: `PUB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${pad(cloned.seq.batch + 1, 3)}`,
    status: '打开',
    openedAt: nowIso(),
    closedAt: null,
  }
  cloned.seq.batch += 1
  cloned.batches.push(next)
  commitHeatPublish(cloned)
  return { ok: true, message: `已开新批次 ${next.batchNo}`, data: next }
}

export function closeCurrentBatch(): ServiceResult<PublishBatch> {
  const state = heatPublishState()
  const open = state.batches.find((batch) => batch.status === '打开')
  if (!open) {
    return { ok: false, message: '当前没有打开的发布批次' }
  }
  const cloned: HeatPublishState = JSON.parse(JSON.stringify(state)) as HeatPublishState
  const target = cloned.batches.find((batch) => batch.batchNo === open.batchNo)
  if (!target) {
    return { ok: false, message: '批次状态异常，关闭失败' }
  }
  target.status = '已关闭'
  target.closedAt = nowIso()
  commitHeatPublish(cloned)
  return { ok: true, message: `批次 ${target.batchNo} 已关闭，发布与回执写入已截止`, data: target }
}

/**
 * 热力重算：只追加不可变新版本，绝不修改历史版本。
 * 已发布图表固定的版本引用因此不会被重算悄悄替换。
 */
export function recomputeHeat(heatCode: string): ServiceResult<HeatVersion> {
  const plan = findHeatPlan(heatCode)
  if (!plan) {
    return { ok: false, message: `没有找到热力方案 ${heatCode}` }
  }
  const state = heatPublishState()
  const cloned: HeatPublishState = JSON.parse(JSON.stringify(state)) as HeatPublishState
  const existed = cloned.versions
    .filter((item) => item.heatCode === heatCode)
    .map((item) => item.versionNo)
  const versionNo = (existed.length ? Math.max(...existed) : 0) + 1
  const minSample = number(plan, '最小样本')
  const sampleSize = seededSample(heatCode, versionNo, minSample)
  const coverageRate = round2(sampleSize / minSample)
  const version: HeatVersion = {
    id: `HEATVER-${pad(cloned.seq.version + 1)}`,
    heatCode,
    versionNo,
    calculatedAt: nowIso(),
    aggregation: text(plan, '聚合级别'),
    timeRange: text(plan, '时间范围'),
    minSample,
    sampleSize,
    coverageRate,
    qualified: sampleSize >= minSample,
  }
  cloned.seq.version += 1
  cloned.versions.push(version)
  commitHeatPublish(cloned)
  return {
    ok: true,
    message: `已生成 ${heatCode} 第 ${versionNo} 版热力结果，样本覆盖率 ${coverageRate.toFixed(2)}（${version.qualified ? '达标' : '未达最小样本'}）`,
    data: version,
  }
}

/**
 * 源字段核对：以 HEAT 方案与 DATA 图表配置两侧的实际字段逐项比对。
 * 不匹配项给出 warn 提示人工确认，但不阻断发布；真正的硬闸门只有最小样本覆盖率。
 */
export function buildFieldChecks(heatCode: string, dataVizCode: string): ServiceResult<FieldCheck[]> {
  const plan = findHeatPlan(heatCode)
  const chart = findDataViz(dataVizCode)
  if (!plan) {
    return { ok: false, message: `没有找到热力方案 ${heatCode}` }
  }
  if (!chart) {
    return { ok: false, message: `没有找到图表配置 ${dataVizCode}` }
  }
  const checks: FieldCheck[] = [
    {
      item: '页面/主题口径',
      heatValue: text(plan, '页面名称'),
      chartValue: text(chart, '图表名称'),
      result: text(chart, '图表名称').includes(text(plan, '页面名称').slice(0, 2)) ? 'pass' : 'warn',
      note: '图表名称应能体现热力页面',
    },
    {
      item: '热力类型/图表类型',
      heatValue: text(plan, '热力类型'),
      chartValue: text(chart, '图表类型'),
      result: text(chart, '图表类型').includes('热力') ? 'pass' : 'warn',
      note: '热力结果建议以热力图类型呈现',
    },
    {
      item: '聚合级别',
      heatValue: text(plan, '聚合级别'),
      chartValue: text(chart, '数据源'),
      result: /页面/.test(text(plan, '聚合级别')) && /page/i.test(text(chart, '数据源')) ? 'pass' : 'warn',
      note: '页面级聚合需对应页面聚合数据源',
    },
    {
      item: '时间范围/刷新间隔',
      heatValue: text(plan, '时间范围'),
      chartValue: text(chart, '刷新间隔'),
      result: 'pass',
      note: '口径不同但需同时登记：时间范围来自方案，刷新节奏来自图表配置',
    },
    {
      item: '最小样本/数据来源',
      heatValue: `${text(plan, '最小样本')} 样本`,
      chartValue: text(chart, '数据源'),
      result: 'pass',
      note: '发布闸门按方案最小样本执行，数据源仅登记核对',
    },
  ]
  return { ok: true, message: '源字段核对完成', data: checks }
}

type DraftInput = {
  heatCode: string
  heatVersionId: string
  dataVizCode: string
  name?: string
}

function resolveVersion(state: HeatPublishState, versionId: string): HeatVersion | undefined {
  return state.versions.find((item) => item.id === versionId)
}

/**
 * 保存图表草稿：覆盖率未达最小样本也允许保存（这是未达标时唯一可走的路径）。
 * 同一「方案版本 + 图表配置」只保留一份草稿，重复保存即更新，不制造重复数据。
 */
export function saveChartDraft(input: DraftInput): ServiceResult<ChartDraft> {
  const plan = findHeatPlan(input.heatCode)
  const chart = findDataViz(input.dataVizCode)
  if (!plan) {
    return { ok: false, message: `没有找到热力方案 ${input.heatCode}` }
  }
  if (!chart) {
    return { ok: false, message: `没有找到图表配置 ${input.dataVizCode}` }
  }
  const state = heatPublishState()
  const version = resolveVersion(state, input.heatVersionId)
  if (!version || version.heatCode !== input.heatCode) {
    return { ok: false, message: '所选热力结果版本不存在或不属于该方案' }
  }
  const checksResult = buildFieldChecks(input.heatCode, input.dataVizCode)
  if (!checksResult.ok || !checksResult.data) {
    return { ok: false, message: checksResult.message }
  }
  const cloned: HeatPublishState = JSON.parse(JSON.stringify(state)) as HeatPublishState
  const existing = cloned.drafts.find(
    (item) =>
      item.heatVersionId === input.heatVersionId && item.dataVizCode === input.dataVizCode,
  )
  const stamp = nowIso()
  const name = input.name?.trim() || `${text(plan, '页面名称')} × ${text(chart, '图表名称')}`
  if (existing) {
    existing.name = name
    existing.fieldChecks = checksResult.data
    existing.coverageRate = version.coverageRate
    existing.qualified = version.qualified
    existing.updatedAt = stamp
    commitHeatPublish(cloned)
    return {
      ok: true,
      message: version.qualified
        ? `草稿已更新，覆盖率 ${version.coverageRate.toFixed(2)} 达标，可提交发布`
        : `草稿已保存：覆盖率 ${version.coverageRate.toFixed(2)} 未达最小样本，暂不能发布`,
      data: existing,
    }
  }
  const draft: ChartDraft = {
    id: `CHDRAFT-${pad(cloned.seq.draft + 1)}`,
    heatCode: input.heatCode,
    heatVersionId: version.id,
    heatVersionNo: version.versionNo,
    dataVizCode: input.dataVizCode,
    name,
    status: '草稿',
    fieldChecks: checksResult.data,
    coverageRate: version.coverageRate,
    qualified: version.qualified,
    createdAt: stamp,
    updatedAt: stamp,
  }
  cloned.seq.draft += 1
  cloned.drafts.push(draft)
  commitHeatPublish(cloned)
  return {
    ok: true,
    message: version.qualified
      ? `图表草稿已生成，覆盖率 ${version.coverageRate.toFixed(2)} 达标，可提交发布`
      : `图表草稿已保存：覆盖率 ${version.coverageRate.toFixed(2)} 未达最小样本，仅可保存草稿`,
    data: draft,
  }
}

/**
 * 发布图表。硬规则：
 * 1. 热力版本必须达到最小样本，否则拒绝，不落任何数据；
 * 2. 发布记录固定方案版本号与双侧字段快照，之后热力重算不影响已上线图表；
 * 3. 同一「方案 + 版本 + 图表配置」重复发布直接幂等返回原记录，只产生一个当前图表；
 * 4. 同一图表配置发布方案新版本时，旧当前记录按发布时间转为已归档。
 * 全部校验通过后才一次性 commit，失败两侧都没有半成品。
 */
export function publishChart(input: DraftInput): ServiceResult<ChartPublishRecord> {
  const plan = findHeatPlan(input.heatCode)
  const chart = findDataViz(input.dataVizCode)
  if (!plan) {
    return { ok: false, message: `没有找到热力方案 ${input.heatCode}` }
  }
  if (!chart) {
    return { ok: false, message: `没有找到图表配置 ${input.dataVizCode}` }
  }
  const state = heatPublishState()
  const version = resolveVersion(state, input.heatVersionId)
  if (!version || version.heatCode !== input.heatCode) {
    return { ok: false, message: '所选热力结果版本不存在或不属于该方案' }
  }
  if (!version.qualified) {
    return {
      ok: false,
      message: `发布被拦截：${input.heatCode} 第 ${version.versionNo} 版样本覆盖率 ${version.coverageRate.toFixed(2)}，未达最小样本 ${version.minSample}（当前 ${version.sampleSize}），只能保存草稿`,
    }
  }
  const batch = state.batches.find((item) => item.status === '打开')
  if (!batch) {
    return { ok: false, message: '当前没有打开的发布批次，请先新建批次后再发布' }
  }
  const checksResult = buildFieldChecks(input.heatCode, input.dataVizCode)
  if (!checksResult.ok || !checksResult.data) {
    return { ok: false, message: checksResult.message }
  }

  // 幂等：同一热力版本发布到同一图表配置，只返回已有当前图表，不产生第二条记录
  const duplicate = state.records.find(
    (item) =>
      item.heatCode === input.heatCode &&
      item.heatVersionId === version.id &&
      item.dataVizCode === input.dataVizCode,
  )
  if (duplicate) {
    return {
      ok: true,
      message: `该热力版本已发布过（记录 ${duplicate.id}），已复用当前图表，未重复生成`,
      data: duplicate,
    }
  }

  const cloned: HeatPublishState = JSON.parse(JSON.stringify(state)) as HeatPublishState
  // 同一图表配置下的旧当前图表按发布时间留档
  for (const record of cloned.records) {
    if (record.dataVizCode === input.dataVizCode && record.current) {
      record.current = false
    }
  }
  const stamp = nowIso()
  const chartSnapshot: Record<string, string | number | boolean> = { ...chart }
  // 批次内已有同版本回执时，发布即关联，保证记录与回执双向可查
  const linkedReceipt = [...cloned.receipts]
    .reverse()
    .find((item) => item.heatCode === input.heatCode && item.heatVersionNo === version.versionNo)
  const record: ChartPublishRecord = {
    id: `CHPUB-${pad(cloned.seq.record + 1)}`,
    batchNo: batch.batchNo,
    heatCode: input.heatCode,
    heatVersionId: version.id,
    heatVersionNo: version.versionNo,
    dataVizCode: input.dataVizCode,
    chartName: text(chart, '图表名称'),
    chartSnapshot,
    heatSnapshot: {
      pageName: text(plan, '页面名称'),
      heatType: text(plan, '热力类型'),
      aggregation: version.aggregation,
      timeRange: version.timeRange,
      minSample: version.minSample,
      sampleSize: version.sampleSize,
      coverageRate: version.coverageRate,
    },
    fieldChecks: checksResult.data,
    current: true,
    publishedAt: stamp,
    receiptNo: linkedReceipt ? linkedReceipt.receiptNo : null,
  }
  cloned.seq.record += 1
  cloned.records.push(record)

  // 关联草稿同步标记为已发布（草稿是留档快照，不删除）
  for (const draft of cloned.drafts) {
    if (
      draft.heatVersionId === version.id &&
      draft.dataVizCode === input.dataVizCode
    ) {
      draft.status = '已发布'
      draft.updatedAt = stamp
    }
  }

  // 唯一落盘点：到此为止全部校验已通过，commit 失败则整棵状态保持原样
  try {
    commitHeatPublish(cloned)
  } catch {
    return { ok: false, message: '发布落盘失败，已整体回滚，未产生任何发布记录或草稿' }
  }
  return { ok: true, message: `发布成功：记录 ${record.id} 已固定 ${input.heatCode} 第 ${version.versionNo} 版`, data: record }
}

type ParsedReceipt = {
  receiptNo: string
  heatCode: string
  heatVersionNo: number
  sampleSize: number
}

function parseCsv(content: string): ParsedReceipt[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) {
    throw new Error('回执文件只有表头或内容为空')
  }
  const header = lines[0].split(',').map((cell) => cell.trim())
  const required = ['receiptNo', 'heatCode', 'heatVersionNo', 'sampleSize']
  const missing = required.filter((key) => !header.includes(key))
  if (missing.length > 0) {
    throw new Error(`回执缺少必填列：${missing.join('、')}`)
  }
  return lines.slice(1).map((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim())
    const row = Object.fromEntries(header.map((key, i) => [key, cells[i] ?? '']))
    const versionNo = Number(row.heatVersionNo)
    const sampleSize = Number(row.sampleSize)
    if (!row.receiptNo || !row.heatCode) {
      throw new Error(`第 ${index + 2} 行回执编号或热力方案编号为空`)
    }
    if (!Number.isInteger(versionNo) || versionNo <= 0) {
      throw new Error(`第 ${index + 2} 行热力版本号不合法`)
    }
    if (!Number.isFinite(sampleSize) || sampleSize < 0) {
      throw new Error(`第 ${index + 2} 行样本量不合法`)
    }
    return {
      receiptNo: row.receiptNo,
      heatCode: row.heatCode,
      heatVersionNo: versionNo,
      sampleSize,
    }
  })
}

function parseJson(content: string): ParsedReceipt[] {
  const parsed = JSON.parse(content) as unknown
  const list = Array.isArray(parsed) ? parsed : [parsed]
  return list.map((item, index) => {
    const row = item as Record<string, unknown>
    const receiptNo = String(row.receiptNo ?? '').trim()
    const heatCode = String(row.heatCode ?? '').trim()
    const versionNo = Number(row.heatVersionNo)
    const sampleSize = Number(row.sampleSize)
    if (!receiptNo || !heatCode) {
      throw new Error(`第 ${index + 1} 条回执编号或热力方案编号为空`)
    }
    if (!Number.isInteger(versionNo) || versionNo <= 0) {
      throw new Error(`第 ${index + 1} 条热力版本号不合法`)
    }
    if (!Number.isFinite(sampleSize) || sampleSize < 0) {
      throw new Error(`第 ${index + 1} 条样本量不合法`)
    }
    return { receiptNo, heatCode, heatVersionNo: versionNo, sampleSize }
  })
}

/**
 * 导入外部回执：文件解析后进入当前批。
 * 回执回填对应热力版本的累计样本并重算覆盖率（达标状态随之刷新，再发布即受新闸门约束）；
 * 任意一行解析或匹配失败，整批拒绝、不落盘，保证没有半成品回执。
 */
export function importReceipt(fileName: string, content: string): ServiceResult<ExternalReceipt[]> {
  let parsed: ParsedReceipt[]
  try {
    parsed = /\.json$/i.test(fileName) ? parseJson(content) : parseCsv(content)
  } catch (error) {
    return { ok: false, message: `回执解析失败：${error instanceof Error ? error.message : '文件格式不合法'}` }
  }
  if (parsed.length === 0) {
    return { ok: false, message: '回执文件中没有可导入的记录' }
  }
  const state = heatPublishState()
  const batch = state.batches.find((item) => item.status === '打开')
  if (!batch) {
    return { ok: false, message: '当前没有打开的发布批次，请先新建批次再导入回执' }
  }
  const cloned: HeatPublishState = JSON.parse(JSON.stringify(state)) as HeatPublishState
  const imported: ExternalReceipt[] = []
  const stamp = nowIso()
  for (const row of parsed) {
    const version = cloned.versions.find(
      (item) => item.heatCode === row.heatCode && item.versionNo === row.heatVersionNo,
    )
    if (!version) {
      return {
        ok: false,
        message: `回执 ${row.receiptNo} 指向的 ${row.heatCode} 第 ${row.heatVersionNo} 版不存在，整批未导入`,
      }
    }
    if (cloned.receipts.some((item) => item.receiptNo === row.receiptNo)) {
      return { ok: false, message: `回执编号 ${row.receiptNo} 已导入过，整批未导入` }
    }
    cloned.seq.receipt += 1
    const receipt: ExternalReceipt = {
      id: `RECPT-${pad(cloned.seq.receipt)}`,
      batchNo: batch.batchNo,
      receiptNo: row.receiptNo,
      heatCode: row.heatCode,
      heatVersionNo: row.heatVersionNo,
      sampleSize: row.sampleSize,
      sourceFile: fileName,
      importedAt: stamp,
    }
    cloned.receipts.push(receipt)
    imported.push(receipt)
    // 回执样本回填版本：外部采集量并入累计样本，覆盖率与达标状态重算
    version.sampleSize += row.sampleSize
    version.coverageRate = round2(version.sampleSize / version.minSample)
    version.qualified = version.sampleSize >= version.minSample
  }
  // 已保存草稿的覆盖率展示同步刷新，但草稿本身不会被自动发布
  for (const draft of cloned.drafts) {
    const version = cloned.versions.find((item) => item.id === draft.heatVersionId)
    if (version) {
      draft.coverageRate = version.coverageRate
      draft.qualified = version.qualified
    }
  }
  // 回执关联到同版本的发布记录
  for (const receipt of imported) {
    for (const record of cloned.records) {
      if (
        record.heatCode === receipt.heatCode &&
        record.heatVersionNo === receipt.heatVersionNo &&
        record.receiptNo === null
      ) {
        record.receiptNo = receipt.receiptNo
      }
    }
  }
  try {
    commitHeatPublish(cloned)
  } catch {
    return { ok: false, message: '回执落盘失败，已整体回滚，当前批未产生回执' }
  }
  return { ok: true, message: `已解析 ${imported.length} 条回执并进入当前批 ${batch.batchNo}`, data: imported }
}

export function receiptTemplateCsv(): string {
  return '\uFEFFreceiptNo,heatCode,heatVersionNo,sampleSize\nRCP-DEMO-01,HEAT-0002,1,3000\n'
}

/** 双向追溯：按热力方案编号查发布记录（方案详情侧用）。 */
export function recordsOfHeat(heatCode: string): ChartPublishRecord[] {
  return listPublishRecords(heatCode)
}

/** 双向追溯：按图表配置编号查发布记录（图表配置详情侧用）。 */
export function recordsOfDataViz(dataVizCode: string): ChartPublishRecord[] {
  return heatPublishState()
    .records.filter((item) => item.dataVizCode === dataVizCode)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

/** 供热力方案列表展示当前固定版本，避免页面直接拼领域状态。 */
export function currentVersionOfHeat(heatCode: string): ChartPublishRecord | undefined {
  return heatPublishState().records.find(
    (item) => item.heatCode === heatCode && item.current,
  )
}

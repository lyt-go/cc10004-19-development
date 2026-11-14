/* 端到端校验：纯前端环境下用 localStorage mock 驱动热力发布服务层的全部验收路径。 */
import assert from 'node:assert/strict'

import { resetRows } from '@/data/local-store'
import { resetHeatPublish } from '@/data/heat-publish/store'
import {
  buildFieldChecks,
  closeCurrentBatch,
  currentBatch,
  currentVersionOfHeat,
  findDataViz,
  findHeatPlan,
  importReceipt,
  listBatches,
  listDrafts,
  listHeatVersions,
  listPublishRecords,
  openNewBatch,
  publishChart,
  recomputeHeat,
  recordsOfDataViz,
  recordsOfHeat,
  saveChartDraft,
} from '@/api/heat-publish-service'

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    console.error(`  FAIL  ${name}`)
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

// ---- 环境准备：重置到播种状态 ----
resetRows('heatmap')
resetRows('dataviz')
resetHeatPublish()

const plan = findHeatPlan('HEAT-0002')
const chart = findDataViz('DATA-0002')

console.log('1. 播种数据核对（HEAT-0002 页面聚合 / DATA-0002 图表源字段）')
check('HEAT-0002 是页面级聚合方案', () => {
  assert.ok(plan)
  assert.equal(String(plan['页面名称']), '商品详情页')
  assert.equal(String(plan['热力类型']), '滚动深度热力图')
  assert.equal(String(plan['聚合级别']), '页面级')
  assert.equal(Number(plan['最小样本']), 8000)
})
check('DATA-0002 图表源字段齐全', () => {
  assert.ok(chart)
  assert.equal(String(chart['图表类型']), '热力图')
  assert.match(String(chart['数据源']), /dws_page_heat/)
  assert.equal(String(chart['X轴字段']), 'page_section')
  assert.equal(String(chart['Y轴字段']), 'scroll_depth_rate')
  assert.equal(String(chart['刷新间隔']), '15分钟')
})

const v1 = listHeatVersions('HEAT-0002').find((item) => item.versionNo === 1)

console.log('2. 覆盖率未达最小样本：只能保存草稿，不能发布')
check('HEAT-0002 v1 覆盖率 0.70，未达标', () => {
  assert.equal(v1.aggregation, '页面级')
  assert.equal(v1.sampleSize, 5600)
  assert.equal(v1.minSample, 8000)
  assert.equal(v1.coverageRate, 0.7)
  assert.equal(v1.qualified, false)
})
check('未达标时保存草稿成功', () => {
  const result = saveChartDraft({ heatCode: 'HEAT-0002', heatVersionId: v1.id, dataVizCode: 'DATA-0002' })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.data.qualified, false)
  assert.equal(listDrafts().length, 1)
})
check('未达标时提交发布被拦截且无半成品', () => {
  const before = listPublishRecords().length
  const result = publishChart({ heatCode: 'HEAT-0002', heatVersionId: v1.id, dataVizCode: 'DATA-0002' })
  assert.equal(result.ok, false)
  assert.match(result.message, /未达最小样本/)
  assert.equal(listPublishRecords().length, before)
})
check('字段核对覆盖页面聚合与源字段', () => {
  const result = buildFieldChecks('HEAT-0002', 'DATA-0002')
  assert.equal(result.ok, true)
  const items = result.data.map((item) => item.item)
  assert.ok(items.includes('聚合级别'))
  assert.ok(items.includes('热力类型/图表类型'))
})

console.log('3. 回执导入：文件解析后进入当前批，并回填覆盖率')
const batch = currentBatch()
const receiptCsv = 'receiptNo,heatCode,heatVersionNo,sampleSize\nRCP-001,HEAT-0002,1,3000\n'
check('CSV 回执解析成功并进入当前批', () => {
  const result = importReceipt('回执批次A.csv', receiptCsv)
  assert.equal(result.ok, true, result.message)
  assert.equal(result.data[0].batchNo, batch.batchNo)
})
check('回填后 v1 样本 8600、覆盖率 1.08、转为达标', () => {
  const refreshed = listHeatVersions('HEAT-0002').find((item) => item.versionNo === 1)
  assert.equal(refreshed.sampleSize, 8600)
  assert.equal(refreshed.coverageRate, 1.08)
  assert.equal(refreshed.qualified, true)
})
check('已保存草稿的覆盖率同步刷新但未被自动发布', () => {
  const draft = listDrafts()[0]
  assert.equal(draft.coverageRate, 1.08)
  assert.equal(draft.qualified, true)
  assert.equal(draft.status, '草稿')
})
check('JSON 回执同样可解析', () => {
  const json = JSON.stringify([
    { receiptNo: 'RCP-002', heatCode: 'HEAT-0001', heatVersionNo: 1, sampleSize: 200 },
  ])
  const result = importReceipt('回执.json', json)
  assert.equal(result.ok, true, result.message)
})
check('坏行导致整批拒绝，不产生半成品', () => {
  const before = listPublishRecords().length
  const bad = 'receiptNo,heatCode,heatVersionNo,sampleSize\nRCP-BAD,HEAT-0002,1,abc\n'
  const result = importReceipt('坏回执.csv', bad)
  assert.equal(result.ok, false)
  assert.match(result.message, /样本量不合法/)
  assert.equal(before, listPublishRecords().length)
})
check('重复回执编号整批拒绝', () => {
  const result = importReceipt('重复.csv', receiptCsv)
  assert.equal(result.ok, false)
  assert.match(result.message, /已导入过/)
})
check('指向不存在版本的回执整批拒绝', () => {
  const result = importReceipt('幽灵版本.csv', 'receiptNo,heatCode,heatVersionNo,sampleSize\nRCP-X,HEAT-0002,99,100\n')
  assert.equal(result.ok, false)
  assert.match(result.message, /不存在/)
})

console.log('4. 达标发布：生成发布记录并固定 HEAT-0002 版本')
let firstRecord
check('达标后发布成功，记录固定 v1 与双侧快照', () => {
  const result = publishChart({ heatCode: 'HEAT-0002', heatVersionId: v1.id, dataVizCode: 'DATA-0002' })
  assert.equal(result.ok, true, result.message)
  firstRecord = result.data
  assert.equal(firstRecord.heatCode, 'HEAT-0002')
  assert.equal(firstRecord.heatVersionNo, 1)
  assert.equal(firstRecord.heatVersionId, v1.id)
  assert.equal(firstRecord.current, true)
  assert.equal(firstRecord.receiptNo, 'RCP-001')
  assert.equal(firstRecord.heatSnapshot.aggregation, '页面级')
  assert.equal(firstRecord.heatSnapshot.pageName, '商品详情页')
  assert.equal(firstRecord.chartSnapshot['配置编号'], 'DATA-0002')
  assert.equal(firstRecord.chartSnapshot['X轴字段'], 'page_section')
  assert.equal(firstRecord.chartSnapshot['Y轴字段'], 'scroll_depth_rate')
})
check('关联草稿标记为已发布但保留留档', () => {
  const draft = listDrafts()[0]
  assert.equal(draft.status, '已发布')
})

console.log('5. 版本固定：热力重算不能替换已上线图表')
let v2
check('重算只追加新版本，历史版本不可变', () => {
  const result = recomputeHeat('HEAT-0002')
  assert.equal(result.ok, true)
  v2 = result.data
  assert.equal(v2.versionNo, 2)
  assert.notEqual(v2.id, v1.id)
  const stillV1 = listHeatVersions('HEAT-0002').find((item) => item.id === v1.id)
  assert.equal(stillV1.sampleSize, 8600)
})
check('已发布图表仍固定 v1', () => {
  const current = currentVersionOfHeat('HEAT-0002')
  assert.equal(current.heatVersionId, v1.id)
  assert.equal(current.heatVersionNo, 1)
})

console.log('6. 幂等与留档：同版本重复发布只产生一个当前图表；新版本发布后旧版归档')
check('同一热力版本重复发布幂等返回，不新增记录', () => {
  const before = listPublishRecords().length
  const result = publishChart({ heatCode: 'HEAT-0002', heatVersionId: v1.id, dataVizCode: 'DATA-0002' })
  assert.equal(result.ok, true)
  assert.match(result.message, /已复用当前图表/)
  assert.equal(listPublishRecords().length, before)
})
check('v2 若达标可发布，旧当前记录按发布时间归档且只保留一个当前图表', () => {
  // 用回执把 v2 补到达标，模拟外部样本到位后的再次发布
  const fill = Math.max(0, v2.minSample - v2.sampleSize + 100)
  const result = importReceipt(
    'v2补样.csv',
    `receiptNo,heatCode,heatVersionNo,sampleSize\nRCP-V2,HEAT-0002,2,${fill}\n`,
  )
  assert.equal(result.ok, true, result.message)
  const qualifiedV2 = listHeatVersions('HEAT-0002').find((item) => item.id === v2.id)
  assert.equal(qualifiedV2.qualified, true)
  const published = publishChart({ heatCode: 'HEAT-0002', heatVersionId: v2.id, dataVizCode: 'DATA-0002' })
  assert.equal(published.ok, true, published.message)
  const dataVizRecords = recordsOfDataViz('DATA-0002')
  const currents = dataVizRecords.filter((item) => item.current)
  assert.equal(currents.length, 1)
  assert.equal(currents[0].heatVersionNo, 2)
  const archived = dataVizRecords.find((item) => item.heatVersionNo === 1)
  assert.equal(archived.current, false)
  // 旧记录按发布时间留档，仍然可查
  assert.ok(dataVizRecords.every((item) => item.publishedAt))
  assert.equal(dataVizRecords.length, 2)
})

console.log('7. 双向追溯：方案详情与图表配置两侧互查同一批记录')
check('按 HEAT-0002 与按 DATA-0002 查到同一组发布记录', () => {
  const byHeat = recordsOfHeat('HEAT-0002')
  const byData = recordsOfDataViz('DATA-0002')
  assert.equal(byHeat.length, 2)
  assert.deepEqual(byHeat.map((item) => item.id).sort(), byData.map((item) => item.id).sort())
})

console.log('8. 批次闸门：关闭批次后回执不能再写入')
check('关闭当前批次成功', () => {
  const result = closeCurrentBatch()
  assert.equal(result.ok, true)
  assert.equal(result.data.status, '已关闭')
})
check('关闭后导入回执被拒绝', () => {
  const result = importReceipt('关批后.csv', 'receiptNo,heatCode,heatVersionNo,sampleSize\nRCP-LATE,HEAT-0001,1,10\n')
  assert.equal(result.ok, false)
  assert.match(result.message, /没有打开的发布批次/)
})
check('关闭后发布被拒绝，且不产生记录', () => {
  const before = listPublishRecords().length
  const result = publishChart({ heatCode: 'HEAT-0001', heatVersionId: listHeatVersions('HEAT-0001')[0].id, dataVizCode: 'DATA-0001' })
  assert.equal(result.ok, false)
  assert.match(result.message, /没有打开的发布批次/)
  assert.equal(listPublishRecords().length, before)
})
check('需要时显式开新批次，历史批次全部留档', () => {
  assert.equal(currentBatch(), undefined)
  const opened = openNewBatch()
  assert.equal(opened.ok, true)
  assert.equal(opened.data.status, '打开')
  assert.equal(currentBatch()?.batchNo, opened.data.batchNo)
  assert.equal(listBatches().filter((item) => item.status === '已关闭').length, 1)
})
check('已有打开批次时开批请求幂等复用', () => {
  const count = listBatches().length
  const result = openNewBatch()
  assert.equal(result.ok, true)
  assert.equal(listBatches().length, count)
})

console.log(`\n${passed} 项断言全部通过`)

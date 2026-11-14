import { useCallback, useMemo, useState } from 'react'

import {
  buildFieldChecks,
  closeCurrentBatch,
  currentBatch,
  importReceipt,
  listBatches,
  listDrafts,
  listHeatVersions,
  listPublishRecords,
  listReceipts,
  openNewBatch,
  publishChart,
  receiptTemplateCsv,
  recomputeHeat,
  saveChartDraft,
} from '@/api/heat-publish-service'
import { listRows } from '@/data/local-store'
import type {
  ChartDraft,
  ChartPublishRecord,
  ExternalReceipt,
  FieldCheck,
  HeatVersion,
  PublishBatch,
} from '@/data/heat-publish/types'
import type { EntryRow } from '@/data/types'
import CoverageBar from './CoverageBar'
import Modal from './Modal'
import PublishRecordDetail from './PublishRecordDetail'

type Toast = { ok: boolean; message: string } | null

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export default function HeatPublishView() {
  // tick 用来在服务层写 localStorage 后触发整页重读，数据读取仍统一走服务层
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((value) => value + 1), [])

  const [heatCode, setHeatCode] = useState('HEAT-0002')
  const [versionId, setVersionId] = useState('')
  const [dataVizCode, setDataVizCode] = useState('DATA-0002')
  const [draftName, setDraftName] = useState('')
  const [toast, setToast] = useState<Toast>(null)
  const [detailRecord, setDetailRecord] = useState<ChartPublishRecord | null>(null)
  const [traceCode, setTraceCode] = useState<string | null>(null)

  const heatPlans = useMemo(() => listRows('heatmap'), [tick])
  const dataVizList = useMemo(() => listRows('dataviz'), [tick])
  const versions = useMemo(() => listHeatVersions(heatCode), [heatCode, tick])
  const selectedVersion: HeatVersion | undefined =
    versions.find((item) => item.id === versionId) ?? versions[0]
  const selectedPlan: EntryRow | undefined = heatPlans.find((row) => String(row['方案编号']) === heatCode)
  const selectedChart: EntryRow | undefined = dataVizList.find(
    (row) => String(row['配置编号']) === dataVizCode,
  )

  const drafts = useMemo(() => listDrafts(), [tick])
  const records = useMemo(() => listPublishRecords(), [tick])
  const batches = useMemo(() => listBatches(), [tick])
  const batch = useMemo(() => currentBatch(), [tick])
  const receipts = useMemo(() => listReceipts(batch?.batchNo ?? ''), [batch?.batchNo, tick])
  const fieldChecks: FieldCheck[] = useMemo(() => {
    if (!selectedVersion) {
      return []
    }
    const result = buildFieldChecks(heatCode, dataVizCode)
    return result.ok && result.data ? result.data : []
  }, [heatCode, dataVizCode, selectedVersion?.id, tick])

  function notify(result: { ok: boolean; message: string }) {
    setToast(result)
    if (result.ok) {
      reload()
    }
  }

  function changePlan(code: string) {
    setHeatCode(code)
    setVersionId('')
    setToast(null)
  }

  function handleRecompute() {
    const result = recomputeHeat(heatCode)
    if (result.ok && result.data) {
      setVersionId(result.data.id)
    }
    notify(result)
  }

  function handleSaveDraft() {
    if (!selectedVersion) {
      setToast({ ok: false, message: '请先选择热力结果版本' })
      return
    }
    notify(saveChartDraft({
      heatCode,
      heatVersionId: selectedVersion.id,
      dataVizCode,
      name: draftName,
    }))
  }

  function handlePublish() {
    if (!selectedVersion) {
      setToast({ ok: false, message: '请先选择热力结果版本' })
      return
    }
    notify(publishChart({
      heatCode,
      heatVersionId: selectedVersion.id,
      dataVizCode,
      name: draftName,
    }))
  }

  function handleReceiptFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = () => notify(importReceipt(file.name, String(reader.result ?? '')))
    reader.onerror = () => setToast({ ok: false, message: '文件读取失败，请重新选择' })
    reader.readAsText(file)
  }

  function handleCloseBatch() {
    notify(closeCurrentBatch())
  }

  function handleOpenBatch() {
    notify(openNewBatch())
  }

  const traceRecords = useMemo(
    () => (traceCode ? listPublishRecords(traceCode) : []),
    [traceCode, tick],
  )

  return (
    <section className="page" data-module="heat-publish">
      <header className="page-head">
        <div>
          <h2>热力图谱发布工作台</h2>
          <p className="page-desc">
            从热力方案直接生成图表草稿：核对页面聚合与图表源字段，按最小样本闸门发布；
            发布记录固定方案版本，热力重算不会替换已上线图表。
          </p>
        </div>
      </header>

      {toast && (
        <p className={toast.ok ? 'inline-msg ok' : 'inline-msg bad'} role="status">
          {toast.message}
        </p>
      )}

      {/* 第一步：选择方案与版本，展示热力结果、聚合级别和样本覆盖率 */}
      <article className="panel">
        <h3 className="panel-title">① 选择热力方案与结果版本</h3>
        <div className="panel-controls">
          <label className="filter-item">
            <span>热力方案</span>
            <select value={heatCode} onChange={(event) => changePlan(event.target.value)}>
              {heatPlans.map((row) => (
                <option key={String(row.id)} value={String(row['方案编号'])}>
                  {String(row['方案编号'])} · {String(row['页面名称'])}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-item">
            <span>热力结果版本（重算只追加新版本）</span>
            <select
              value={selectedVersion?.id ?? ''}
              onChange={(event) => setVersionId(event.target.value)}
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  第 {version.versionNo} 版 · {version.aggregation} · 覆盖率 {version.coverageRate.toFixed(2)}
                  {version.qualified ? ' · 达标' : ' · 未达标'}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="button" onClick={handleRecompute}>重算热力（追加新版本）</button>
        </div>

        {selectedPlan && selectedVersion && (
          <div className="two-col">
            <div className="detail-card">
              <h4>HEAT 方案信息（{heatCode}）</h4>
              <dl>
                <div className="detail-row"><dt>页面名称</dt><dd>{String(selectedPlan['页面名称'])}</dd></div>
                <div className="detail-row"><dt>热力类型</dt><dd>{String(selectedPlan['热力类型'])}</dd></div>
                <div className="detail-row"><dt>聚合级别</dt><dd>{selectedVersion.aggregation}</dd></div>
                <div className="detail-row"><dt>时间范围</dt><dd>{selectedVersion.timeRange}</dd></div>
                <div className="detail-row"><dt>最小样本</dt><dd>{selectedVersion.minSample.toLocaleString()}</dd></div>
              </dl>
            </div>
            <div className="detail-card">
              <h4>热力结果与样本覆盖率</h4>
              <p className="muted small">
                版本ID {selectedVersion.id} · 生成时间 {new Date(selectedVersion.calculatedAt).toLocaleString('zh-CN')}
              </p>
              <CoverageBar version={selectedVersion} />
              <p className="detail-note">
                发布粒度：以「热力方案 × 结果版本 × 图表配置」为最小发布单元，版本一经发布即固定。
              </p>
            </div>
          </div>
        )}
      </article>

      {/* 第二步：选择图表配置并核对源字段 */}
      <article className="panel">
        <h3 className="panel-title">② 选择图表配置（DATA）并核对源字段</h3>
        <div className="panel-controls">
          <label className="filter-item">
            <span>图表配置</span>
            <select value={dataVizCode} onChange={(event) => setDataVizCode(event.target.value)}>
              {dataVizList.map((row) => (
                <option key={String(row.id)} value={String(row['配置编号'])}>
                  {String(row['配置编号'])} · {String(row['图表名称'])}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedChart && (
          <div className="two-col">
            <div className="detail-card">
              <h4>DATA 图表源字段（{dataVizCode}）</h4>
              <dl>
                <div className="detail-row"><dt>图表类型</dt><dd>{String(selectedChart['图表类型'])}</dd></div>
                <div className="detail-row"><dt>数据源</dt><dd>{String(selectedChart['数据源'])}</dd></div>
                <div className="detail-row"><dt>X轴字段</dt><dd>{String(selectedChart['X轴字段'])}</dd></div>
                <div className="detail-row"><dt>Y轴字段</dt><dd>{String(selectedChart['Y轴字段'])}</dd></div>
                <div className="detail-row"><dt>刷新间隔</dt><dd>{String(selectedChart['刷新间隔'])}</dd></div>
              </dl>
            </div>
            <div className="detail-card">
              <h4>双侧字段核对</h4>
              <table className="data-table check-table">
                <thead>
                  <tr><th>核对项</th><th>HEAT 侧</th><th>DATA 侧</th><th>结果</th></tr>
                </thead>
                <tbody>
                  {fieldChecks.map((check) => (
                    <tr key={check.item}>
                      <td>{check.item}</td>
                      <td>{check.heatValue}</td>
                      <td>{check.chartValue}</td>
                      <td>
                        <span className={check.result === 'pass' ? 'tag tag-ok' : 'tag tag-warn'}>
                          {check.result === 'pass' ? '一致' : '待确认'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="detail-note">字段不一致仅提示人工确认；发布硬闸门只有最小样本覆盖率。</p>
            </div>
          </div>
        )}
      </article>

      {/* 第三步：保存草稿 / 提交发布 */}
      <article className="panel">
        <h3 className="panel-title">③ 生成图表草稿与提交发布</h3>
        <div className="panel-controls">
          <label className="filter-item grow">
            <span>草稿名称（可留空，默认按页面与图表名拼接）</span>
            <input value={draftName} placeholder="例如：商详滚动深度热力图-发布草稿" onChange={(event) => setDraftName(event.target.value)} />
          </label>
          <button className="btn" type="button" onClick={handleSaveDraft} disabled={!selectedVersion}>
            保存图表草稿
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={handlePublish}
            disabled={!selectedVersion || !selectedVersion.qualified}
            title={selectedVersion && !selectedVersion.qualified ? '覆盖率未达最小样本，只能保存草稿' : ''}
          >
            提交发布
          </button>
        </div>
        {selectedVersion && !selectedVersion.qualified && (
          <p className="inline-msg bad">
            当前版本覆盖率 {selectedVersion.coverageRate.toFixed(2)} 未达最小样本 {selectedVersion.minSample}，
            发布按钮已禁用，仅可保存草稿；导入外部回执补足样本并达标后才能发布。
          </p>
        )}
        {selectedVersion?.qualified && (
          <p className="inline-msg ok">覆盖率已达标，提交发布将固定 {heatCode} 第 {selectedVersion.versionNo} 版，后续重算不影响该图表。</p>
        )}

        <h4 className="sub-title">图表草稿</h4>
        <table className="data-table">
          <thead>
            <tr>
              <th>草稿编号</th><th>草稿名称</th><th>热力方案/版本</th><th>图表配置</th>
              <th>覆盖率</th><th>状态</th><th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft: ChartDraft) => (
              <tr key={draft.id}>
                <td>{draft.id}</td>
                <td>{draft.name}</td>
                <td>{draft.heatCode} · 第 {draft.heatVersionNo} 版</td>
                <td>{draft.dataVizCode}</td>
                <td>
                  <span className={draft.qualified ? 'tag tag-ok' : 'tag tag-bad'}>
                    {draft.coverageRate.toFixed(2)} {draft.qualified ? '达标' : '未达标'}
                  </span>
                </td>
                <td>{draft.status}</td>
                <td>{new Date(draft.updatedAt).toLocaleString('zh-CN')}</td>
              </tr>
            ))}
            {drafts.length === 0 && (
              <tr><td className="empty-state" colSpan={7}>还没有草稿，选择方案与图表配置后保存</td></tr>
            )}
          </tbody>
        </table>
      </article>

      {/* 第四步：发布记录（当前图表与留档） */}
      <article className="panel">
        <h3 className="panel-title">④ 图表发布记录（同一热力版本重复发布只保留一个当前图表，旧版本按发布时间留档）</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>记录编号</th><th>发布批次</th><th>热力方案/固定版本</th><th>图表配置</th>
              <th>发布时间</th><th>回执</th><th>线上状态</th><th>追溯</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record: ChartPublishRecord) => (
              <tr key={record.id}>
                <td>{record.id}</td>
                <td>{record.batchNo}</td>
                <td>{record.heatCode} · 第 {record.heatVersionNo} 版（固定）</td>
                <td>{record.dataVizCode}</td>
                <td>{new Date(record.publishedAt).toLocaleString('zh-CN')}</td>
                <td>{record.receiptNo ?? '—'}</td>
                <td>
                  <span className={record.current ? 'tag tag-ok' : 'tag tag-muted'}>
                    {record.current ? '当前图表' : '已归档'}
                  </span>
                </td>
                <td className="row-actions">
                  <button className="link" type="button" onClick={() => setDetailRecord(record)}>查看详情</button>
                  <button className="link" type="button" onClick={() => setTraceCode(record.heatCode)}>
                    方案侧追溯
                  </button>
                </td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr><td className="empty-state" colSpan={8}>暂无发布记录</td></tr>
            )}
          </tbody>
        </table>
      </article>

      {/* 第五步：发布批次与外部回执 */}
      <article className="panel">
        <h3 className="panel-title">⑤ 发布批次与外部回执（文件解析后进入当前批）</h3>
        <div className="panel-controls">
          <div className="batch-box">
            <span className="muted">当前批次：</span>
            {batch ? (
              <>
                <strong>{batch.batchNo}</strong>
                <span className="tag tag-ok">{batch.status}</span>
                <span className="muted small">开批时间 {new Date(batch.openedAt).toLocaleString('zh-CN')}</span>
              </>
            ) : (
              <>
                <strong className="muted">无打开批次</strong>
                <span className="tag tag-muted">已截止</span>
              </>
            )}
          </div>
          <label className={`btn file-btn${batch ? '' : ' disabled-btn'}`}>
            导入外部回执（.csv / .json）
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={handleReceiptFile}
              hidden
              disabled={!batch}
            />
          </label>
          <button className="btn" type="button" onClick={() => downloadText('外部回执模板.csv', receiptTemplateCsv())}>
            下载回执模板
          </button>
          <button className="btn primary" type="button" onClick={handleOpenBatch} disabled={!!batch}>
            开新批次
          </button>
          <button className="btn ghost" type="button" onClick={handleCloseBatch} disabled={!batch}>
            关闭当前批次
          </button>
        </div>
        {!batch && (
          <p className="inline-msg bad">批次已截止，回执导入与图表发布均被拦截；点击「开新批次」恢复写入。</p>
        )}
        <h4 className="sub-title">当前批回执（{receipts.length} 条）</h4>
        <table className="data-table">
          <thead>
            <tr>
              <th>回执编号</th><th>批次</th><th>热力方案/版本</th><th>回执样本量</th>
              <th>来源文件</th><th>导入时间</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt: ExternalReceipt) => (
              <tr key={receipt.id}>
                <td>{receipt.receiptNo}</td>
                <td>{receipt.batchNo}</td>
                <td>{receipt.heatCode} · 第 {receipt.heatVersionNo} 版</td>
                <td>{receipt.sampleSize.toLocaleString()}</td>
                <td>{receipt.sourceFile}</td>
                <td>{new Date(receipt.importedAt).toLocaleString('zh-CN')}</td>
              </tr>
            ))}
            {receipts.length === 0 && (
              <tr><td className="empty-state" colSpan={6}>当前批暂无回执，导入文件解析后在此显示</td></tr>
            )}
          </tbody>
        </table>
        <h4 className="sub-title">全部批次</h4>
        <table className="data-table">
          <thead>
            <tr><th>批次编号</th><th>状态</th><th>开批时间</th><th>关批时间</th></tr>
          </thead>
          <tbody>
            {batches.map((item: PublishBatch) => (
              <tr key={item.batchNo}>
                <td>{item.batchNo}</td>
                <td>{item.status}</td>
                <td>{new Date(item.openedAt).toLocaleString('zh-CN')}</td>
                <td>{item.closedAt ? new Date(item.closedAt).toLocaleString('zh-CN') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      {detailRecord && (
        <Modal title={`发布记录详情 ${detailRecord.id}`} onClose={() => setDetailRecord(null)}>
          <PublishRecordDetail record={detailRecord} />
        </Modal>
      )}
      {traceCode && (
        <Modal title={`热力方案 ${traceCode} 的发布追溯`} onClose={() => setTraceCode(null)}>
          <table className="data-table">
            <thead>
              <tr><th>记录编号</th><th>固定版本</th><th>图表配置</th><th>发布时间</th><th>状态</th></tr>
            </thead>
            <tbody>
              {traceRecords.map((record) => (
                <tr key={record.id}>
                  <td>{record.id}</td>
                  <td>第 {record.heatVersionNo} 版</td>
                  <td>{record.dataVizCode}</td>
                  <td>{new Date(record.publishedAt).toLocaleString('zh-CN')}</td>
                  <td>{record.current ? '当前图表' : '已归档'}</td>
                </tr>
              ))}
              {traceRecords.length === 0 && (
                <tr><td className="empty-state" colSpan={5}>该方案暂无发布记录</td></tr>
              )}
            </tbody>
          </table>
        </Modal>
      )}
    </section>
  )
}

import type { ChartPublishRecord } from '@/data/heat-publish/types'

// 发布记录详情：固定的方案版本快照 + 图表配置快照 + 字段核对，体现「版本固定、可追溯」。
export default function PublishRecordDetail({ record }: { record: ChartPublishRecord }) {
  const heatFields: [string, string | number][] = [
    ['页面名称', record.heatSnapshot.pageName],
    ['热力类型', record.heatSnapshot.heatType],
    ['聚合级别', record.heatSnapshot.aggregation],
    ['时间范围', record.heatSnapshot.timeRange],
    ['最小样本', record.heatSnapshot.minSample],
    ['实际样本', record.heatSnapshot.sampleSize],
    ['覆盖率', record.heatSnapshot.coverageRate.toFixed(2)],
  ]
  const chartFields: [string, string | number | boolean][] = [
    ['配置编号', record.dataVizCode],
    ...Object.entries(record.chartSnapshot).filter(([key]) => key !== 'id' && key !== 'status' && key !== 'pending' && key !== 'abnormal'),
  ]
  return (
    <div className="detail-grid">
      <section className="detail-card">
        <h4>固定的热力方案版本（HEAT）</h4>
        <dl>
          {heatFields.map(([label, value]) => (
            <div className="detail-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="detail-note">
          方案编号 {record.heatCode} · 第 {record.heatVersionNo} 版 · 版本ID {record.heatVersionId}
        </p>
      </section>
      <section className="detail-card">
        <h4>发布时刻的图表配置快照（DATA）</h4>
        <dl>
          {chartFields.map(([label, value]) => (
            <div className="detail-row" key={label}>
              <dt>{label}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="detail-card detail-wide">
        <h4>源字段核对结果</h4>
        <table className="data-table">
          <thead>
            <tr>
              <th>核对项</th>
              <th>热力方案侧</th>
              <th>图表配置侧</th>
              <th>结果</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {record.fieldChecks.map((check) => (
              <tr key={check.item}>
                <td>{check.item}</td>
                <td>{check.heatValue}</td>
                <td>{check.chartValue}</td>
                <td>
                  <span className={check.result === 'pass' ? 'tag tag-ok' : 'tag tag-warn'}>
                    {check.result === 'pass' ? '一致' : '待确认'}
                  </span>
                </td>
                <td className="muted">{check.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

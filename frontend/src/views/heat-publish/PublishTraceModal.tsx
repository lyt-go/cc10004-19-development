import { useMemo, useState } from 'react'

import { listPublishRecords, recordsOfDataViz } from '@/api/heat-publish-service'
import Modal from './Modal'
import PublishRecordDetail from './PublishRecordDetail'
import type { ChartPublishRecord } from '@/data/heat-publish/types'

// 双向追溯共用弹窗：热力方案详情与图表配置详情两侧都能打开，看到同一批发布记录。
export default function PublishTraceModal({
  code,
  kind,
  onClose,
}: {
  code: string
  kind: 'heat' | 'dataviz'
  onClose: () => void
}) {
  const [detail, setDetail] = useState<ChartPublishRecord | null>(null)
  const records = useMemo(
    () => (kind === 'heat' ? listPublishRecords(code) : recordsOfDataViz(code)),
    [code, kind],
  )

  return (
    <Modal
      title={`${kind === 'heat' ? '热力方案' : '图表配置'} ${code} 的图表发布追溯`}
      onClose={onClose}
    >
      <p className="detail-note">
        发布记录固定热力方案版本与图表配置快照；热力重算只追加新版本，不会替换下表中的已上线图表。
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>记录编号</th>
            <th>发布批次</th>
            <th>热力方案/固定版本</th>
            <th>图表配置</th>
            <th>发布时间</th>
            <th>回执</th>
            <th>线上状态</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
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
              <td>
                <button className="link" type="button" onClick={() => setDetail(record)}>
                  查看详情
                </button>
              </td>
            </tr>
          ))}
          {records.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={8}>该{kind === 'heat' ? '方案' : '图表配置'}暂无图表发布记录</td>
            </tr>
          )}
        </tbody>
      </table>
      {detail && (
        <Modal title={`发布记录详情 ${detail.id}`} onClose={() => setDetail(null)}>
          <PublishRecordDetail record={detail} />
        </Modal>
      )}
    </Modal>
  )
}

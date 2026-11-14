import type { HeatVersion } from '@/data/heat-publish/types'

// 覆盖率展示：样本数 / 最小样本 + 覆盖率百分比 + 达标进度条，未达标红色、达标绿色。
export default function CoverageBar({ version }: { version: HeatVersion }) {
  const percent = Math.min(100, Math.round(version.coverageRate * 100))
  return (
    <div className="coverage">
      <div className="coverage-head">
        <span className={version.qualified ? 'tag tag-ok' : 'tag tag-bad'}>
          {version.qualified ? '覆盖率达标' : '未达最小样本'}
        </span>
        <span className="coverage-num">
          样本 {version.sampleSize.toLocaleString()} / 最小 {version.minSample.toLocaleString()}
          （{version.coverageRate.toFixed(2)}）
        </span>
      </div>
      <div className="coverage-track">
        <div
          className={version.qualified ? 'coverage-fill ok' : 'coverage-fill bad'}
          style={{ width: `${percent}%` }}
        />
        <span className="coverage-marker" style={{ left: '100%' }} title="最小样本线" />
      </div>
    </div>
  )
}

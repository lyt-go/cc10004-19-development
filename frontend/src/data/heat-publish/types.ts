/** 热力发布领域的公共类型：方案版本、图表草稿、发布记录、发布批次与外部回执。 */

/** 热力结果版本：每次重算生成一条不可变记录，已发布图表固定引用具体版本。 */
export type HeatVersion = {
  id: string
  heatCode: string
  versionNo: number
  /** 生成（重算）时间，ISO 字符串 */
  calculatedAt: string
  /** 聚合级别，直接取自热力方案，保证与页面聚合一致 */
  aggregation: string
  timeRange: string
  minSample: number
  sampleSize: number
  coverageRate: number
  /** 达到最小样本才允许发布 */
  qualified: boolean
}

/** 图表草稿：由热力方案生成，可在覆盖率不足时保存但不能发布。 */
export type ChartDraft = {
  id: string
  heatCode: string
  heatVersionId: string
  heatVersionNo: number
  dataVizCode: string
  /** 草稿名称，默认由方案与图表配置拼接 */
  name: string
  /** 草稿状态：草稿 / 已发布（发布后保留为留档快照） */
  status: '草稿' | '已发布'
  /** 源字段核对结果快照，保存草稿时计算 */
  fieldChecks: FieldCheck[]
  coverageRate: number
  qualified: boolean
  createdAt: string
  updatedAt: string
}

/** 热力方案与图表源字段之间的单项核对结果。 */
export type FieldCheck = {
  item: string
  heatValue: string
  chartValue: string
  /** pass=一致；warn=不匹配（提示人工核对，不阻断发布） */
  result: 'pass' | 'warn'
  note: string
}

/** 图表发布记录：发布成功后不可变，固定方案版本与图表配置快照。 */
export type ChartPublishRecord = {
  id: string
  batchNo: string
  heatCode: string
  heatVersionId: string
  heatVersionNo: number
  dataVizCode: string
  chartName: string
  /** 发布时刻的图表配置全量快照，后续重算或改配置都不影响已上线图表 */
  chartSnapshot: Record<string, string | number | boolean>
  /** 发布时刻的方案版本快照 */
  heatSnapshot: {
    pageName: string
    heatType: string
    aggregation: string
    timeRange: string
    minSample: number
    sampleSize: number
    coverageRate: number
  }
  fieldChecks: FieldCheck[]
  /** 当前图表 / 已归档（同方案+图表配置再次发布后，旧记录按发布时间留档） */
  current: boolean
  publishedAt: string
  /** 回执关联后回填 */
  receiptNo: string | null
}

/** 外部回执：文件解析后进入当前批，回填版本覆盖率并关联发布记录。 */
export type ExternalReceipt = {
  id: string
  batchNo: string
  receiptNo: string
  heatCode: string
  heatVersionNo: number
  sampleSize: number
  sourceFile: string
  importedAt: string
}

/** 发布批次：一个打开的批次承载期间的发布记录与回执，关闭后不可再写入。 */
export type PublishBatch = {
  batchNo: string
  status: '打开' | '已关闭'
  openedAt: string
  closedAt: string | null
}

/** 热力发布领域的持久化根状态。 */
export type HeatPublishState = {
  versions: HeatVersion[]
  drafts: ChartDraft[]
  records: ChartPublishRecord[]
  batches: PublishBatch[]
  receipts: ExternalReceipt[]
  seq: { version: number; draft: number; record: number; batch: number; receipt: number }
}

export type ServiceResult<T = undefined> = {
  ok: boolean
  message: string
  data?: T
}

import type { ReactNode } from 'react'

// 轻量弹窗：发布追溯与发布详情共用，纯展示 + 关闭。
export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="modal-mask" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal-box" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost" type="button" onClick={onClose}>关闭</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

import { Button, Space, Tooltip } from 'antd'
import { UndoOutlined, RedoOutlined } from '@ant-design/icons'

export function FileUndoRedo({ onUndo, onRedo, canUndo, canRedo }) {
  return (
    <Space>
      <Tooltip title="撤销">
        <Button
          icon={<UndoOutlined />}
          size="small"
          disabled={!canUndo}
          onClick={onUndo}
        />
      </Tooltip>
      <Tooltip title="重做">
        <Button
          icon={<RedoOutlined />}
          size="small"
          disabled={!canRedo}
          onClick={onRedo}
        />
      </Tooltip>
    </Space>
  )
}

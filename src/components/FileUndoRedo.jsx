import Button from 'antd/es/button'
import Space from 'antd/es/space'
import Tooltip from 'antd/es/tooltip'
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

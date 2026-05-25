import { Button, Input, Space, Tooltip } from 'antd'
import {
  SearchOutlined,
  PlusOutlined,
  ImportOutlined,
  ExportOutlined,
  DeleteOutlined,
} from '@ant-design/icons'

export function FileToolbar({
  search,
  onSearchChange,
  onNewFile,
  onNewFolder,
  onImport,
  onExport,
  onDeleteSelected,
  hasSelection,
}) {
  return (
    <div className="file-toolbar">
      <Input
        prefix={<SearchOutlined />}
        placeholder="搜索文件..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        allowClear
        size="small"
      />
      <Space>
        <Tooltip title="新建文件">
          <Button icon={<PlusOutlined />} size="small" onClick={onNewFile} />
        </Tooltip>
        <Tooltip title="新建文件夹">
          <Button icon={<PlusOutlined />} size="small" onClick={onNewFolder} />
        </Tooltip>
        <Tooltip title="导入">
          <Button icon={<ImportOutlined />} size="small" onClick={onImport} />
        </Tooltip>
        <Tooltip title="导出">
          <Button icon={<ExportOutlined />} size="small" onClick={onExport} disabled={!hasSelection} />
        </Tooltip>
        <Tooltip title="删除选中">
          <Button
            icon={<DeleteOutlined />}
            size="small"
            danger
            onClick={onDeleteSelected}
            disabled={!hasSelection}
          />
        </Tooltip>
      </Space>
    </div>
  )
}

import { Dropdown } from 'antd'

export function FileContextMenu({ items, onSelect }) {
  const menuItems = [
    { key: 'new-file', label: '新建文件' },
    { key: 'new-folder', label: '新建文件夹' },
    { key: 'rename', label: '重命名' },
    { key: 'delete', label: '删除' },
    { key: 'pin', label: '置顶' },
    { key: 'export', label: '导出' },
  ]

  return (
    <Dropdown
      menu={{
        items: menuItems,
        onClick: ({ key }) => onSelect(key),
      }}
      trigger={['contextMenu']}
    >
      {items}
    </Dropdown>
  )
}

# 4.186.0 — Knowledge OS Phase 2B：WebDAV Transport

## 目标

Phase 2B 把已经在 local-lab 证明过的同步协议接到真实 WebDAV，同时保持完全相同的三方合并、冲突与附件语义。

## 已完成

- 抽象统一 `SyncRemote` transport；local-lab 与 WebDAV 共用同一同步引擎。
- WebDAV 支持 immutable object、content-addressed attachment blob、generation manifest。
- Basic Auth；公网地址强制 HTTPS，HTTP 仅允许 localhost / loopback。
- 设置读取不会回显 WebDAV 密码，只返回是否已保存。
- WebDAV 远端锁使用原子 MKCOL collection lock；过期锁才允许回收。
- “预演同步”严格只读，不创建远端目录、不上传对象、不写本地同步状态。
- 切换 provider / endpoint 时提供显式“重新绑定远端”，只清空 base、旧 remote identity 并 supersede 未决冲突，不删除内容。
- schema 12 增加 WebDAV credential 字段，并同步更新 backup / .lnw / restore / Windows safety guards。

## 保持不变的安全语义

- 不使用 last-write-wins。
- 文本/目录/标签/标签关系继续走三方比较。
- 附件在共享 base 建立后，修改或删除一律进入冲突中心。
- 采用远端附件前永久保留被替换的本机字节。
- candidate manifest 在发布前做完整结构验证。
- 本机事务失败不能提前发布远端 manifest。

## CI 验收

最终 HEAD `dc62c1b6b5f68ef08cfb08dbba169c5cc42688cd` 的 UI Redesign CI #1168 全部通过，包括：

- renderer / Electron main build；
- UI smoke；
- Go backend tests（含 WebDAV 双设备往返）；
- search race / benchmark；
- Windows backend cross-build；
- backend HTTP smoke；
- Electron tests / editor tests；
- Windows .lnw transaction tests；
- Windows NSIS installer build；
- brand / dark theme render；
- packaged Windows application smoke；
- installer artifact upload。

## 下一步：Phase 2C

把“手动可用的 WebDAV”升级为日常可用的自动同步：

- 自动同步开关与可控周期；
- 单实例内禁止重入；
- 启动后延迟同步；
- 网络失败只记录状态，不打断编辑；
- 出现冲突时停止自动推进该冲突，但不替用户选择；
- 手动预演/手动同步始终保留。

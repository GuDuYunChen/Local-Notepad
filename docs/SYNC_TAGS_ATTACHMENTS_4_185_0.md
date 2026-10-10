# 4.185.0 — Knowledge OS Phase 2A.2：Tags + Attachments

## 同步对象

Phase 2A.2 在既有 file record 之外加入三类 namespaced record：

- tag:<id>：标签名称与颜色；
- filetag:<file-id>:<tag-id>：文件-标签关系；
- attachment:<hex(filename)>：附件元数据，包含文件名、大小与 blob SHA-256。

文件对象继续使用原始 file id，保证 Phase 2A manifest/base 兼容。

## 附件 blob

附件二进制不嵌入 JSON object。local-lab 远端使用 blobs/<sha256> 保存不可变内容：

- 上传前对本机普通文件做稳定 stat + SHA-256；
- 流式写入临时 blob，同时再次计算大小/hash；
- 只有校验一致才 no-replace 发布；
- 下载前验证远端 blob 大小与 SHA-256；
- 本机目标使用 no-replace 发布，初始拉取绝不覆盖已有文件。

## 附件冲突策略

附件文件名在建立共同 base 后视为不可变槽位。只要该槽位发生字节修改或删除，不论来自本机还是远端，都进入冲突中心；不自动执行 last-write-wins。

选择远端时：

- 现有本机附件先移动到 sync-preserved；
- 再校验并发布远端 blob；
- 远端 tombstone 只保留旧文件，不直接丢弃。

新设备首次看到一个远端 attachment tombstone 时只记录共同 base，不执行文件删除。

## 标签与关系

同步远端结构在发布和拉取前都验证：

- 标签名大小写折叠后不能重复；
- present file-tag 必须同时引用 present file 和 present tag；
- file/tag 先落地，file-tag 后落地，整个 SQLite 变更仍在单事务内。

## 事务与投影验证

一次同步顺序：

1. 构建三方计划；
2. 暂存不可变 upload objects/blobs，不发布 manifest；
3. 对“本机待上传 + 当前远端”组成的 candidate manifest 做完整结构验证；
4. 初始附件下载以 no-replace 方式暂存/发布；后续失败会清理本次新建文件；
5. 在一个 SQLite transaction 中应用远端 file/tag/relation、base 与 conflict；
6. 所有本机应用成功后才发布新 immutable manifest；
7. 最后提交 SQLite transaction。

如果本机下载事务失败，本次本机上传不会出现在远端 manifest。生产环境 SQLite 仅一个连接，因此 device id 在开启事务前读取，避免事务内重新借连接造成死锁。

## 已覆盖测试

- file + tag + file-tag + attachment 两设备往返；
- attachment mutation 必须冲突；
- 采用远端附件时旧字节永久保留；
- blob 篡改拒绝；
- dangling tag relation 拒绝；
- 独立设备同目录同名文件/同名标签的 projected merge 在发布前拒绝；
- 本机 apply 失败不得提前发布 unrelated upload manifest。

下一步 Phase 2B：抽象真正 transport 并接 WebDAV，同时复用相同 record/manifest/three-way/conflict 语义。

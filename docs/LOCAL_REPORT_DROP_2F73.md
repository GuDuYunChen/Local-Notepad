# 2F.73 / 4.206.0 — 拖放打开离线统计报告（提交前记录）

基线 d12b106c4d2671081161eb1132ba4f12c7dab263 / 4.205.0 已在 PR #2 评论6095954991验收。复查当前ref/PR、原文件读取及导出链路和历史清单，无新增已确认上一阶段阻塞；不重跑上一阶段成功CI或重新发布旧安装包。

## 本次范围

更多 → 设置 → 本地只读盘点 → 查看已导出的统计报告：新增单文件拖放区域，保留原有可用键盘操作的文件选择与清除按钮。只在明确drop时取得File；悬停仅检查类型，不读取保护模式下的files，不枚举文件系统。拖入一份报告后使用原readLocalOverviewFile、完整UTF-8/JSON/重复键/数量/4KiB和五秒绝对截止校验；扩展名或MIME不作为真实性证明。

多文件、文字、链接、可识别目录和不可用拖放数据给固定说明并保留现有视图；不选择第一个文件凑结果、不遍历目录、读取链接、导入笔记或触发上传。所有区域拖放事件先preventDefault及stopPropagation，防止拒绝后的文件落入应用普通导入链。目录元数据不可用时仍由原FileReader/解析器完整拒绝不合格输入，不作目录内容回退。

单文件已被接受后立刻撤销旧读取及比较结果；校验失败不恢复旧成功。重复拖同文件是明确新读取；A→B→A、迟到结果、清除、超时和卸载沿用原保护。错误多选不撤销正在读取的已选文件。未新增自动扫描、网络、剪贴板、持久化、数据库改动或后台任务。原HTML/JSON/CSV及全部12指标导出保持。

## 验证

本地原相关74/74通过；新增12项共享准入测试和原集合合计86/86，0失败/跳过。只去掉多文件拒绝守卫的隔离副本由原断言检出，已恢复且不发布。新增12项React测试覆盖嵌套悬停、真实File对象转交原读取器、父导入隔离、拒绝保留、编码/大小拒绝、A→B→A、超时、卸载和比较导出失效。JSX仅本地语法检查，当前环境未装React测试依赖，不能提前把12项写成已执行通过。

原Windows文件查看/报告/保存/退出检查不替换，只在原文件查看结束后追加真实Chromium Input.dispatchDragEvent，传入测试专用实际文件路径。必须由新HEAD验证实际FileReader及数量/精确容量、多文件/文字拒绝保留、坏JSON撤销、重新拖入、页面未导航、全部笔记列表及正文未变，并保存独立PNG/JSON。此为隔离测试数据，不触及用户真实笔记。

历史46条产品/环境记录和12类助手执行事故保留。catalog只验证46/27/39关联，不作历史测试已执行证明。本地由现有源码归档和已交付变更文件恢复，相关修改文件与远端精确blob匹配，不声称完整当前检出。普通Git一次DNS失败后停止。一次过宽组件目录读取产生截断响应后未重复抓取，随后只读已知文件；该执行问题不是产品失败或聊天断流根因。

## 版本及交付纪律

新功能显式version:minor，4.205.0→4.206.0；提交前previous-version检查通过，三处版本一致，679依赖节点、resolved/integrity及schema14不变。旧测试断言/工作流、正文保存与退出实现不改。当前HEAD预期UI3023（原2999+12共享+12React）是核对目标，不是通过记录。须新HEAD原全CI、原始产物、实际Windows拖放与全部旧功能及4.206.0真实内部安装版本完成后才写最终验收。

仍仅feature/knowledge-os-phase2 / Draft PR #2；不合master、强推、打tag或生产发布，不新建Work/Codex或自动任务。最终状态写PR和交付，不为补说明再次提交源码或重复增版本。聊天平台断流底层原因未知。

API核对：MDN DataTransfer.files（drop事件中可读，悬停为保护模式）；Chrome DevTools Protocol Input.dispatchDragEvent / DragData（files及copy mask）。
https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/files
https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchDragEvent

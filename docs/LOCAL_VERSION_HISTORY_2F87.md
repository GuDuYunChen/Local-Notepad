# 2F.87 / 4.220.2 本地版本历史与安全恢复

基线048a9ca /4.219.1，上一回收站与真实安装生命周期验收6140762411保持；不重做已完成工作、不发展云或多端功能。

本模块从原笔记详情→历史进入，涵盖真实历史读取/空列表/格式与网络错误/手动重试，查找和纯文本分页对照，所选快照确认与再次读取核对，原编辑器草稿/保存/冲突/文档生命周期保护，同一原保存事务中的恢复前快照与正文恢复，真实回执、错误保留草稿、原保存重试、关闭与切换笔记后隔离。不会把最新历史行说成当前版本；第一条历史行也可以恢复。

只恢复完整原始正文，不恢复标题、标签、位置。预览为纯文本，不展示图片等嵌入对象；不以预览截取代替完整内容。必须先确认当前草稿保存完成；不自动丢弃未保存内容。使用TextEditor现有saveNow/commitEditorSave及Go SaveEditor，不调用旧versions/{id}/restore POST、不增加第二套数据库写入。SaveEditor原有原子前快照、期望正文比较、不可变请求回执、引用维护与退出保护保留。

读取遵守生产DAO的null空结果与50条上限；10秒读取预算，关闭/切换废弃旧读取。确认绑定笔记、加载代次、编辑/退出边界、数据库修订及当前正文；预检后再次同步核对，任何新编辑/切换/保存冲突都拒绝旧确认。采用后保存失败时历史正文仍是编辑器草稿，未确认不等于数据库回滚；由原编辑器重试或冲突处理接续。保存回执后用户新编辑不会被迟到成功覆盖。重新读取历史失败与已取得的保存回执分别呈现。

历史风险：旧VersionHistory把读取失败/非法数据默认为空；第一条旧快照被误称当前版本；原直写恢复绕开草稿保护与保存回执。新服务/真实React/原TextEditor及真实Windows桌面测试覆盖这些路径。原46问题和12执行事故仍分别保留；本轮读取和执行错误放本地交付，不把它们当产品功能数量或聊天断流根因。

所有原生产Go/Electron、schema14、679依赖节点和原工作流保持。版本由真实npm version:minor升4.220.0。辅助ci/local-history-2f87只应用固定基线范围、执行模块测试/构建并生成大文件Git blobs；不更新产品ref，其测试不是产品提交后的最终验收。最终产品必须当前HEAD全量回归、原Windows保存退出与新增历史链路、打包及产物核验通过。源码脚本存在不算运行通过；验收另写PR和交付，不制造状态专用提交。

## Windows operation-area repair / 4.220.1

Current-source c79d8a0 Windows artifact11802740854 passed real history read, first-snapshot restore and dirty-draft admission, then its explicit-save click was intercepted by the fixed reference-maintenance banner. Preserve the original failure screenshot and original native click, not a JavaScript click bypass. The panel now reserves measured bottom scroll clearance for that visible, horizontally overlapping banner, updates it on appearance/resize/removal and cleans up observers on unmount. The reference notice and its retry remain fully functional. Added two DOM layout contracts; the native helper now also checks actual hit testing before dispatching the original mouse input. Same module, normal patch version4.220.1, unchanged save/Go/Electron/installer/schema and679 dependency nodes. Complete current-source regression, actual desktop and installation gates remain mandatory.

## Global-layout integration completion / 4.220.2

The first clearance patch88a22aa/4.220.1 still failed native hit testing because legacy .inspector-panel .version-history important padding and flex/min/max-height rules overrode it. The final scoped selector explicitly replaces only the old history layout: inspector-body owns outer scrolling, list and preview remain bounded, measured bottom padding wins the legacy important rule. Actual Chromium with production component and captured full global styles reproduced baseline12px/flex/280px/intercepted-click and verified corrected104px/block/no-max-height plus one actual save-button click in both themes at1008px and390px. Its API/editor were layout fixtures, not a production backend. Two additional source-style regression contracts retain these integration overrides. Full current-source Windows and installation gates still required. No save/Go/Electron/installer/schema or dependency-graph changes.

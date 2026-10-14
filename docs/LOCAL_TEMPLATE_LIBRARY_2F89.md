# 2F.89 / 4.222.2 本地文本模板库与安全创建

基线 d002c8870af32eee85c4730e2db1d240a93f118a /4.221.1，每日笔记及实际安装验收6158925298保持历史有效，不重做。当前仅本地模板模块，不开发云、多端或其它模块。

## 完整流程与范围

新建笔记 → 内置模板或“管理我的模板” → 模板完整读取/搜索分页/纯文本预览 → 新建/编辑模板或从预览创建独立文本笔记 → 原编辑器打开和保存 → 模板移除与恢复 → 操作查回/同请求重试/明确清除本机记录。进入、预览和重新打开不自动创建。空白笔记旧入口不变，非空内置模板在实际App中进入同一有回执的创建通道。

模板保存于原files根目录__tpl__名称，与现有备份及30天删除清理规则一致。正文编辑支持多行文本；旧富文本模板只改名、不自动转换原文，创建时明确复制文本，不复制图片/附件等嵌入对象。独立副本不覆盖模板或当前笔记。目标目录在事务中再次验证，失效不改存根目录。

新增模板/笔记复用已有research_note_requests不可变回执和原原子文件/FTS/链接事务，不增加schema表或数据库版本。修改、移除和恢复使用原值比较，并在SQL内验证根目录、模板前缀和非文件夹身份；旧DELETE /templates/{id}同样受保护，不能删除普通笔记。并发改名同名冲突拒绝；服务端已完成而回执丢失时先只读核对，不盲目创建新ID。

模板正文由已锁定Lexical序列化契约验证，避免新建即“未保存”的旧缺陷。模板草稿保存在本机应用配置，保存失败时保留内存并阻止原生退出；明确放弃才清除。操作编号与完整内容在写入前落地，存储失败零请求；关闭/超时不表示服务端回滚。旧操作查回不能清除新草稿。损坏操作只能在明确确认后按原字节清除，不执行损坏数据。

## 本轮问题与防复发

- TEMPLATE-01：旧模板删除未核验类型，普通笔记ID可进入删除路径。新SQL模板身份门槛、Go反例和真实Windows原接口拒绝验证保留。
- TEMPLATE-02：内置选择与已保存模板分离；缺少可复用模板完整管理。新库统一读取/管理/安全创建副本，旧独立选择器回调契约保留。
- TEMPLATE-03：未知创建回执导致重试重复、旧核对覆盖新草稿。使用持久请求ID、原后端回执及独立草稿生命周期，核心和React负例覆盖。

原46条产品/环境索引、12类助手执行事故继承；上述是当前模块补充，非断流根因证明。源代码与提交前测试不等于当前HEAD验收。必须原全量UI/Go/Electron、真实Windows完整模块和保存退出、新安装包、安装升级卸载重装及原始产物全部核验后完成。原工作流、依赖679节点、schema14、保存/历史/每日/回收站/引用/退出保护保持。不为最终状态再造源码提交。

## Text fidelity repair / 4.222.1

Reproduced the existing general text extractor trimming leading/trailing spaces and collapsing empty paragraphs when creating a template copy. Canonical text templates now use lossless paragraph decoding for both preview and the exact new-note payload. Legacy non-Lexical JSON stays literal editable text. Rich-template text-only extraction remains explicitly labeled and never rewrites the original rich body. Added actual React creation and legacy-edit regressions, preserving byte-equality serializer and original editor/receipt assertions. Same module, no cloud features or schema changes.

## Original list-to-editor handoff

Windows b1dc870 passed template create/edit but the copied note was not kept selected. The old asynchronous list refresh called an App metadata callback captured for the prior note after selecting the copy, restoring the old identity. The new handoff synchronously publishes the updated list before selecting the validated copy, with no trailing stale load. Original App/save/navigation guards remain unchanged. A real FileList/React-parent regression reproduces old-note selection before the fix and verifies the new identity after all callbacks settle; Windows still uses actual clicks and original editor.

## Passive notification obstruction / 4.222.2

Actual Windows53d3657 artifact11869770639 completed the first10 template checks, then a visible saved toast intercepted the final return button. ToastViewport renders text-only status/alert notifications, with no interactive controls. Change only their CSS pointer-events from auto to none; retain text, roles, timers and closing behavior, do not hide notifications or bypass the real mouse test. Eight React/style contracts preserve the original behavior and reject the old CSS. The native workflow now keeps a real persistent success notification visible while the original hit-tested mouse returns to the selector, then cleans up the owned notification. All prior template, editor, daily, history, trash and installer checks remain required. Standard patch4.222.2; original Go/Electron/schema14 and679 dependency nodes unchanged.

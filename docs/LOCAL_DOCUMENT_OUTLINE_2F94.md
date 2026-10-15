# 2F.94 /4.227.1 本地文档大纲与安全章节导航

基线921cb25 /4.226.0文内查找与安全替换已经由PR2评论6188125472验收。先保留上一模块，不重复功能提交；当前模块完成目录入口、空/单标题解释、当前正文完整标题读取、字面/中文输入查找、上下章节、准确定位与返回、折叠/展开/搜索揭示、当前位置/光标、复制章节锚点与引用、失败/取消/切换隔离、原正文保存和安装生命周期。

旧目录隐藏少于两个标题的入口；同名完整章节路径直接采用首项；剪贴板fallback返回false也显示已复制。这三项通过原组件负对照复现。新目录总是可打开，空状态明确；同名路径拒绝自动定位或复制，但列表每个条目的Lexical键可直接定位。同名路径需要用户选择，不修改标题来强制去重。

导航和折叠只读正文。折叠只改变自有DOM显示属性并保留/恢复原display；搜索可找到折叠项并展开上级。原正文内悬浮折叠、光标返回、章节路径事件、引用复制、结构入口、阅读进度保留。确认正文加载身份后才采用标题，导航延迟帧在关闭、正文更新、滚轮或切换后失效；重新核对目标Lexical节点、当前根及标题，不用旧DOM直接跳转。不修改正文、selection保存政策或新建数据库写入，不要求额外保存解除导航。

复制通过原系统剪贴板，fallback必须实际返回成功。5秒等待预算、拒绝/不支持提示及卸载取消；取消/超时不保证操作系统剪贴板未被迟到写入，只不伪报成功或保存旧笔记的最近引用。引用/标题没有复制到服务器。隐藏嵌套编辑器的标题不进入主文档目录；只采集主根的顶层h1–h6。完整预算10000块/500标题、单标题4000 UTF-16单位/总100000、查询200；超限明确错误，不截断后当作完整目录。显示名称仅规范空白，正文不重写。

新增模型/剪贴板、真实Lexical生命周期及原缺陷负对照，全部原回归保留。Windows新增12检查点，包含空/单标题、精确滚动返回、折叠搜索、真实系统剪贴板、歧义拒绝、未保存草稿独立、原保存及切换重开。保留全部旧文内查找、反链、标签、快速、模板、每日、历史、回收站与保存退出链路。

本文件定义源码范围，不预先声称当前HEAD验收。当前提交全量UI/Go/Electron、原生Windows、新NSIS及首装/升级/覆盖/卸载重装/数据保留核验后才完整交付。标准minor4.227.0，schema14及679依赖节点不变。原46产品/环境记录与12助手执行类别分别保留；本轮本地源码恢复先按Git树校验，不把归档中受gitignore影响的已跟踪文件遗漏为产品删除。容器DNS失败和离线npm缓存缺失只尝试一次，不重试被拒的源码/依赖导出。不宣称能修复聊天平台断流。

## Foreground integration repair / 4.227.1

Current-source Windows artifact11962670690 failed before outline acceptance because the new permanent single-heading outline trigger at layer55 covered the find panel next-match button at layer50. Complete original CSS and actual Chromium pointer coordinates reproduced the intercepted1008px light/dark clicks; at600px baseline was already reachable. Closed outline now sits at49, while an explicitly opened outline keeps its original layer55. Ctrl+F/H and current-note open-search yield the open outline, cancel its pending navigation and preserve existing search query/options. IME, other-document and unrelated shortcuts are ignored. No toast hiding, synthetic click or relaxed assertion. Six real Lexical/React/style contracts and the additional native search-to-outline handoff retain the earlier12 native checkpoints. Same module, standard patch4.227.1, original save/backend/installer/schema and679 dependency nodes unchanged. Original failure remains evidence; current-HEAD native and installation still required.

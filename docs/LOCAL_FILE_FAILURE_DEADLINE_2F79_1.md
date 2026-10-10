# 2F.79.1 / 4.212.1 — 离线文件失败路径的截止复核

基线231da61c56ba97251f08e561c9dec4fbdc6a31c4 /4.212.0已由PR #2评论6099207740验收；不重做上阶段批次拖放或验收回写。

## 复现与修正

readLocalOverviewFile在load开始检查截止，成功解码和解析后也检查。但结果不是ArrayBuffer、字节数不符或UTF-8解码失败时直接返回read/encoding，没有复核这一段处理期间是否已超过五秒或时钟失效。迟到定时回调不能替代绝对截止检查。新16项确定性测试使用真实生产读取函数、局部readerFactory/clock替身模拟结果取得期间暂停；旧精确blob321b8a900df85a384ec839d3ec83e56f9435cdbf上8通过/8失败。

仅在这两条错误返回路径复用既有stopped检查：已取消优先，合法时钟过期返回timeout，失效时钟返回read；期限前仍按原来的read/encoding分类。首次结果不被迟到回调覆盖，自有reader/定时器/监听器清理保持，4KiB、UTF-8、完整统计、五秒预算及批次不部分采用均不变。没有更改成功数据、文件格式、界面、主进程、后端、保存/退出或工作流。

该复现是测试控制的暂停/异常路径，不是用户文件损坏或实际Windows发生相同暂停的证据。接口事件本身无法保证定时回调准时执行；依据MDN Window.setTimeout的延迟说明及FileReader.result的类型说明。此修补不证明OS操作可撤销、跨文件原子性或ChatGPT断流已解决。

## 本地记录与当前提交验收要求

修补后的新16、原文件34和原批次20共70项通过；两组拖放28项在恢复缺失辅助源码后通过，总计98项且范围不重叠。保留第一次局部恢复导致两入口加载失败的日志，不把缺文件当产品失败。版本检查辅助脚本缺失也已恢复，与远端精确blob核对后通过；没有删锁或依赖安装回退。只恢复相关源码，不冒称完整checkout或本地完整React/Go/Windows运行。

补丁版4.212.0→4.212.1通过显式npm version patch及previous-version校验；manifest/完整lock仅变三个应用版本，679依赖节点/schema14不变。旧测试、所有旧断言和工作流不改，新共享用例经新增Vitest入口进入完整UI。预期UI3219仅为核对目标，必须看新HEAD实际执行，不能沿用3203绿灯。

46条历史产品/环境记录、12类助手事故及近期修补保留。历史目录已读；没有把历史catalog索引验证说成本轮全历史回归。当前先完成此修补，不叠加2F.80。新HEAD原CI、四UI/实际服务、双Electron、后端、Windows原保存与现有报告功能、新安装包独立核验后才accepted。最终写PR和交付，不为状态再造提交；只在feature/knowledge-os-phase2 / DraftPR2，不合master、不强推、不打tag，不触碰用户真实数据。

参考：
- https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
- https://developer.mozilla.org/en-US/docs/Web/API/FileReader/result

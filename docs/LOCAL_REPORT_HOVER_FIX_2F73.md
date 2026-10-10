# 2F.73 / 4.206.0 — 原生拒绝拖放的提示修补

首提交 fa988b9057935639d8639376c64933da4b96482d 的真实 Windows 桌面流程 38041835484 失败。原始产物 11666207253 的 SHA256 为 e699c50f70737c1cf6c5ef93c0cc2cd9767bb9c5ed8ea498b64c136ef86a830a，checks.json 记录 complete:false：文字拖入后实际仍为 drop-one-file，预期 drop-file-required。原 ZIP、截图和错误文本保留，不重跑或改写失败记录。

代码将非文件 dragover 的 dropEffect 设为 none，但拒绝说明只在 drop 中更新。禁止落下时，原生浏览器可以只发 dragleave 而不派发 drop，因此合成测试主动派发 drop 的成功没有覆盖这条真实事件序列。这是生产提示缺口，不是网络问题，也不能用放宽旧桌面断言掩盖。

修补在 dragenter/dragover 只检查原 types 元数据，非文件立即更新固定拒绝说明并清理悬停高亮，继续保持 dropEffect=none、preventDefault/stopPropagation。不得为触发回调而把文字或链接当作可复制文件，不读取保护模式 files、items 或文本，不撤销当前文件读取或报告。原 drop 的单文件/目录/4KiB/编码与解析规则保持；原桌面脚本和全部旧断言不改。

新增10项共享Node/Vitest测试直接执行生产组件中原同步处理函数，覆盖无drop的文字/链接、类型异常、禁止写dropEffect、高亮恢复和先阻断再反射。精确旧源码2通过/8失败，修补后10/10。此VM验证不是React或原生浏览器执行。新增2项React回归覆盖只发enter/over/leave时已完成报告不变，以及既有在途读取不被取消。完整React及原Windows拖放仍须修补后当前HEAD的CI独立验证，不能沿用首提交的绿灯。

同一尚未验收的功能阶段，版本保持4.206.0，不增加状态-only版本或提交。仅修改此组件的悬停反馈并新增测试/本记录；不改原Windows测试、保存退出、main/preload/server、旧测试或工作流，不修改依赖和schema14，不叠加下一阶段。历史46产品/环境目录与12类执行事故保留；平台中断根因未知。最终验收以PR #2当前HEAD和真实产物为准。

参考：MDN Drag operations / Performing a drop，dropEffect=none 不会形成成功drop。
https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Drag_operations

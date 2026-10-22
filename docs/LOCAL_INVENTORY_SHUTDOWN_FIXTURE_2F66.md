# 2F.66 / 4.199.0：主进程单元夹具依赖补齐

9d8dab0的四平台界面与真实打包桌面盘点已通过，但push/PR完整UI流程在“Verify managed backend shutdown”停止，后续Electron和Windows包尚未生成。两个job日志读取返回404，不把推断或本地日志写成原始远端日志。

在精确9d8dab0源码上执行原scripts/backend-shutdown.node.mjs，本地实际12通过/1失败，唯一失败为actual startBackend does not spawn after quitting during secret load，报resolve is not a function。新增生产startBackend会调用localOverviewRuntime.childEnvironment，旧VM上下文未提供该依赖，异常被生产catch捕获，secret load根本未开始。这是同阶段漏补的单元夹具依赖，非GitHub执行器故障，也没有证明真实退出保护失效。

本修正让该VM使用真实createS3LocalOverviewRuntime模块（仅注册到自有无操作IPC夹具，不发请求），在原断言前额外确认secret load已进入。保留原退出期间spawns=0、backend=null断言以及前12个测试。增加一项真实startBackend函数的环境传递检查，确认能力仅在独立子进程环境、父环境未改、原WebDAV秘密处理和重复启动拦截保持。该测试仍是VM和合成子进程，不冒称真实Windows执行；原真实桌面退出和新盘点端到端继续独立验收。

本地14/14通过，并以隔离副本移除生产if (quitting) return核验旧退出断言能检出回归。没有更改生产main、后端关闭实现、旧阈值/工作流，版本仍为同一未验收阶段4.199.0。修正后的新HEAD必须重取完整流程和安装包，不以9d8的部分绿灯代替最终验收。详细原始输出及读取限制保留在交付日志；最终状态记录PR #2，不为状态另造源码提交。

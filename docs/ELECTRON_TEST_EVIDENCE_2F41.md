# 2F.41 Electron 失败报告留存修补

基线为已发布的3c01ffe7c1452bdd28c2ecb86bf4a38e72e847ee/tree7c10436c4ab9ce1008bd651dcced29c2b97939ec，发布评论5980270940；2F.40验收5978940337不变。

PR UI run37204478492/job111442703174的Run Electron tests失败，后续editor跳过；其它同树成功不覆盖这次失败。原日志连接器仅返回不透明值，旧文件ID不可恢复；该run产物只有后端包，没有Electron报告。原失败断言未知，不猜测根因、不无依据重跑job。

本修补保留原npm run test:electron及测试选择、并发、超时、断言，仅增加default/JSON报告和完整stdout/stderr文件。记录checkout/tree前后、触发SHA、run/attempt/event、Node版本、实际命令、npm/capture/source退出码及SHA256。已有报告目录拒绝重用，不删除或覆盖。

Electron步骤尝试后always上传独立产物；npm失败退出码原样保留，仍阻塞editor。tee失败、跟踪源码改变或成功但缺少JSON也不能报成功。报告助手不运行用户应用或操作用户数据，CI只用原隔离测试。这不能重建旧job的日志，也不证明旧失败根因已修。

12项本地隔离Git/假npm契约验证成功、四种非零退出、早期失败无JSON、缺报告、tee失败、失败优先级、源码漂移、旧报告保护和工作流门禁。原stage-review的62项回归也通过。它们不是本地Vitest/真实Electron测试；当前无依赖且registry DNS无结果，未安装或重试下载。

未改生产JS/Go、原测试及断言、package/lock、schema、原验收器或其它工作流。仅原feature分支/Draft PR #2；先完成新HEAD全部CI与独立验收，再判断下一阶段。2F.41未ACCEPTED，不进入2F.42。

执行恢复：本容器旧工作目录不在，source旧文件ID无法解析后，从原artifact11304431497恢复一次；ZIP摘要c4f2ba2c1f8b149124e4a335e273e474eef82c5da8282666eaf1790bb447f73a，964文件独立索引重建7c10436。不是clone；不重复旧安全拒绝/失败日志路由。46历史问题、12助手事故保持原索引，不把报告留存修补称聊天平台超时根因修复。

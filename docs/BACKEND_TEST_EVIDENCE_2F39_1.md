# Phase 2F.39.1 — 后端验收产物与源码身份绑定

基线77008493f55ae607b3fe4467e2c346cd838ff123 / tree51e167f41f59e3da05afd9f6c96619dd3b38120a。继续feature/knowledge-os-phase2 / Draft PR #2，不合master，不发布生产。产品4.195.1和schema14不变。

## 为什么本轮先补验收，而不是进入2F.40

2F.39八条PR检查以及push UI/Windows、Desktop流程均显示成功，当前提交的原生、双平台完整UI/实际服务、桌面及安装包产物已独立核验。但是通过job日志接口返回的后端包目录与精确源码树不一致，不能用其中孤立的syncs3成功行当作整份日志来源证明。源码树中的GoFrame结构是server/cmd/notepad-server、internal/controller、dao、logic、middleware等；先后返回的internal/app/editor或internal/api/service布局不属于这棵树。一次过期/不匹配job编号返回404也不证明GitHub整体故障。

本轮把临时backend-execution-evidence摘录明确标为EXCLUDED，保留观察及差异，未宣布2F.39整体验收通过。差异的外部根因未知，不声称修复了日志连接器，也不无限换job重复取同类大日志。本修补属于已有EVIDENCE-01验收风险的防复发措施，不重复增加产品缺陷编号。

## 实际改动

新增scripts/backend-test-evidence.mjs和对应Node回归。既有UI Redesign CI的“Run backend tests”仍执行server目录完整`go test ./...`，通过脚本增加`-json -count=1`，记录原始逐行测试事件而不只保留ok摘要。没有加-run/跳过包/删除旧测试，没有改变Windows依赖关系及其它工作流门槛。原始退出码非零、signal、超时、构建失败均失败退出并保留未完成报告。单次完整测试进程预算8分钟；原workflow总预算不变。

同一步另外记录当前checkout commit/tree、逐个已跟踪Go源码和go.mod/go.sum的Git blob及SHA256、Go版本/平台、原始go list包清单、S3顶层测试发现列表，以及各进程的参数、目录、退出值、标准错误和原始标准输出摘要。S3发现使用go test -list，不执行其测试用例；完整测试仅运行一次。GOTOOLCHAIN=local拒绝隐式工具链下载，GOWORK=off和空GOFLAGS避免工作区或附加过滤参数改变范围。版本必须匹配仓库go.mod声明toolchain。本轮不修改go.mod或安装新依赖。

测试前后都核对工作文件与Git对象，防止源码被替换；拒绝未跟踪的后端输入。包清单必须恰好覆盖当前已跟踪Go源目录，不能把其它目录/模块的报告代入；这是当前Linux完整后端的严格约束，今后增加仅非Linux可编译的独立目录时应显式评审适用性，而不是静默忽略。当前仓库13个Go包目录符合这一结构。

产物名`local-notepad-backend-tests-<实际checkout提交>`，包含report.json、go-env.json、packages.tsv、s3-list.txt、tests.jsonl及四份stderr。使用always上传，失败/超时文件保留；缺失产物不能当通过。元数据不是单独的验收凭证，必须连同完整原始输出检查。

## 独立验证

在与实际提交一致的源码副本运行：

```
node scripts/backend-test-evidence.mjs verify <解压产物目录> <已另读确认的checkout提交> <已另读确认的Git树>
```

checkout提交在PR工作流中可能是测试合并提交；不能用artifact自己声明的commit/tree来替代另读的GitHub身份。验证器必须同时有实际源码字节和Git树对象。它不联网、不重新跑后端、不修改源码、不根据报告自行下载或信任另一个目录。报告中的本机绝对GOMOD路径只作该次执行附注，不要求它存在于核验机器。

校验项包括源码指纹、工具链/平台、固定命令及完整退出状态、所有原始文件摘要、包清单范围、每个包的start与终止事件、逐测试run/结束关系、原始失败、截断或重复事件、缓存结果，以及S3发现的每项顶层测试完整通过。S3任意skip会拒绝；其它后端已有条件skip保持Go原语义但明确统计出来，不伪报为通过。无测试文件的包可按Go定义记录skip，与有测试包被跳过区分。顶层数与包含子测试的通过事件数分开，不能相加。

独立核验只给出backend-tests-only，不给出“整个阶段验收完成”。还须保留八PR、完整push UI/Windows、独立Desktop、测试树及UI/实际服务/原生/桌面/安装包原始产物核验。文件摘要和Git对象能发现不一致，但不能单独证明来源未被恶意伪造；仍需从正确GitHub run/artifact取得原始产物并核验API摘要。

## 本地验证与未完成部分

52项Node测试通过，其中31项顶层及21项子测试，不重复相加。覆盖换包、漏包、失败/跳过S3、缓存输出、截断、缺事件、重复事件、错误提交/树/工具链/参数/目录、输出篡改及源码变化。包含真实隔离Git仓库和本机Go进程的成功、失败两种收集与独立核验，不模拟go test成功回执；原始失败JSON和非零退出会保留。local-fixture报告默认不能充当CI报告。

本地隔离夹具使用安装的Go1.23.2，不是项目要求的Go1.24.11完整后端。当前容器未安装项目依赖，本轮不执行用户完整后端，也不把此前42顶层/275事件当成本轮新增测试。新提交必须在CI真正生成完整后端产物并独立核验后，才可完成2F.39验收和推进2F.40。

协议参考：Go官方go test文档说明-json保留逐项事件、-count=1禁用结果缓存；test2json文档区分包和测试事件以及无测试文件skip。
https://go.dev/src/cmd/go/internal/test/test.go
https://go.dev/cmd/test2json/

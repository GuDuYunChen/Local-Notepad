# Phase 2F.58.1 — 真实 Go 预览拒绝响应的前端契约修补

基线39a33075d9136a74d84e0025be4eb542eca5f9f4/treeb4e553f5813140092e56326153a91e70d7d254b8。2F.58原验收6033462258及其CSS定位修补证据保留。本次复查发现跨语言拒绝码遗漏，先修既有能力，不进入2F.59新功能。

## 已实际复现

原Go S3PreviewHandler对Content-Encoding（包含空值/identity/gzip）和Trailer声明返回HTTP415，message为encoded-or-trailer-request-refused，data=null。原共享JS codec仅接受encoded-request-refused，因此真实拒绝会变成status0/native-preview-invalid-response，前端继而把它作为返回格式问题，而不是原415拒绝。

本轮逐字节复制原25份syncengine/syncs3/syncjob标准库生产文件，在自有临时模块用Go1.23.2实际运行原handler，取得上述原JSON；原codec断言失败。新增五项共享测试在旧代码上3pass/2fail，修补后5/5。原始失败日志全部保留。这是拒绝原因分类不一致；不是成功数据被接受、凭据泄露、用户数据写入或正常预览一定失败。原主进程不会主动发送这些编码/尾部字段，故不能将其描述为所有正常请求的故障。

## 修补与兼容边界

唯一旧生产文件变化：electron/s3-preview-codec.js的415固定白名单加入Go实际的精确字符串。保留已接受的旧固定别名，以维持此前公开契约和原回归；不做前缀/模糊匹配，也不接受任意服务端message。两种字符串都只能对应415且data=null，错误HTTP状态、额外/重复字段、私密错误文本或非空data仍拒绝。

不改Go handler/browser guard、原生请求头、连接或超时政策，不新增允许编码请求的路径，不重写session/binding/hook/panel，不改自动保存、Ctrl+S、保存队列回执、草稿、引用、退出保护、schema14或依赖。主进程ClientRequest-close与前端Promise持槽规则保持；前端失效不是原生I/O取消。

## 自动回归的实际范围

新增测试专用有限Go程序，以httptest请求/记录器执行原handler，生成18份实际拒绝响应：5个编码/Trailer声明变体，以及尾部值、目标查询、GET、Origin、Referer、缺意图、非JSON、nil正文、声明超限、无效JSON、取消、截止、nil handler。无listener、固定端口占用、真实S3/数据库或文件读取请求；临时编译目录仅由本测试创建和清理。

Node/Vitest同一入口逐项检验实际JSON，再通过原codec、原preview service、原IPC注册/scope和renderer binding验证固定错误保留、零summary及单次调用。传输回调和Electron对象是合成的，Go handler本身为真实原源码；这不是实时TCP或完整Electron→GoFrame→S3界面链路。Go编译最多60秒，有限程序最多5秒、输出64KiB；原项目模块/原测试超时不变，临时模块GOTOOLCHAIN=local/GOPROXY=off/GOSUMDB=off，无下载。

五项顶层测试中，18场景位于一项内部，不加算为额外18顶层用例。另四项验证精确415/null、旧固定别名兼容、未知/重复/私密字段拒绝以及失效后的返回值不再执行getter。新增测试在真实Vitest/Windows的执行还必须由当前HEAD原报告证实。

## 发布前与最终验收分开

本地新增5/5；原binding24/session83/preview125/保存保护202/scope63/bridge100/HTTP19/stage-review62全部通过。原HTTP单个用例的27项probe内部检查不重复加总。catalog/lock只做结构核对，testsExecuted=false不当应用测试。未clone、npm安装、下载模块/工具链或操作真实数据。

发布后仍须当前HEAD17CI、四份完整UI/19实际服务、双Electron、源码绑定Go1.24.11完整后端/S3/controller、品牌/原生/桌面/NSIS独立核验。预计UI2595、Electron406、后端1528只是核对目标；只有原始报告实际执行新增5并通过才验收，不拿39a旧绿灯替代。原所有用例/断言/工作流/验收器不删不降。当前修补结束前不进入2F.59。

限定feature/knowledge-os-phase2 / Draft PR2，不改/合master、强推、生产发布、凭据持久化/provider/apply/上传删除或真实桶。46问题与12助手事故索引原字节保持，本次具体缺口与工具纠正另列；不宣称整个项目无bug或ChatGPT投递故障已修。

本轮查阅的接口依据：Go net/http/httptest（https://pkg.go.dev/net/http/httptest）及RFC9110第15.5.16节（https://www.rfc-editor.org/rfc/rfc9110.html#name-415-unsupported-media-type）。实际消息字符串由本项目原handler产出，不由HTTP规范推断。

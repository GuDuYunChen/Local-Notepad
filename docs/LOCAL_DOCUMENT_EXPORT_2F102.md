# 2F.102 / 4.235.0 本地文档导出完整模块

## 接续依据与范围

上一完整模块2F.101已经由产品 `d3f47277a6a148bf62e50f22b3bf068819a7e1fe`、树 `299bd727aaea946e4b980daddab2bb756a4306a2` 和安装验证 `08f3a543cb7b036b7f8049100dbf1651bc3851a5` 完成验收，最终记录为 [PR #2 评论6307542211](https://github.com/GuDuYunChen/Local-Notepad/pull/2#issuecomment-6307542211)。原失败候选、46项历史索引和12类助手事故保留；没有把旧“仍须验收”文字再次解释为本版本阻塞。

当前仓库已经有本地模板、回收站、历史、标签、文内查找、目录、Wiki、导入、阅读和快捷键模块，没有规定2F.102的既定顺序。本阶段从真实现有“更多笔记操作 → 导出”入口完成一个完整本地工作流，保留原有Word／Markdown两种批量格式。云、多端同步更新、推送及其他非本地产品功能后置；PDF／HTML和项目合并稿不增加新界面，仅补齐同一原生文件写入边界。

## 已确认的原实现问题

在精确d3f47277源码副本上执行独立反例，以下3项全部实际失败，原报告和源码按原字节保留，未把静态推断算作复现：

| 原问题 | 原因与本模块处理 | 回归入口 |
|---|---|---|
| 已存在的同名导出文件被覆盖 | 原批量导出直接writeFileSync同一路径。新实现先独占创建批次目录，规范化Windows文件名和层级冲突，文件以独占方式写入；不覆盖先前批次或成功项。 | `electron/local-export.test.js` |
| Markdown静默省略附件及折叠正文 | 原转换器默认分支跳过没有children的独立节点。新转换器检查实际节点类型，保留附件、折叠正文、公式表达式、提示和其他已知文字；未知节点明确拒绝整次预览。 | `electron/local-export.test.js` |
| 下划线被转换成删除线 | 原Markdown转换把Lexical位8解释为删除线。新Word／Markdown映射统一保留位4删除线与位8下划线，并核实际文档输出。 | `electron/local-export.test.js` |

关联静态缺口也在同一个模块处理：没有逐项结果、目录取消丢失选择、未界定的目录／正文读取、附件失败静默保留本机链接、旧IPC直接接受renderer目标路径。它们分别以新服务、真实UI和原生边界用例覆盖，不冒充上述3个已执行的原反例。

同阶段又用真实内容选择器复现：先勾选整个文件夹，再取消其中一个子笔记，旧选择仍保留父目录ID，原生展开会把取消的笔记重新纳入。原实现实际执行的该项失败保留；另外6项过滤跳过没有计作通过。修复以自底向上的完整子树核对规范化选择，初始文件夹展开为对应后代，半选祖先不再作为根；原禁删当前文件和单目录选择行为保持。回归覆盖嵌套取消、全取消、初始文件夹、打开期间新增子项及关闭重开。

工作台审阅还修补了三个回执消费缺口：Start已受理但回复丢失后，停止仅携带稳定planId，避免旧requestId导致停止被拒；实际目录／批次超时等顶层错误与逐项错误一并显示；已锁定目录即使项目仍全为ready，也不能再显示可更换操作。对应4项定点UI回归与真实core→IPC→严格UI回执联接检查保留，不将这些新增检查冒充原实现的已执行负例。

## 完整用户流程

1. **入口与选择。** 从现有更多菜单打开真实内容选择器，可以选择单篇笔记、多篇笔记或文件夹。父子选择去重，返回更改选择时保留勾选，不触发保存、创建、删除或笔记切换。
2. **格式与正文预览。** 选择Markdown或Word，显式读取预览。主进程完整读取目录及所选已保存正文，核对身份、类型、结构和上限，然后冻结本批正文。任一所选正文无法完整读取时，预览不成立、零导出写入，用户可保留选择重试。编辑草稿不被自动保存；界面明确说明导出来源。
3. **原生目录选择。** 目标由当前主窗口的系统目录对话框选择。取消仅取消本次目录选择，预览和内容选择保留；renderer不能提交任意路径授权。格式变化会释放旧预览，要求重新读取。
4. **实际导出。** 在选定目录下独占创建新的Notepad-export批次目录，保留选中层级并对规范化同名分配后缀。转换和复制本地资源，逐项显示状态与具体失败原因；成功项必须带实际输出路径、字节数和SHA256回执。读回不符不算成功。
5. **结果与打开目录。** 展示每项输出路径、正文预览、格式提示及结果。用户可打开本批导出目录。失败但存在无法证明可清理的自有残片时，展示具体路径和清理错误，不删除身份不明文件，也不谎称完整成功。
6. **停止、继续与重试。** 准备阶段可停止读取；导出阶段停止底层读取并等待正在进行的操作结束，已成功文件保留。只有用户显式继续才处理未完成项；“仅重试失败项”只处理失败，使用冻结正文，不重复写已成功项目。丢失响应时先查回主进程结果，不重播开始命令。
7. **关闭与异常。** 忙碌或结果未确认时保留工作台，提供停止和查回。释放、卸载、导航和窗口销毁撤销旧请求；底层在途操作真正结束前不释放执行槽。关闭不改变笔记、保存队列、回执或退出决定。

## 正文与资源边界

每批最多100篇笔记或100个选择根，完整目录最多10,000条；单篇正文2 MiB，批次正文8 MiB，20,000节点与64层。单篇资源最多100项，单资源16 MiB，批次资源64 MiB；每次准备或执行共享60秒绝对截止，单次HTTP读取另有10秒上限。达到上限明确失败，不截断为成功。

新工作台读取本地后端和当前uploads资源，内嵌图片按实际字节核格式。资源不会静默退回失效的127.0.0.1链接；缺失、损坏、过大或当前格式不能表示的图片会明确失败，用户处理后可重试。外链资源不自动下载；正文中的普通链接可保留。Word图片按支持格式嵌入，其他附件与文档同批交付；Markdown资源使用相对路径。动态图集按顺序展开；公式保留表达式，折叠／提示块保留文字，嵌入与视频保留文字或可用本地文件，不运行交互内容。旧格式正文按纯文本保留并提示，不自行把其中的标记解释为活动HTML。

正文预览固定的是已保存正文；附件在实际导出时读取。预览之外产生的新编辑不会悄悄混入重试。无法转换的未知节点、无效结构或不完整读取会明确拒绝，不把“文件存在”当作“内容完整”。

## 原生文件授权与兼容入口

新导出操作绑定确切主窗口、webContents、主frame、URL与导航代次；只接受本次原生对话框选定的目录。状态、取消、重试、释放和打开目录使用opaque计划身份，跨窗口／iframe／导航旧请求全部拒绝。所有读取共享信号和截止时间，迟到结果不能复活计划或继续提交文件。

旧`export:docx`只接受当前document刚取得的目录授权，复用新导出事务。项目合并稿消费同一原生目录授权，先转换到私有暂存，再发布到独占新子目录。旧PDF／HTML实际目标改由原生保存对话框选择；renderer路径仅可提供清理后的建议文件名，转换完成后再次核对窗口／frame／导航与截止再发布。原`saveContentAs`继续由原生保存对话框选择目标，只补调用者和对话框返回后的身份检查，正文保存语义不变。

## 验证与交付约束

UI服务及真实选择器入口：`src/services/localExport.test.js`、`src/components/ExportWorkspace.test.jsx`、`src/components/FileList.export.test.jsx`、`src/components/FileSelectorDialog.selection.test.jsx`。它们追加到原test:ui，不删除原列表及其保存／阅读／快捷键检查。原生文件、转换、取消及旧接口范围：`electron/local-export.test.js`、`electron/export-scope.test.js`、`electron/export-workspace-ipc.test.js`，由默认Vitest和原Electron测试范围执行。

实际Windows驱动使用隔离数据和当前生产节点生成笔记，操作真实目录对话框，核实际Markdown／Word文件、本地资源字节、同名保留、失败重试、停止后继续、窄窗口可见反馈和正常退出。新模块追加到原Desktop及完整安装生命周期，不替换旧保存、阅读、历史、快捷键、安装升级／修复／卸载名册；目录自动化只匹配本轮自有PID、主窗口和owner链。

发布前必须执行默认无过滤Vitest、原test:ui、版本／依赖检查及涉及的真实本地服务回归。当前HEAD的17项产品CI、原始UI／后端／Electron／Windows证据、新4.235.0 EXE和同源安装生命周期分别独立核验。这个源码文档记录实现范围与复现依据，不预先宣称尚未执行的当前HEAD验收通过；最终结果记PR #2与交付报告，不为“已验收”另造源码提交。

## 首候选远程失败及同模块修补

`d77fa98bb164dda47b19cf7a90ae9ac89bed796e`的44项改动已通过网页VSCode逐文件回读并提交，源码树与本地冻结树一致。当前候选17项首次工作流实际为11成功／6失败，无手工重跑；[Desktop运行39558996416](https://github.com/GuDuYunChen/Local-Notepad/actions/runs/39558996416)在构建前Node合同失败，没有执行真实桌面，也没有Desktop产物。该候选虽生成安装包元数据，不能用于最终安装验收。

1. **Windows临时目录别名。** 原始完整报告显示`C:\Users\RUNNER~1\…`与`C:\Users\runneradmin\…`指向同一临时目录，但测试用词法路径比较core经过realpath的输出；raw oracle夹具还把错误的`../actual/…`相对路径映射进合成Windows目录，触发原containment拒绝。真实自有junction／symlink反例在旧夹具中命中相同拒绝。修补仅在创建测试目录后规范化真实根，保留生产目录授权、realpath、containment及所有原断言；不把链接别名等同于允许跨目录导出。
2. **合并稿发布到独占目录。** 三份独立Linux报告及Windows报告在同一成功断言失败。仅凭通用错误回执无法归因；保留产品脱敏逻辑，以测试观察器采集内部异常后，在官方SHA核对的Node24.22.0实际复现`ERR_FS_CP_EEXIST`。原因是先独占mkdir发布根，再用`errorOnExist:true`复制临时根到这个已存在的根；同一诊断在原本地Node24.19.0通过。修补保留独占创建与`force:false,errorOnExist:true`，将临时根中的各个顶层文件／目录复制到发布根中尚不存在的同名目标，正文及嵌套附件一起交付。原同名文件、取消、一次性目录授权及失败处理继续检查；不是删除发布根后重新创建，也不靠允许覆盖获得通过。

Windows路径问题、实际复制异常和诊断前的未知原因分别记录，原始失败JSON、日志和受测源码不覆盖。修补后使用与此次CI一致的Node24.22.0运行完整默认Vitest和原test:ui，Go仍为1.24.11且保留VCS检测，专属TMPDIR保持。完成新源码冻结、当前HEAD远程CI、真实导出文件、实际新EXE及完整安装生命周期后才能结束本模块；这些源码说明不提前宣称后续原生验收通过。

## f409路径前置修补不足与原生解析统一

后续候选`f409bfcc0c5762a058fac464a2aad63dc1d5f00a`通过网页VSCode推送，树`4d8ad9e7353d984243eb44d459789ad13d902539`与冻结的1574文件一致，本地默认4973项、原UI1373项和原Desktop614项全部通过。但四份实际Windows完整报告仍各有7项IPC失败：原6项加现有目录别名回归，真实core的返回仍为`C:\Users\runneradmin\…`而夹具期望`C:\Users\RUNNER~1\…`。[Desktop运行39565331611](https://github.com/GuDuYunChen/Local-Notepad/actions/runs/39565331611)为612通过／2失败，均在原严格包含断言；构建、真实保存／阅读／快捷键／导出被跳过，没有Desktop产物。这些结果没有被重跑或作为验收成功。

官方Node24.22可执行文件中的原始实现确认：普通`fs.realpathSync`使用JS逐段lstat／readlink，仅遇到符号链接时替换；普通目录片段保留。因此它能通过Linux symlink回归，却不保证展开Windows 8.3短名。`fs.realpathSync.native`和生产使用的`fs.promises.realpath`都调用原生`binding.realpath`。第一次修补错误地把这两类解析视为等价，这属于测试前置修补不足。

本次只将IPC测试和原始导出证据测试的目录创建／别名解析改为原生同步实现，并把既有别名用例的独立真值取自异步realpath。原52项IPC和81项原始导出合同的名册、生产授权／包含／文件字节断言与超时预算保持，不改产品源码来容忍越界路径。安装验证器共享的原始证据文件同步为同一字节；新产品、实际导出与安装仍须按其真实提交独立验收。

上一轮完整本地报告还发现stdout与执行摘要的字节摘要不一致，机制未确证。原成功JSON、现存日志及两次摘要保留，仅为证据完整性以同源同命令补跑默认全量，4973项名册一致，并在执行环境内封存二进制ZIP核对大小／SHA／CRC及内部三件原始证据；其他门禁未重复运行。此事不作为Windows失败原因，也不推断为ChatGPT中断根因。

## e74真实Windows目录助手启动拒绝

`e74c87e080c7b004d2fd2ce6ab213b4ba095fb1b`／树`c3e62587497d2b99205411cade63191b0e227eae`的17项首次CI为16成功／1失败。[Desktop运行39567379839](https://github.com/GuDuYunChen/Local-Notepad/actions/runs/39567379839)实际通过原614项Node合同、80状态模型、production构建、真实保存／阅读和快捷键两进程重启；Windows路径前置不再失败。原Desktop包12330896226的4059050字节、SHA256与152成员已核，原保存／阅读／快捷键各自证据仍按其范围保留，不能抵消新导出失败。

新导出驱动在目录助手启动后约502ms收到`STARTUP_REFUSED`，约512ms记录清理未完成。`local-export-desktop.json`为`complete:false`、`cleanupComplete:false`，`checks`、`screenshots`、`directoryActions`全部为空；业务操作尚未开始，没有109份实际文档或6张新导出图的成功证据。窗口助手正常就绪，目录助手的原始catch仅输出固定`DIRECTORY_HELPER_STARTUP`，session又未保留详细字段，日志为0字节，因此原件不能证明具体编译或初始化异常。该run实际Node为24.21.0，环境事实保留，不据此推断原因。

源码复核确认C#使用`HashSet<long>`，显式程序集列表未列.NET Framework的`System.Core.dll`。本次补齐该引用，并保留白名单阶段、异常类型、HRESULT、编译器CS编号、PowerShell版本及程序集文件名诊断；不转储任意异常原文、命令、环境或用户路径。session严格校验诊断再写失败事件，畸形或越界内容不能变成可信信息。原现场底层异常未知与当前引用修补的依据分开记录，不将静态推断冒充原始编译日志。

Windows准备合同增加同一worker的实际冷启动与EOF正常关闭子验证，不发鼠标、键盘或目录动作；原30秒启动与10秒命令预算、PID／owner绑定、单次命令与失败不重播保持。Linux没有PowerShell／.NET Framework时只报告实际运行的协议与拒绝合同，不把条件分支视作Windows已执行。生产导出和包含边界保持；安装共享源同步，下一真实提交仍须完成全部CI、新导出原件与当前EXE完整安装后才能验收。

同轮沿实际驱动复核路径身份链，发现其`mkdtempSync`返回的scratch尚未原生规范化：report.exportRoot沿词法scratch派生，而实际成功item.path来自core原生realpath。若临时根含8.3短名或junction，同一物理目录仍可能在最终包含检查被拒绝。e74在助手启动已停止，这一条件风险不是当次已发生的业务失败。修补仅在独占创建scratch后调用`realpathSync.native`，使profile、导出目录、回执根和最终自有目录清理共享同一个身份；原参数限制、60秒执行预算和相对路径拒绝不变。安装驱动复用同一文件并保持字节一致，不另造通用模块或放宽比较。

## 7ba冷启动原件与确定的CS0028修补

`7ba6d55c72b3cca50c024eda573ccee2b7defce1`／树`46a76fd53258afca9ce3a0ecce89aad1d5f2b560`的17项首次CI为16成功／1失败。[Desktop运行39571162056](https://github.com/GuDuYunChen/Local-Notepad/actions/runs/39571162056)在原617项准备中616通过／1失败，唯一失败是同worker实际冷启动；80状态模型、构建和全部GUI步骤未执行，也没有Desktop产物。原日志99677字节，SHA256 `7ed27ab1fb5a0df2aa4bb05b2ac49d98244e524f094a5d9207e0bc907b777b75`。它报告SOURCE_COMPILATION、System.Exception、HRESULT -2146233088、空compilerCodes；五个引用已含System.Core。不能继续把“补引用”写成启动已解决。

独立诊断从原7ba创建`ci/export-directory-diagnostic-7ba6d55`，通过网页VSCode只新增两份文件，实际提交`2cb99c051c7071b4e373ff36dfe7c7287a9432a0`、唯一父提交7ba、树`24adf507b6b3d16b93d9469843ef066306c591bf`全部核定。原1574个产品文件逐字未变，新增文件不进入原默认／UI发现或导入路径，仅触发[诊断运行39575041025](https://github.com/GuDuYunChen/Local-Notepad/actions/runs/39575041025)的首次attempt，没有重跑旧17项。工作流为Windows、contents:read、4分钟上限，不装依赖、不启动产品，不生成或接受EXE。

原worker和只增加启动catch观察的worker分别在自有进程运行，使用同一实际checkout的CRLF字节、同一C#及五个引用、原UTF8压缩参数和MTA模式。两者均ready:false／exit1，均观察到退出，窗口命令和应用启动为零；原worker仍只能记录阶段和空编号，增强观察读取真实`Microsoft.PowerShell.Commands.AddTypeCompilerError`，取得CS0028、C#第54行15列、isWarning:false，错误说明为私有`ExportDialog.Main(uint, long, string)`的入口签名不符，警告按错误处理。实际环境为Node24.22.0、PowerShell5.1.26100.33648、Desktop／FullLanguage、CLR4.0.30319.42000；没有改变C#去制造这个错误。

原ZIP12332634868为2913字节，SHA256 `21ed156a63ce6d774b3893051c1235499e24dd5446dffd104c59c0ddf9833bfc`；其中原diagnostic.json为9416字节，SHA256 `e3a5b6f7031d17b4bae78228a7e1332dbc8a5e162c221fb840cff05fae21b80b`。Git worker15238字节的SHA为`60d28fad1b4b3b48be16cc96f5949ac8484bda4bec3c05192cce10047618bfc6`，实际CRLF worker15457字节SHA为`26606a6a2a09263b6cd9f6200d5d4b2f085046babaff5b1f64195b497112b816`；两次实际C# SHA均为`00692cd01b9bc873b6a80e2125a797a1c8ab38596d2db0ee93eef193cdc623cd`。原件、换行变换和源码行号已独立核对。官方Roslyn／net48的Linux静态编译虽然通过，不能替代上述Windows CodeDom结果；该诊断也不能反推e74未保留的底层错误已被直接观察。

本次最小修补把内部主窗口校验方法及其全部调用改名`ValidateMainWindow`，方法内PID、可见性、窗口类和可执行文件身份判断逐字保留，五个引用、警告政策和预算不变。启动catch从真实TargetObject提取限定CS编号、行列及布尔警告标记，session严格核验结构，不保存任意ErrorText／异常原文或路径。真实Windows冷启动合同保留旧命名的精确正文反向对照与CS0028拒绝，再验证修复worker正常ready／EOF退出；原协议、失败不重播及目录安全名册继续保留。

这是同一完整模块内的验收助手修补。诊断采集完成不表示产品成功；新提交仍需默认无过滤Vitest、原test:ui、全部17项产品CI、真实Word／Markdown正文及附件、对应4.235.0 EXE和原完整安装生命周期。安装共享脚本须与产品字节一致，pin只能来自合格的当前产品原件；当前源码文档不预写这些未来结果为通过。

## 282实际导出准备的文本上传失败

产品`282fab2948a16d74244f7c385a41fdf668c63269`／树`97192d918f10b593388216b86cc9ec58f0d1777b`的17项首次CI为16成功／1失败。[Desktop运行39577417121](https://github.com/GuDuYunChen/Local-Notepad/actions/runs/39577417121)原617项准备全部按原名册通过。实际Node24.21.0、PowerShell5.1.26100.33438中，旧`Main`命名负对照返回CS0028／54:15，并观察到被拒绝进程退出（code:null、signal:SIGTERM，不能称为正常EOF退出）；修复worker在479ms就绪、523ms完成干净EOF退出。原80状态模型、构建、保存／阅读与快捷键操作通过。目录会话随后已操作真实720×520窗口，原助手启动问题不再是待查的未知异常。

新失败发生在第14步导出准备：`check-local-export-desktop.mjs`连续成功上传两张PNG后，固定`export102.txt`返回HTTP200／code1010，原断言要求code0。该文本为46个UTF8字节，SHA256 `7c9d82808f6eda5e25e8eee4d88fd05a3a17ca503a740e9ec7b3bd629c3105ac`。原驱动未记录message，故该次原件只证明数字拒绝，不能倒填后续复现的错误文字。导出checks和directoryActions均为空，complete:false、cleanupComplete:false、forceTerminated:true；唯一失败PNG是夹具笔记尚未建立的首页，不是导出成功图。原日志144098字节、SHA256 `d9b9964fc7c884a98e40bd17fb6ebbc825af97a8ac776daa7c1c8bd6f74303aa`及Desktop ZIP12334673941保留；停止所有已终态轮询，不下载或固定本候选EXE。

修改生产源码前，使用原`UploadController.Register`、独立临时上传目录和`127.0.0.1:0`实际multipart请求，在官方Go1.24.11下重现同一附件被拒绝：HTTP200、code1010、message为`文件内容类型不匹配: application/octet-stream`，输出文件数0；应成功的回归真实exit1。受测原upload.go为3081字节，SHA256 `a3e60dde7e2255de2af730fef2584ab51312b4bc88dbf3efa374aee5f08575b4`，原JSONL SHA256 `0792d5a7d698ab2e79d3d5f9a651a3b6b1dcd68b6caeeb5e4e7724f8f3486a85`。这是本地同源同输入的确定反例，不宣称Windows原件曾保存这段message。

原实现创建512字节缓冲，读取后却把整个缓冲交给`http.DetectContentType`，46字节正文后的466个零字节使文本被归为二进制。仅改为实际读取切片仍不足：真实文本嗅探结果包含`charset=utf-8`参数，而原白名单存储基础`text/plain`。修补将嗅探限定为实际读取字节，用`mime.ParseMediaType`提取基础类型，并对非EOF读取错误返回已有读取失败结果；不扩展原扩展名或MIME白名单，不改变100MiB限制、空文件约定、保存名称和返回URL。新增测试仍调用生产Register／Upload，核同一短附件、长UTF8文本及原PNG的真实HTTP成功和完整磁盘字节，并核含NUL伪装文本的拒绝／零落盘。

验收驱动继续用原三份固定附件、实际上传接口、HTTP200／code0及逐字读回断言和4秒请求预算，只增加受控失败诊断；不通过换附件类型、直接写uploads或放宽成功码取得绿灯。此生产后端修补与驱动补证随同一候选完成无过滤默认、原UI、Desktop合同及实际Go全包回归，再由新HEAD完成Windows导出与对应新EXE完整安装。版本仍为同一未接受功能4.235.0，不另拆模块或预写未来通过状态。

## 2251合法同名夹具与绝对期限测试前置

产品`2251e2335fac94850727b7858fb5c91c2975bbb7`／树`99aa075b00a82e9f766230d86a7735884911cc1a`的17项首次CI终态为15成功／2失败，全部attempt1。PR测试合并提交`aa76e839a7c25471c7733ce904d2e6192acf259c`的有序父提交为master `c399ca720a20c02e7578e1be116d21644ff1e7a0`与2251，合并树与完整1575文件受测树相同。原失败候选没有手动重跑，其EXE没有被下载、接受或写入安装pin。

### 三上传成功之后的同级重复标题

[Desktop运行39602829055](https://github.com/GuDuYunChen/Local-Notepad/actions/runs/39602829055)／job119231393249已经通过原620项准备、80状态模型、构建及保存／阅读／快捷键流程。三个真实上传回执依次为`export102-a.png`、`export102-b.png`、`export102.txt`，均HTTP200／code0／OK，随后原磁盘逐字断言通过。原46字节文本上传的生产修补在Windows已有本次实际证据，不重新记作未知或未执行。

新导出第14步在创建夹具时停止：第二次向同一父目录POST标题`EXPORT102 重名.md`，生产API返回code1006、detail为`已存在同名文件或文件夹: EXPORT102 重名.md`。原失败日志142882字节，SHA256 `b80000fd94e0377e9864679708c285fccac48b86752a9c7b60d6ae8b77de759f`；Desktop artifact12346609109为4077984字节。报告checks／directoryActions仍为空，complete:false、cleanupComplete:false、forceTerminated:true；原失败图是应用主页，不能视作工作台已进入。该结果证明夹具违反了既有同级名称约束，不证明产品应该接受重复标题。

最小修补保留frozen笔记标题`EXPORT102 重名.md`，将failing笔记改为`EXPORT102 重名.txt`。原创建规则按完整标题去重，两个标题合法不同；生产`exportStem`去除最后扩展名后仍得到相同的`EXPORT102 重名`，所以原Word／Markdown冲突消解必须继续生成独立路径及` (2)`后缀。原始文件oracle按笔记ID核对确切源标题，模拟文件夹具同步为同一合法pair；不能只换成不冲突的导出名称，不能把标题检查改为通配。新增定点回归执行实际driver的创建前缀，并用真实`exportStem`／`prepareExportPlan`验证合法原名和同stem分配；旧driver重复标题负对照与真实生产创建接口的正负结果独立保留。原87条合同名称／顺序、16业务检查、109份正文、100篇继续批次、本地附件、预算和逐字回读保持。

### PR完整回归的30ms真实时间假设

[Save Recovery运行39602835543](https://github.com/GuDuYunChen/Local-Notepad/actions/runs/39602835543)的Linux job119231415096在完整4973项中通过4972项，唯一失败名称是`local overview does not refresh the absolute deadline during response-body wait`；原错误为`Cannot read properties of undefined (reading 'emit')`。原full-ui.json为1328490字节，SHA256 `281e4593a5f49958ca0e14fd68d68502ab4e85f86c628b37986fc1df89136f42`。失败发生在该用例投递正文事件前，Linux后续live-server步骤未运行；同run的Windows成功不能替代此失败。

原用例给生产服务30ms真实预算，调用read后仅等待一轮微任务便假定响应已创建。生产服务在前置校验、创建请求和响应事件都核原绝对截止，因此真实调度延迟可以在请求建立前合法耗尽预算，令`f.res`尚不存在。修补沿用已有原生期限测试的单调时钟控制与finally恢复方式，明确建立响应、在原截止前投递部分正文，再到同一截止边界验证timeout；保留原30ms、原用例名、未close前busy与释放检查。生产时钟、计时器、请求策略和全部安全断言不改，不通过放大timeout、追加sleep或删除用例消除失败。

### 真实主入口的监听配置覆盖

为核对标题接口，用原2251完整main、官方Go1.24.11及隔离NOTEPAD_DATA启动本地后端。PORT=0时实际日志为`http server started listening on [:44875]`，不是预期127.0.0.1；监视器拒绝继续，零API调用，pid97718在parent pipe EOF后正常退出0，未强杀。原日志25452字节，SHA256 `0c1e36d5c3c1c8538dc9428bac9102298185e6e76e56383d38c429fb81347b80`；原main.go为22191字节，SHA256 `e42f460fcfcc0ce3764b57f5a70521c7422bfa452b8d4a2bca255e9689bc8798`。这是实际未修改主入口的观察，不将测试用Go overlay监听代替它。

锁定GoFrame2.7.4的SetPort先清空config.Address，再拼接`:port`；原main先SetAddr("127.0.0.1")再SetPort的调用顺序因此丢失主机限制，影响不限于PORT=0。修补让main通过同一配置函数一次设置`127.0.0.1:`与原解析端口，不改默认27121、端口解析、路由、数据库或serveManaged关闭管理。新增`TestLocalServerListenerUsesLoopbackAddress`启动真实GoFrame服务，核对唯一实际端口及127.0.0.1地址，并用真实HTTP取固定合成响应。原两步配置提取到同函数后，同名回归真实失败于`:44803`；修复后同一回归通过。原未修改main探针、提取后旧配置负例与新配置正例分别保存，不混淆受测源码身份。监听地址接口读取配置与实际分配端口，完整主入口的实际监听／HTTP／EOF结果另行核对；不据此声称已发现外部访问或数据泄漏。

两项CI前置修补和这个已确认主入口缺陷随同一候选冻结，执行原默认全量、原UI及Desktop名册；Go生产源码和新增实际监听回归已变化，必须重新运行原四条Go全量命令和Windows后端构建。其它构建只在完整输入字节相同时复用，涉及的夹具和合同按本次最终输入执行。真实新HEAD Word／Markdown文件、附件、取消／继续、失败重试和正常退出，以及绑定合格新EXE的完整安装生命周期仍须通过；本源码记录不提前宣称未来验收结果。

## 154b真实Windows：最小窗口侧边栏折叠与入口修补

候选`154b113f8d31d712cf918f46796cb303c8c0ae40`、tree`e4a8b860b5f097516402cf0893c1208101181045`的17项首次流程终态为16成功／1失败，全部attempt1。唯一失败为[Desktop运行39607751622](https://github.com/GuDuYunChen/Local-Notepad/actions/runs/39607751622)／job119248269491第14步。原621项准备、80状态模型、保存、阅读及快捷键步骤通过；旧Main的Windows拒绝对照和修复助手冷启动也实际通过。三个夹具上传仍为HTTP200／code0／OK；合法md/txt创建已走过，不再是原1006失败。

原错误`Export fixture folder missing`来自check-local-export-desktop.mjs等待文件夹行。日志141968字节，SHA256 `b78089281dccc849c1bcd19b58ef33eb5016dcaf2553f0a66a80c53ae15f58b8`；artifact12348758209为4104925字节。local-export-desktop.json为4377字节，SHA256 `fb5624cccb7caebb1a0326b9f7a6ad9ae5a53cd1a375c67644912677add2abd6`；失败PNG30001字节，SHA256 `23690e698687a5071937054efa86f951f3b7ee46c7889216bc4482f86599eba5`，IHDR为704×455。原图显示`EXPORT102 Batch 100.md`正文和折叠侧栏。报告11源码blob绑定当前tree，checks及directoryActions仍为空，complete:false、cleanupComplete:false、forceTerminated:true，无正常产品退出回执；不将它计为导出业务完成。

### 实际因果链与最小修补边界

原目录助手正确将主窗口设为720×520，实际客户端宽704。刷新列表在尚无当前笔记时调用App.select；App在innerWidth<=720时设置sidebarCollapsed=true，WorkspaceSidebar只在未折叠时渲染包含FileList的children。驱动却在刷新后直接等data-file-id，没有点击现有“展开侧边栏”。因此即使夹具已存在，列表DOM也会被卸载；仅延长等待或在刷新前展开都没有覆盖这个异步状态变化。

同一入口辅助逻辑用于第一次刷新后定位文件夹和每次“更多笔记操作”前：读取实际折叠／列表加载／目标状态，只通过原按钮的一次真实点击恢复列表，随后核目标和展开状态仍有效。后续点击笔记会再次按生产规则折叠，所以每次导出入口都必须重新观察。双animation-frame只用于核渲染稳定，不能替代尚未完成的列表请求。原等待界限、最小窗口、CDP真实输入方式、产品响应式行为、数据与业务断言均保留；不得直接写组件状态、localStorage或替换桥接绕过，不确定输入不自动重放。

实际App／WorkspaceSidebar／FileList的回归使用明确范围的数据API和编辑器替身，验证原驱动入口失败与修复入口成功；它是DOM层回归，不能冒充Windows原生结果。原88项导出合同、完整默认／UI／Desktop名册必须保留。原Go生产、依赖和构建输入无变化时才能复用已绑定的完整2146事件及交叉构建证据；新的Windows流程仍按原17项完整运行。

此前安装准备中的独立结构fixture曾保留旧的重名md标题，原507项有506通过／1失败。严格oracle没有放松，只同步既定25文件范围内一行后，原507/507与114/114通过；原失败和后续原件分别保存。本次driver镜像及其真实blob继续同步，产品／EXE pin在新候选合格前保持未解析。16项业务检查、109份正文、100篇继续批次、6张原图、正常关闭与资源清理，以及原28门／9产品进程／6组数据比较／20分钟安装验收仍全部必需；不接受154b的EXE、不重跑不变失败、不提前宣布模块完成。


## 当前分支接续修补：预览响应丢失与幂等查回

在当前开发分支的复核中，预览超时修补仍有一个相邻路径未覆盖：底层 IPC promise 直接 reject（例如连接中断）时，原工作台会把它当作确定失败，立即发出取消并清除 requestId。拒绝响应本身并不能证明主进程没有受理请求，因此这可能让下一次点击创建不同的预览请求。此缺口与超时是同一生命周期问题，本次不拆成新模块。

当前修补把 IPC reject 标记为 `local-export-response-lost`，前端使用固定、有限的提示文案而不透传底层异常原文（避免内部路径或过长诊断进入用户界面），并与 `local-export-request-timeout` 使用相同的未知结果处理：保留原 requestId、禁止自动重放、明确显示“查回预览”，用户显式查回时再次使用同一幂等身份；只有收到确定的业务失败回执才清除身份。新增 service 与工作台回归覆盖 reject、超时、同一请求身份复用和确认回执。此处为代码与测试变更说明；未在本会话执行 Vitest、真实 Windows 桌面或安装包验证，不预先宣称通过。


## 当前分支接续修补：异常清理必须返回实际残留路径

本地导出核心在写入中止且清理失败时，原回执只把笔记的预期文档路径填入 `partialPath`。但一个笔记可能已写入图片／附件，清理失败的对象也可能是资源文件；仅报告预期文档路径会漏掉真正残留的文件，且重试失败后可能继续展示已不存在的旧路径。

本次将清理结果改为返回全部未能确认移除的实际路径。回执同时提供兼容字段 `partialPath`（首个真实残留）与 `partialPaths`（完整路径列表）；清理完全成功或文档成功时移除旧残留字段。前端验证数组边界并逐条展示，重试失败后不再保留已清理的陈旧路径。回归以真实本地临时目录写入文档和图片、阻断删除，核对两个真实残留路径与重试不覆盖原字节。该用例已加入源代码，但本会话没有运行 Vitest 或 Windows 桌面流程，因此不宣称测试通过。


## 本轮复核：残留文件未处理时禁止自动重试覆盖

继续复核上一轮残留路径修补时，发现第二个关联风险：核心虽能准确列出无法删除的文档和附件路径，但“仅重试失败项”仍会把带残留文件的失败项当成普通失败项重新执行。重试再次遇到独占创建冲突时，新的清理结果可能为空，旧回执的残留路径又可能被清掉，用户就会失去对原残留文件的提示。

现将残留路径作为明确的重试阻塞条件：核心对仍含 `partialPath/partialPaths` 的失败项拒绝重试，返回 `cleanup-incomplete` 和要求先检查残留路径的说明；IPC的 `canRetry` 只对没有未处理残留的失败项开放；核心描述回执完整传递所有残留路径。回归现在要求重试被拒绝、旧残留路径仍保留且原字节不变。该改动已提交到当前开发分支，但本会话未运行 Vitest 或 Windows 原生流程，不能声称测试已通过。

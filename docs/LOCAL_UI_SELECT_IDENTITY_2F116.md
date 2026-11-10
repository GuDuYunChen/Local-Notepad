# 2F.116 Select 弹层归属修补（候选，仍未完成模块验收）

## 已读取的基线与失败

- 开发基线：985a891519b9be32a033b3ee1bb888f4825169a5，PR29，master保持1c8ec5689847a580ce307b9157fbbc8c1ac43a8f。
- 原失败运行42534755881：UI 126文件中121通过/5失败，2241项中2219通过/22失败；Windows打包被跳过。
- 本轮重新取得原始诊断artifact13639255671。单Select诊断的combobox ID为test-id，aria-controls为test-id_list。独立单控件成功不能证明多个控件间的归属正确。
- rc-util官方useId实现会在NODE_ENV=test且未传显式id时返回test-id。原适配器将undefined id直传Select；驱动器按document.getElementById(aria-controls)获取弹层，因此会拿到同ID的另一个Select弹层。不能通过借用任意可见弹层或直接调用业务回调来掩盖。

## 本次修改

1. UiSelect无显式ID时使用React useId生成实例ID，显式调用方ID优先。测试与产品使用同一实现；不增加环境分支，不改业务值事件、禁用规则、表单值、保存/草稿或数据库。
2. 新增4项真实组件回归：唯一/稳定ID、精确ARIA弹层归属、相同选项值的不同控件不串写、受控双存档选择不反向重置基准。
3. EvidenceReviewArchives原有卷筛选断言仍严格等于JSON.stringify('')；只把读取搜索输入框.value改为读取实际选择值的uiValue。没有删除断言或改期望。
4. 沿用既有完整回归工作流，先保留当前精确源码与锁定依赖供离线复现，再用旧适配器运行新4项测试形成负对照，恢复当前适配器后运行全部原始测试/构建。负对照原件与最终完整结果分别保存，不把负对照失败改写成通过。

## 文档与边界

AGENTS.md已读取；其引用的docs/AI_START_HERE.md在当前精确提交返回404。现有实际阶段依据为docs/LOCAL_UI_CONTROL_AUDIT_2F116.md和仓库当前代码，不凭空声称缺失文档已读取。

本提交发布时尚未取得新代码的完整回归结果。旧985a891失败原样保留。源代码修补不代表全应用视觉、Windows安装升级、独立审核或合并完成。Issue28及PR29保持未验收；main/master不写入，不启动下一业务阶段。

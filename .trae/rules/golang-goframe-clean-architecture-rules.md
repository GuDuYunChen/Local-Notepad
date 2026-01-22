### 1. 核心架构约束

* **分层原则** ：严格遵守 GoFrame V2 推荐的工程化结构。
* `api/`：定义请求/响应 DTO (Data Transfer Object)。
* `internal/controller/`：处理 HTTP 入口，负责参数校验和调用 Service。
* `internal/logic/`： **核心业务逻辑层** ，所有复杂的业务判断、事务处理必须在此层完成。
* `internal/dao/`：数据持久化适配层。
* **单向依赖** ：依赖关系必须是 `Controller -> Service Interface -> Logic -> DAO`。 **严禁循环依赖** 。

### 2. 代码实现规范

* **禁止 Controller 越权** ：
* 禁止在 `controller` 层直接编写 SQL 或调用 `g.DB()`。
* 禁止在 `controller` 层处理复杂的业务逻辑。
* **面向接口编程** ：
* `controller` 调用业务时，必须通过 `service.Xxx().Method()` 调用接口，严禁直接引用 `logic` 包中的具体结构体。
* 每次修改 `logic` 后，务必提醒我运行 `gf gen service` 更新接口定义。
* **模型使用规范** ：
* **API 层** ：仅允许使用 `api` 目录下的 `Req` 和 `Res` 结构体。
* **Logic 层** ：使用 `internal/model` 下定义的输入/输出模型（Input/Output structs）。
* **DAO 层** ：仅使用 `internal/model/entity` (纯净实体) 或 `internal/model/do` (领域对象)。
* *原则：禁止将数据库实体 (Entity) 直接作为 API 响应返回给前端。*

### 3. 错误处理与日志

* **错误包装** ：使用 `gerror` 处理错误。在 `logic` 层返回错误时，应使用 `gerror.Wrap(err, "具体业务语境")`。
* **状态码** ：所有业务错误应关联相应的 `gcode`。

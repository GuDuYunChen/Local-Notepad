# Golang 后端开发规范

- **错误处理**:

  - 严禁忽略错误，必须使用 `if err != nil` 处理。
  - 错误信息应具有上下文，使用 `fmt.Errorf("context: %w", err)` 包装。
- **依赖注入**: 优先手动构造结构体进行依赖注入，保持代码可测试性。
- **并发**: 只有在明确需要时才开启 Goroutine，且必须考虑上下文（context.Context）控制和超时。
- **接口设计**: 接口定义应放在“使用者”侧，而不是“实现者”侧（Consumer-side interfaces）。
- **数据库**: 使用 GORM 时，必须在 SQL 语句中指定具体字段，避免使用 `SELECT *`。

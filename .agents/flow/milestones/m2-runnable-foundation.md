# 阶段 2：可运行全栈基座

[English](m2-runnable-foundation.en.md) | 中文

```yaml flow
kind: milestone
id: m2
title: 阶段 2：可运行全栈基座
status: planned
github:
  number: 2
  url: https://github.com/Shadow-Azure/ZTask/milestone/2
```

建立可由一条命令启动的本地全栈工程，先固定 API、文件存储和前端壳的公共边界。此阶段只交付可运行的基础设施，不提前实现任务业务闭环。

## 交付边界

- 只交付本阶段 issue 声明的能力，后续阶段功能不以隐藏实现提前混入。
- 所有实现遵循 `plan/fullstack-design/` 与定稿原型；非平凡决策登记 Agent Note。

## 阶段验收

- 一条命令启动 Fastify 与同源 Vue Web，默认只监听 loopback。
- 共享 DTO、错误模型、文件写入与恢复协议有可运行的自动化测试。
- 管理端与成员端路由、原型设计令牌、请求缓存和响应式壳可复用。

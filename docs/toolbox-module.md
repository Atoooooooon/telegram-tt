# Telegram TT Toolbox (工具箱模块) 开发指南

## 1. 模块定位

`Toolbox` 是一个独立于核心聊天功能和客服模块的通用工具容器。它旨在提供一系列辅助性、管理性或实验性的功能（例如：账号群组对比、批量操作、数据导出等），以插件化的形式集成到客户端中。

## 2. 架构设计

为了避免污染核心代码并支持未来的快速扩展，Toolbox 采用以下架构原则：

*   **独立性**：所有工具箱代码集中在 `src/components/toolbox` 下。
*   **插件化**：每个具体工具（Tool）拥有独立的文件夹，包含其 UI 和 逻辑。
*   **统一入口**：通过统一的 Modal（模态框）展示工具列表，并在左侧菜单栏提供入口。
*   **状态管理**：复用现有的 Global State 模式，但在 `tabState` 中维护工具箱的 UI 状态。

### 2.1 目录结构

```text
src/
├── components/
│   └── toolbox/
│       ├── index.ts              # 模块导出入口
│       ├── entry/                # 侧边栏入口组件
│       │   └── ToolboxEntry.tsx
│       ├── ui/                   # 工具箱主界面框架
│       │   ├── ToolboxModal.tsx  # 模态框容器
│       │   ├── ToolboxSidebar.tsx # 工具箱内部导航
│       │   └── ToolboxContent.tsx # 工具箱内容渲染区
│       └── tools/                # 具体工具集 (在此添加新功能)
│           ├── groupDiff/        # [示例] 群组对比工具
│           │   ├── GroupDiffTool.tsx
│           │   └── hooks.ts
│           └── ...
├── global/
│   ├── types/
│   │   └── toolbox.ts            # 类型定义
│   ├── actions/
│   │   └── ui/
│   │       └── toolbox.ts        # Actions (openToolbox, setTool, etc.)
│   └── selectors/
│       └── toolbox.ts            # Selectors
```

## 3. 状态管理 (State Management)

Toolbox 的状态存储在 `TabState` 中，因为 UI 状态通常是 Tab 隔离的。

### Types (`src/global/types/toolbox.ts`)

```typescript
export type ToolboxState = {
  isOpen: boolean;
  activeToolId?: string;
};

// 工具注册接口
export interface ToolDefinition {
  id: string;
  title: string; // 国际化 Key 或直接字符串
  icon: string;  // 图标名称
  component: React.FC;
}
```

### Actions (`src/global/actions/ui/toolbox.ts`)

*   `openToolbox()`: 打开工具箱模态框。
*   `closeToolbox()`: 关闭工具箱。
*   `setToolboxActiveTool(toolId: string)`: 切换当前显示的工具。

## 4. 开发指南：如何添加新工具

当你需要添加一个新的小功能（例如：批量退群）时，请遵循以下步骤：

1.  **创建工具组件**：
    在 `src/components/toolbox/tools/` 下创建一个新文件夹（例如 `batchLeave`），并编写你的 React 组件。
    *   可以使用 `useGlobal()` 或 `getGlobal()` 访问 Telegram 数据（如 `chats`, `users`）。
    *   可以使用 `getDispatch()` 或 `getActions()` 触发 API 调用。

2.  **注册工具**：
    在 `src/components/toolbox/tools/registry.ts` (建议新建此文件用于统一管理) 中注册你的工具。

    ```typescript
    // src/components/toolbox/tools/registry.ts
    import BatchLeaveTool from './batchLeave/BatchLeaveTool';

    export const TOOLS: ToolDefinition[] = [
      {
        id: 'groupDiff',
        title: '群组缺漏检测',
        icon: 'group',
        component: GroupDiffTool,
      },
      {
        id: 'batchLeave',
        title: '批量退群', // 建议使用 lang('ToolboxBatchLeave')
        icon: 'delete',
        component: BatchLeaveTool,
      },
    ];
    ```

3.  **开发与调试**：
    *   工具箱已集成在主界面左侧，点击即可打开测试。
    *   尽量将业务逻辑封装在工具内部，避免修改 `src/global` 下的核心文件，除非必须复用逻辑。

## 5. 核心 API 参考

开发工具时，你可能经常需要访问以下数据：

*   **获取所有群组**: `global.chats.byId`
*   **获取当前用户**: `global.currentUserId`
*   **发送 API 请求**: 参考 `src/api/gramjs` 下的方法或直接调用 `callApi` (如果已暴露)。

import GroupDiffTool from './groupDiff/GroupDiffTool';
import type { ToolDefinition } from '../../../global/types/toolbox';

export const TOOLS: ToolDefinition[] = [
  {
    id: 'groupDiff',
    title: '群组缺漏检测',
    icon: 'group', // 需要确认图标系统中是否有此图标，暂时使用 generic
    description: '输入目标群组列表，对比当前账号已加入的群组，快速找出缺失的群聊。',
    component: GroupDiffTool,
  },
];

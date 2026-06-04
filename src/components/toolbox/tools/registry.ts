import type { ToolDefinition } from '../../../global/types/toolbox';

import GroupDiffTool from './groupDiff/GroupDiffTool';

export const TOOLS: ToolDefinition[] = [
  {
    id: 'groupDiff',
    title: '差异对比工具',
    icon: 'group', // 需要确认图标系统中是否有此图标，暂时使用 generic
    description: '对比两个好友的共同群组（或我与好友的群组），分析成员分布差异并进行快速邀请或移除。',
    component: GroupDiffTool,
  },
];

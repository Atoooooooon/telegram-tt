import type { FC } from '../../lib/teact/teact';
import type { IconName } from '../../types/icons';

export type ToolboxState = {
  isOpen: boolean;
  activeToolId?: string;
};

export type ToolDefinition = {
  id: string;
  title: string;
  icon: IconName;
  description?: string;
  component: FC;
};

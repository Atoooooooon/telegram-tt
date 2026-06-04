import type { GlobalState } from '../types';
import type { ToolboxState } from '../types/toolbox';

export function selectToolboxState(global: GlobalState, tabId: number): ToolboxState | undefined {
  const tabState = global.byTabId[tabId];
  return tabState?.toolbox;
}

export function selectIsToolboxOpen(global: GlobalState, tabId: number): boolean {
  return Boolean(selectToolboxState(global, tabId)?.isOpen);
}

export function selectToolboxActiveToolId(global: GlobalState, tabId: number): string | undefined {
  return selectToolboxState(global, tabId)?.activeToolId;
}

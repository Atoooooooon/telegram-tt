import { addActionHandler } from '../../index';
import type { ActionReturnType } from '../../types';
import type { GlobalState } from '../../types';
import type { ToolboxState } from '../../types/toolbox';
import { updateTabState } from '../../reducers/tabs';
import { getCurrentTabId } from '../../../util/establishMultitabRole';

addActionHandler('openToolbox', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateToolboxState(global, tabId, {
    isOpen: true,
  });
});

addActionHandler('closeToolbox', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateToolboxState(global, tabId, {
    isOpen: false,
  });
});

addActionHandler('setToolboxActiveTool', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId(), toolId } = payload || {};
  if (!toolId) {
    return global;
  }

  return updateToolboxState(global, tabId, {
    activeToolId: toolId,
  });
});

function updateToolboxState(
  global: GlobalState,
  tabId: number,
  updates: Partial<ToolboxState>,
): GlobalState {
  const tabState = global.byTabId[tabId];
  const currentToolboxState = tabState.toolbox || { isOpen: false };

  const nextToolboxState: ToolboxState = {
    ...currentToolboxState,
    ...updates,
  };

  return updateTabState(global, {
    toolbox: nextToolboxState,
  }, tabId);
}

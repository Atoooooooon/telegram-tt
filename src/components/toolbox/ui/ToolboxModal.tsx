import type { FC } from '../../../lib/teact/teact';
import {
  memo, useCallback, useEffect, useMemo, useState,
} from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import { selectIsToolboxOpen, selectToolboxActiveToolId } from '../../../global/selectors/toolbox';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { TOOLS } from '../tools/registry';

import Icon from '../../common/icons/Icon';
import Modal from '../../ui/Modal';
import SearchInput from '../../ui/SearchInput';

import styles from './ToolboxModal.module.scss';

type StateProps = {
  isOpen: boolean;
  activeToolId?: string;
};

const ToolboxModal: FC<StateProps> = ({ isOpen, activeToolId }) => {
  const { closeToolbox, setToolboxActiveTool } = getActions();
  const [searchValue, setSearchValue] = useState('');
  const tabId = getCurrentTabId();

  useEffect(() => {
    if (!isOpen && searchValue) {
      setSearchValue('');
    }
  }, [isOpen, searchValue]);

  const filteredTools = useMemo(() => {
    const normalized = searchValue.trim().toLowerCase();
    if (!normalized) {
      return TOOLS;
    }

    return TOOLS.filter((tool) => {
      const description = tool.description?.toLowerCase() || '';
      return (
        tool.title.toLowerCase().includes(normalized)
        || description.includes(normalized)
      );
    });
  }, [searchValue]);

  // 默认选中第一个可见工具，同时在搜索时保持选中项有效
  useEffect(() => {
    if (!isOpen || filteredTools.length === 0) {
      return;
    }

    if (!activeToolId || !filteredTools.some((tool) => tool.id === activeToolId)) {
      setToolboxActiveTool({ toolId: filteredTools[0].id, tabId });
    }
  }, [isOpen, activeToolId, filteredTools, setToolboxActiveTool, tabId]);

  const activeTool = useMemo(() =>
    TOOLS.find((t) => t.id === activeToolId),
  [activeToolId]);

  const ActiveComponent = activeTool?.component;
  const hasSearchTerm = Boolean(searchValue.trim());
  const hasSearchResults = filteredTools.length > 0;
  const hasTools = TOOLS.length > 0;
  const shouldShowSearchEmptyState = hasSearchTerm && !hasSearchResults;

  const handleClose = () => closeToolbox({ tabId });
  const handleToolSelect = useCallback((toolId: string) => {
    setToolboxActiveTool({ toolId, tabId });
  }, [setToolboxActiveTool, tabId]);
  const handleResetSearch = useCallback(() => {
    setSearchValue('');
  }, []);

  if (!isOpen) {
    return undefined;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className={styles.modal}
      dialogClassName={styles.dialog}
      contentClassName={styles.modalContent}
      title="工具箱"
    >
      <div className={styles.container}>
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <div className={styles.sidebarTitle}>工具列表</div>
            {hasTools && (
              <SearchInput
                className={styles.searchInput}
                placeholder="搜索工具"
                value={searchValue}
                onChange={setSearchValue}
                onReset={handleResetSearch}
              />
            )}
          </div>
          <div className={styles.toolList}>
            {shouldShowSearchEmptyState ? (
              <div className={styles.emptyState}>
                <h4>没有匹配的工具</h4>
                <p>换个关键词再试试。</p>
              </div>
            ) : hasTools ? (
              filteredTools.map((tool) => (
                <button
                  type="button"
                  key={tool.id}
                  className={`${styles.sidebarItem} ${tool.id === activeToolId ? styles.sidebarItemActive : ''}`}
                  onClick={() => handleToolSelect(tool.id)}
                >
                  <span className={styles.sidebarItemIcon}>
                    <Icon name={tool.icon} />
                  </span>
                  <span>
                    <span className={styles.sidebarItemTitle}>{tool.title}</span>
                    {tool.description && (
                      <span className={styles.sidebarItemDescription}>{tool.description}</span>
                    )}
                  </span>
                </button>
              ))
            ) : (
              <div className={styles.emptyState}>
                <h4>暂无工具</h4>
                <p>后续会在这里呈现新的功能模块。</p>
              </div>
            )}
          </div>
        </div>
        <div className={styles.content}>
          {shouldShowSearchEmptyState ? (
            <div className={styles.placeholder}>
              <h3>没有找到匹配的工具</h3>
              <p className={styles.placeholderHint}>调整搜索关键字或清空搜索即可回到完整列表。</p>
            </div>
          ) : (activeTool && ActiveComponent) ? (
            <div className={styles.activeTool}>
              <div className={styles.activeToolHeader}>
                <div className={styles.activeToolIcon}>
                  <Icon name={activeTool.icon} />
                </div>
                <div>
                  <h3 className={styles.activeToolTitle}>{activeTool.title}</h3>
                  {activeTool.description && (
                    <p className={styles.activeToolDescription}>{activeTool.description}</p>
                  )}
                </div>
              </div>
              <div className={styles.toolSurface}>
                <ActiveComponent />
              </div>
            </div>
          ) : (
            <div className={styles.placeholder}>
              {hasTools ? (
                <>
                  <h3>请选择一个工具</h3>
                  <p className={styles.placeholderHint}>左侧列表会随着工具增多自动分组并支持搜索。</p>
                </>
              ) : (
                <>
                  <h3>暂无可用工具</h3>
                  <p className={styles.placeholderHint}>准备就绪后，这里会列出所有内部工具。</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default memo(withGlobal<Record<never, never>>(
  (global): StateProps => {
    const tabId = getCurrentTabId();
    return {
      isOpen: selectIsToolboxOpen(global, tabId),
      activeToolId: selectToolboxActiveToolId(global, tabId),
    };
  },
)(ToolboxModal));

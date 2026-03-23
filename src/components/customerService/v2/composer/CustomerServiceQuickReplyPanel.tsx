import type { FC } from '../../../../lib/teact/teact';
import {
  memo, useEffect, useRef, useState,
} from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { CustomerServiceQuickReply } from '../../../../global/types/customerServiceV2';

import { CUSTOMER_SERVICE_CONFIG } from '../../../../config/customerService';
import { DEBUG, EDITABLE_INPUT_ID } from '../../../../config';
import { normalizeCustomerServiceQuickReplies } from '../../../../global/helpers/customerServiceV2Settings';
import {
  selectCustomerServiceV2Settings,
  selectIsCustomerServiceV2Open,
} from '../../../../global/selectors/customerServiceV2';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';
import useLastCallback from '../../../../hooks/useLastCallback';
import useLang from '../../../../hooks/useLang';
import buildClassName from '../../../../util/buildClassName';
import focusEditableElement from '../../../../util/focusEditableElement';
import Portal from '../../../ui/Portal';

import styles from './CustomerServiceQuickReplyPanel.module.scss';

type OwnProps = {};

type StateProps = {
  quickReplies: CustomerServiceQuickReply[];
  isPanelEnabled: boolean;
  isGlobalEnabled: boolean;
};

type PanelPosition = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const clampValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const MIN_LEFT_OFFSET = 16;
const MIN_PANEL_WIDTH = 288;
const MIN_PANEL_HEIGHT = 220;
const DEFAULT_PANEL_HEIGHT = 320;
const DEFAULT_VERTICAL_OFFSET = 320;
const POSITION_STORAGE_KEY = 'customerServiceQuickReplyPanelPosition';

const CustomerServiceQuickReplyPanel: FC<OwnProps & StateProps> = ({
  quickReplies,
  isPanelEnabled,
  isGlobalEnabled,
}) => {
  const { applyCustomerServiceQuickReply } = getActions();
  const lang = useLang();

  const [panelPosition, setPanelPositionState] = useState<PanelPosition | undefined>();
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const debugStateRef = useRef<Record<string, unknown>>({});

  const panelRef = useRef<HTMLDivElement>();
  const panelPositionRef = useRef<PanelPosition | undefined>();
  const storedPositionRef = useRef<{
    left: number;
    top: number;
    width?: number;
    height?: number;
  } | undefined>();
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | undefined>();
  const resizeStateRef = useRef<{
    startX: number;
    startY: number;
    originWidth: number;
    originHeight: number;
  } | undefined>();
  const hoverTimeoutRef = useRef<number>();

  const hasQuickReplies = quickReplies.length > 0;
  const isActivationAllowed = isPanelEnabled || isGlobalEnabled;
  const isVisible = isActivationAllowed && hasQuickReplies && (isInputFocused || isHovering);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = localStorage.getItem(POSITION_STORAGE_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);
      if (
        parsed
        && typeof parsed.left === 'number'
        && typeof parsed.top === 'number'
        && Number.isFinite(parsed.left)
        && Number.isFinite(parsed.top)
      ) {
        storedPositionRef.current = {
          left: parsed.left,
          top: parsed.top,
          width: typeof parsed.width === 'number' && Number.isFinite(parsed.width)
            ? parsed.width
            : undefined,
          height: typeof parsed.height === 'number' && Number.isFinite(parsed.height)
            ? parsed.height
            : undefined,
        };
      }
    } catch (error) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn('[CustomerServiceQuickReplyPanel] Failed to read stored position', error);
      }
    }
  }, []);

  const setPanelPosition = useLastCallback((next: PanelPosition | undefined) => {
    panelPositionRef.current = next;

    setPanelPositionState((prev) => {
      if (
        prev
        && next
        && prev.left === next.left
        && prev.top === next.top
        && prev.width === next.width
        && prev.height === next.height
      ) {
        return prev;
      }

      return next;
    });
  });

  const persistPosition = useLastCallback((left: number, top: number, width: number, height: number) => {
    storedPositionRef.current = {
      left,
      top,
      width,
      height,
    };
    try {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(storedPositionRef.current));
    } catch (error) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn('[CustomerServiceQuickReplyPanel] Failed to persist position', error);
      }
    }
  });

  const updatePanelPosition = useLastCallback(() => {
    const input = document.getElementById(EDITABLE_INPUT_ID);
    if (!input) {
      setPanelPosition(undefined);
      return;
    }

    const rect = input.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      requestAnimationFrame(updatePanelPosition);
      return;
    }

    const saved = storedPositionRef.current;
    const viewportWidth = document.documentElement?.clientWidth || window.innerWidth || rect.width;
    const viewportHeight = document.documentElement?.clientHeight || window.innerHeight || rect.height;

    const maxWidth = Math.max(MIN_PANEL_WIDTH, viewportWidth - (MIN_LEFT_OFFSET * 2));
    const defaultWidth = clampValue(rect.width || MIN_PANEL_WIDTH, MIN_PANEL_WIDTH, maxWidth);
    let width = saved?.width ?? defaultWidth;
    width = clampValue(width, MIN_PANEL_WIDTH, maxWidth);

    const maxLeft = Math.max(MIN_LEFT_OFFSET, viewportWidth - width - MIN_LEFT_OFFSET);
    const defaultLeft = clampValue(viewportWidth - width - MIN_LEFT_OFFSET, MIN_LEFT_OFFSET, maxLeft);
    let left = saved?.left ?? defaultLeft;
    left = clampValue(left, MIN_LEFT_OFFSET, maxLeft);

    const defaultTopCandidate = rect.top - DEFAULT_VERTICAL_OFFSET;
    const maxTopForMinHeight = Math.max(MIN_LEFT_OFFSET, viewportHeight - MIN_PANEL_HEIGHT - MIN_LEFT_OFFSET);
    let top = saved?.top ?? defaultTopCandidate;
    top = clampValue(top, MIN_LEFT_OFFSET, maxTopForMinHeight);

    const maxHeightForTop = Math.max(MIN_PANEL_HEIGHT, viewportHeight - top - MIN_LEFT_OFFSET);
    let height = saved?.height ?? DEFAULT_PANEL_HEIGHT;
    height = clampValue(height, MIN_PANEL_HEIGHT, maxHeightForTop);

    const allowedTopWithHeight = Math.max(MIN_LEFT_OFFSET, viewportHeight - height - MIN_LEFT_OFFSET);
    if (top > allowedTopWithHeight) {
      top = allowedTopWithHeight;
    }

    const adjustedMaxHeight = Math.max(MIN_PANEL_HEIGHT, viewportHeight - top - MIN_LEFT_OFFSET);
    if (height > adjustedMaxHeight) {
      height = adjustedMaxHeight;
    }

    const shouldPersist = !saved
      || saved.left !== left
      || saved.top !== top
      || saved.width !== width
      || saved.height !== height;

    if (shouldPersist) {
      persistPosition(left, top, width, height);
    }

    setPanelPosition({
      left,
      top,
      width,
      height,
    });
  });

  useEffect(() => {
    if (isActivationAllowed) {
      requestAnimationFrame(updatePanelPosition);
    } else {
      setIsInputFocused(false);
      setPanelPosition(undefined);
    }
  }, [isActivationAllowed, updatePanelPosition]);

  useEffect(() => () => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isActivationAllowed) {
      return undefined;
    }

    let cleanup: (() => void) | undefined;
    let observer: MutationObserver | undefined;

    const attachListeners = () => {
      const input = document.getElementById(EDITABLE_INPUT_ID) as HTMLElement | null;
      if (!input) {
        return false;
      }

      const handleFocus = () => {
        setIsInputFocused(true);
        requestAnimationFrame(updatePanelPosition);
      };

      const handleBlur = () => {
        requestAnimationFrame(() => {
          const active = document.activeElement as HTMLElement | null;
          const isInsidePanel = Boolean(active && panelRef.current?.contains(active));
          if (
            active?.id !== EDITABLE_INPUT_ID
            && !isInsidePanel
          ) {
            setIsInputFocused(false);
          }
        });
      };

      input.addEventListener('focus', handleFocus);
      input.addEventListener('blur', handleBlur);

      if (document.activeElement === input) {
        setIsInputFocused(true);
        requestAnimationFrame(updatePanelPosition);
      }

      cleanup = () => {
        input.removeEventListener('focus', handleFocus);
        input.removeEventListener('blur', handleBlur);
      };

      return true;
    };

    if (!attachListeners()) {
      observer = new MutationObserver(() => {
        if (attachListeners()) {
          observer?.disconnect();
          observer = undefined;
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      cleanup?.();
      observer?.disconnect();
    };
  }, [isActivationAllowed, updatePanelPosition]);

  const handleMouseEnter = useLastCallback(() => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
    setIsHovering(true);
  });

  const handleMouseLeave = useLastCallback(() => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
    }

    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsHovering(false);
    }, 120);
  });

  const focusComposerInput = useLastCallback(() => {
    const input = document.getElementById(EDITABLE_INPUT_ID);
    if (input) {
      requestAnimationFrame(() => {
        focusEditableElement(input, true, true);
      });
    }
  });

  const handleSelectQuickReply = useLastCallback((
    reply: CustomerServiceQuickReply,
    overrideText?: string,
  ) => {
    const baseText = overrideText ?? reply.text;
    const trimmedText = baseText.trim();
    if (!trimmedText) {
      setIsHovering(false);
      return;
    }

    applyCustomerServiceQuickReply({
      quickReply: {
        ...reply,
        text: trimmedText,
      },
    });
    setIsHovering(false);
    focusComposerInput();
  });

  useEffect(() => {
    if (isGlobalEnabled) {
      requestAnimationFrame(updatePanelPosition);
    }
  }, [isGlobalEnabled, updatePanelPosition]);

  const handleDragStart = useLastCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!panelPositionRef.current) {
      return;
    }

    event.preventDefault();

    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originLeft: panelPositionRef.current.left,
      originTop: panelPositionRef.current.top,
    };

    setIsDragging(true);
  });

  const handleTouchStart = useLastCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!panelPositionRef.current || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    dragStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      originLeft: panelPositionRef.current.left,
      originTop: panelPositionRef.current.top,
    };

    setIsDragging(true);
  });

  const handleResizeMouseDown = useLastCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!panelPositionRef.current) {
      return;
    }

    event.preventDefault();

    resizeStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originWidth: panelPositionRef.current.width,
      originHeight: panelPositionRef.current.height,
    };

    setIsResizing(true);
  });

  const handleResizeTouchStart = useLastCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!panelPositionRef.current || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    resizeStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      originWidth: panelPositionRef.current.width,
      originHeight: panelPositionRef.current.height,
    };

    setIsResizing(true);
  });

  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    const movePanel = (clientX: number, clientY: number) => {
      if (!dragStateRef.current || !panelPositionRef.current) {
        return;
      }

      const viewportWidth = document.documentElement?.clientWidth || window.innerWidth || panelPositionRef.current.width;
      const viewportHeight = document.documentElement?.clientHeight || window.innerHeight
        || panelPositionRef.current.height
        || DEFAULT_PANEL_HEIGHT;
      const width = panelPositionRef.current.width;
      const height = panelPositionRef.current.height;

      const maxLeft = Math.max(MIN_LEFT_OFFSET, viewportWidth - width - MIN_LEFT_OFFSET);
      const maxTop = Math.max(MIN_LEFT_OFFSET, viewportHeight - height - MIN_LEFT_OFFSET);

      const deltaX = clientX - dragStateRef.current.startX;
      const deltaY = clientY - dragStateRef.current.startY;

      const nextLeft = clampValue(dragStateRef.current.originLeft + deltaX, MIN_LEFT_OFFSET, maxLeft);
      const nextTop = clampValue(dragStateRef.current.originTop + deltaY, MIN_LEFT_OFFSET, maxTop);

      setPanelPosition({
        left: nextLeft,
        top: nextTop,
        width,
        height,
      });
    };

    const handleMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      movePanel(event.clientX, event.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return;
      }

      const touch = event.touches[0];
      movePanel(touch.clientX, touch.clientY);
    };

    const handleEnd = () => {
      setIsDragging(false);
      dragStateRef.current = undefined;

      if (panelPositionRef.current) {
        persistPosition(
          panelPositionRef.current.left,
          panelPositionRef.current.top,
          panelPositionRef.current.width,
          panelPositionRef.current.height,
        );
      }

      document.body.classList.remove('cursor-grabbing');
    };

    document.body.classList.add('cursor-grabbing');

    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleEnd, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleEnd, { passive: true });
    document.addEventListener('touchcancel', handleEnd, { passive: true });
    document.addEventListener('blur', handleEnd, { passive: true });

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleEnd);
      document.removeEventListener('blur', handleEnd);
      document.body.classList.remove('cursor-grabbing');

    };
  }, [isDragging, persistPosition, setPanelPosition]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const resizePanel = (clientX: number, clientY: number) => {
      if (!resizeStateRef.current || !panelPositionRef.current) {
        return;
      }

      const viewportWidth = document.documentElement?.clientWidth || window.innerWidth || panelPositionRef.current.width;
      const viewportHeight = document.documentElement?.clientHeight || window.innerHeight
        || panelPositionRef.current.height
        || DEFAULT_PANEL_HEIGHT;

      const deltaX = clientX - resizeStateRef.current.startX;
      const deltaY = clientY - resizeStateRef.current.startY;

      const maxWidth = Math.max(MIN_PANEL_WIDTH, viewportWidth - panelPositionRef.current.left - MIN_LEFT_OFFSET);
      const nextWidth = clampValue(
        resizeStateRef.current.originWidth + deltaX,
        MIN_PANEL_WIDTH,
        maxWidth,
      );

      const maxHeight = Math.max(MIN_PANEL_HEIGHT, viewportHeight - panelPositionRef.current.top - MIN_LEFT_OFFSET);
      const nextHeight = clampValue(resizeStateRef.current.originHeight + deltaY, MIN_PANEL_HEIGHT, maxHeight);

      setPanelPosition({
        left: panelPositionRef.current.left,
        top: panelPositionRef.current.top,
        width: nextWidth,
        height: nextHeight,
      });
    };

    const handleMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      resizePanel(event.clientX, event.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return;
      }

      const touch = event.touches[0];
      resizePanel(touch.clientX, touch.clientY);
    };

    const handleEnd = () => {
      setIsResizing(false);
      resizeStateRef.current = undefined;

      if (panelPositionRef.current) {
        persistPosition(
          panelPositionRef.current.left,
          panelPositionRef.current.top,
          panelPositionRef.current.width,
          panelPositionRef.current.height,
        );
      }

      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'nwse-resize';

    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleEnd, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleEnd, { passive: true });
    document.addEventListener('touchcancel', handleEnd, { passive: true });
    document.addEventListener('blur', handleEnd, { passive: true });

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleEnd);
      document.removeEventListener('blur', handleEnd);
      document.body.style.cursor = '';
    };
  }, [isResizing, persistPosition, setPanelPosition]);

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.id === EDITABLE_INPUT_ID) {
        setIsInputFocused(true);
        requestAnimationFrame(updatePanelPosition);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.id !== EDITABLE_INPUT_ID) {
        return;
      }

      requestAnimationFrame(() => {
        const active = document.activeElement as HTMLElement | null;
        const isInsidePanel = Boolean(active && panelRef.current?.contains(active));
        if (active?.id !== EDITABLE_INPUT_ID && !isInsidePanel) {
          setIsInputFocused(false);
        }
      });
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [updatePanelPosition]);

  useEffect(() => {
    const snapshot = {
      panelEnabled: isPanelEnabled,
      globalEnabled: isGlobalEnabled,
      activationAllowed: isActivationAllowed,
      hasQuickReplies,
      quickRepliesCount: quickReplies.length,
      isInputFocused,
      isHovering,
      isVisible,
      isDragging,
      isResizing,
      panelPosition,
    };

    if (typeof window !== 'undefined') {
      (window as any).__tgCustomerServiceQuickReplyDebug = snapshot;
    }

    // eslint-disable-next-line no-console
    console.info('[CustomerServiceQuickReplyPanel]', snapshot);
  }, [
    hasQuickReplies,
    isDragging,
    isHovering,
    isInputFocused,
    isPanelEnabled,
    isGlobalEnabled,
    isActivationAllowed,
    isVisible,
    isResizing,
    panelPosition,
    quickReplies,
  ]);

  useEffect(() => {
    if (!isVisible || !panelRef.current) {
      return;
    }

    const rect = panelRef.current.getBoundingClientRect();
    // eslint-disable-next-line no-console
    console.info('[CustomerServiceQuickReplyPanel] panel DOM rect', rect);
  }, [isVisible, panelPosition]);

  if (!isVisible || !panelPosition) {
    if (DEBUG) {
      debugStateRef.current = {
        isPanelEnabled,
        isGlobalEnabled,
        isActivationAllowed,
        hasQuickReplies,
        quickReplies: quickReplies.length,
        isInputFocused,
        isHovering,
        isDragging,
        isResizing,
        panelPosition,
      };

      (window as any).__tgCustomerServiceQuickReplyDebug = debugStateRef.current;
    }

    return undefined;
  }

  return (
    <Portal>
      <div
        ref={panelRef}
        className={buildClassName(
          styles.panel,
          styles.panelVisible,
          isDragging && styles.panelDragging,
          isResizing && styles.panelResizing,
        )}
        style={`left: ${panelPosition.left}px; top: ${panelPosition.top}px; width: ${panelPosition.width}px; height: ${panelPosition.height}px;`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div
          className={styles.header}
          onMouseDown={handleDragStart}
          onTouchStart={handleTouchStart}
        >
          <span>{lang('CustomerServiceQuickReplies')}</span>
        </div>
        <div className={styles.list}>
          {quickReplies.map((reply, index) => {
            const englishText = (reply.englishText || '').trim();
            const hasEnglish = Boolean(englishText);

            return (
              <div
                key={`quick-reply-${index}`}
                className={styles.item}
                data-mode={reply.mode}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectQuickReply(reply)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSelectQuickReply(reply);
                  }
                }}
              >
                <span className={styles.itemText}>{reply.text}</span>
                {hasEnglish && (
                  <div className={styles.itemEnglishRow}>
                    <button
                      type="button"
                      className={styles.itemEnglishButton}
                      data-mode={reply.mode}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSelectQuickReply(reply, englishText);
                      }}
                      aria-label={lang('CustomerServiceQuickReplyEnglishAriaLabel')}
                    >
                      {lang('CustomerServiceQuickReplyEnglishTag')}
                    </button>
                    <span className={styles.itemEnglishText}>{englishText}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div
          className={styles.resizeHandle}
          onMouseDown={handleResizeMouseDown}
          onTouchStart={handleResizeTouchStart}
        />
      </div>
    </Portal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): StateProps => {
    const tabId = getCurrentTabId();
    const settings = selectCustomerServiceV2Settings(global, tabId);
    const quickReplies = normalizeCustomerServiceQuickReplies(
      settings?.quickReplies && settings.quickReplies.length
        ? settings.quickReplies
        : CUSTOMER_SERVICE_CONFIG.QUICK_REPLIES,
    );
    const isCustomerServiceOpen = selectIsCustomerServiceV2Open(global, tabId);

    return {
      quickReplies,
      isPanelEnabled: isCustomerServiceOpen,
      isGlobalEnabled: Boolean(settings?.quickReplyPanelGlobal),
    };
  },
)(CustomerServiceQuickReplyPanel));

import type { ChangeEvent } from 'react';
import type { ElementRef } from '../../lib/teact/teact';
import type React from '../../lib/teact/teact';
import { memo, useEffect, useRef } from '../../lib/teact/teact';

import buildClassName from '../../util/buildClassName';

type OwnProps = {
  id?: string;
  value?: string;
  label?: string;
  error?: string;
  ref?: ElementRef<HTMLSelectElement>;
  hasArrow?: boolean;
  tabIndex?: number;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
};

const Select = (props: OwnProps) => {
  const {
    id,
    value,
    label,
    hasArrow,
    error,
    ref,
    tabIndex,
    onChange,
    children,
  } = props;
  const labelText = error || label;
  const fullClassName = buildClassName(
    'input-group',
    value && 'touched',
    error && 'error',
    labelText && 'with-label',
    hasArrow && 'with-arrow',
    'input-group',
  );

  const selectRef = useRef<HTMLSelectElement>();

  // Browsers silently ignore `select.value = x` when the matching <option> does
  // not exist yet. Options may be added asynchronously (e.g. loaded from the
  // server), so re-sync the DOM value after every render to keep it correct.
  useEffect(() => {
    if (selectRef.current) {
      selectRef.current.value = value || '';
    }
  });

  return (
    <div className={fullClassName}>
      <select
        className="form-control"
        id={id}
        ref={ref || selectRef}
        value={value || ''}
        onChange={onChange}
        tabIndex={tabIndex}
      >
        {children}
      </select>
      {labelText && id && (
        <label htmlFor={id}>{labelText}</label>
      )}
    </div>
  );
};

export default memo(Select);

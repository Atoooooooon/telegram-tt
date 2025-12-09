/**
 * Template renderer utility
 * Supports {{variable}} syntax with nested object access
 */

/**
 * Render template string by replacing {{variables}}
 * Supports nested properties using dot notation: {{user.name}}
 *
 * @param template - Template string with {{variable}} placeholders
 * @param data - Data object containing variable values
 * @returns Rendered string
 */
export function renderTemplate(
  template: string,
  data: Record<string, any>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const trimmedPath = path.trim();
    const value = getNestedValue(data, trimmedPath);

    if (value === undefined || value === null) {
      return '';
    }

    return String(value);
  });
}

/**
 * Get nested value from object using dot notation
 * Example: getNestedValue({user: {name: 'Alice'}}, 'user.name') => 'Alice'
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

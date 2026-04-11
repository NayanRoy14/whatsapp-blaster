/**
 * templateService.js
 * Renders message templates by substituting placeholders with contact data.
 * Supports {name}, {phone}, and any other contact field.
 */

/**
 * Render a template string using a contact object.
 * All {key} placeholders are replaced with the corresponding contact field.
 * Unknown placeholders are left as-is (with a warning comment removed for prod).
 *
 * @param {string} template  - e.g. "Hello {name}, your number is {phone}"
 * @param {Object} contact   - e.g. { name: "Alice", phone: "14155552671" }
 * @returns {string}         - rendered message
 */
function render(template, contact) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const val = contact[key];
    return val !== undefined && val !== null ? String(val) : match;
  });
}

/**
 * Extract all placeholder keys from a template.
 * @param {string} template
 * @returns {string[]}
 */
function extractPlaceholders(template) {
  const matches = template.matchAll(/\{(\w+)\}/g);
  return [...new Set([...matches].map(m => m[1]))];
}

/**
 * Validate that a template has at least one non-whitespace character.
 * @param {string} template
 * @returns {{ valid: boolean, error?: string }}
 */
function validate(template) {
  if (!template || !template.trim()) {
    return { valid: false, error: 'Template cannot be empty' };
  }
  return { valid: true };
}

module.exports = { render, extractPlaceholders, validate };

/**
 * csvService.js
 * Parses uploaded CSV files into contact objects.
 * Validates phone numbers and deduplicates entries.
 */

const fs = require('fs');
const { parse } = require('csv-parse/sync');

// Phone must be digits only, 7–15 chars (E.164 without '+')
const PHONE_REGEX = /^\d{7,15}$/;

/**
 * Parse a CSV file and return validated contacts.
 * Expected columns: name, phone
 * @param {string} filePath
 * @returns {Promise<Array<{name: string, phone: string}>>}
 */
async function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');

  const records = parse(raw, {
    columns: true,         // use first row as keys
    skip_empty_lines: true,
    trim: true,
    bom: true,             // handle UTF-8 BOM
  });

  if (!records.length) throw new Error('CSV is empty');

  // Normalize column names to lowercase
  const contacts = [];
  const seen = new Set();
  const errors = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    // Support varied column names
    const name  = (row.name  || row.Name  || row.NAME  || '').trim();
    const phone = (row.phone || row.Phone || row.PHONE || row.number || row.Number || '').trim()
                    .replace(/\s+/g, '')   // strip spaces
                    .replace(/^\+/, '');   // strip leading +

    if (!name) {
      errors.push(`Row ${i + 2}: missing name`);
      continue;
    }

    if (!PHONE_REGEX.test(phone)) {
      errors.push(`Row ${i + 2}: invalid phone "${phone}" for "${name}" — must be digits with country code, e.g. 14155552671`);
      continue;
    }

    if (seen.has(phone)) {
      errors.push(`Row ${i + 2}: duplicate phone ${phone}, skipping`);
      continue;
    }

    seen.add(phone);
    contacts.push({ name, phone });
  }

  if (!contacts.length) {
    const msg = errors.length ? errors.join('\n') : 'No valid contacts found';
    throw new Error(msg);
  }

  return { contacts, errors };
}

module.exports = { parse: parseCSV };

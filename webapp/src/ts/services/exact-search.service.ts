import { Injectable } from '@angular/core';

import { DbService } from '@mm-services/db.service';

/**
 * Satoru EMR: "disable partial search".
 *
 * Stock CHT freetext search matches by prefix, so typing "Ka" and pressing
 * Enter lists every Kamala, Kavya and Karthik. With
 * `settings.search_exact_match` turned on, a text search only returns a
 * person - or a report about them - when the search text is their complete
 * name, complete participant ID, or complete phone number. Case and repeated
 * spaces are ignored.
 *
 * It narrows the doc ids the search library already found, before they are
 * loaded for display, so the People and Reports lists both follow it.
 * Searches using `field:value` syntax are already exact lookups and are left
 * alone.
 */

const TEXT_FIELDS = ['name', 'cr_no', 'patient_id', '_id'];
const PHONE_FIELDS = ['phone', 'alternate_phone'];
// fewer digits than this is never treated as a phone number, so a short
// participant ID like "79704" cannot accidentally match the end of a phone
const MIN_PHONE_DIGITS = 7;
const LOCAL_PHONE_DIGITS = 10;

const normalizeText = (value): string => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const digitsOf = (value): string => String(value ?? '').replace(/\D/g, '');

const phoneMatches = (stored, query: string): boolean => {
  const a = digitsOf(stored);
  const b = digitsOf(query);
  if (!a || b.length < MIN_PHONE_DIGITS) {
    return false;
  }
  if (a === b) {
    return true;
  }
  // "9000010001" should find "+91 90000 10001"
  return a.length >= LOCAL_PHONE_DIGITS
    && b.length >= LOCAL_PHONE_DIGITS
    && a.slice(-LOCAL_PHONE_DIGITS) === b.slice(-LOCAL_PHONE_DIGITS);
};

@Injectable({
  providedIn: 'root'
})
export class ExactSearchService {
  constructor(private readonly dbService: DbService) {}

  isEnabled(settings, search?: string): boolean {
    return !!settings?.search_exact_match
      && typeof search === 'string'
      && !!search.trim()
      && !search.includes(':');
  }

  async filter(type: string, docIds: string[], search: string): Promise<string[]> {
    if (!docIds?.length) {
      return [];
    }
    const query = normalizeText(search);
    const docs = await this.getDocs(docIds);

    if (type === 'reports') {
      return this.filterReports(docs, query, search);
    }
    return docs
      .filter(doc => this.personMatches(doc, query, search))
      .map(doc => doc._id);
  }

  private async filterReports(reports, query: string, search: string): Promise<string[]> {
    const subjectIds = [...new Set(reports.map(report => this.subjectId(report)).filter(Boolean))];
    const subjects = await this.getDocs(subjectIds as string[]);
    const subjectsById = new Map(subjects.map(doc => [doc._id, doc]));

    return reports
      .filter((report) => {
        const fields = report.fields || {};
        const reportValues = [fields.patient_name, fields.patient_id, report.patient_id];
        if (reportValues.some(value => value !== undefined && normalizeText(value) === query)) {
          return true;
        }
        const subject = subjectsById.get(this.subjectId(report));
        return !!subject && this.personMatches(subject, query, search);
      })
      .map(report => report._id);
  }

  private personMatches(doc, query: string, search: string): boolean {
    if (!doc) {
      return false;
    }
    const textMatch = TEXT_FIELDS.some(field => doc[field] !== undefined && normalizeText(doc[field]) === query);
    return textMatch || PHONE_FIELDS.some(field => phoneMatches(doc[field], search));
  }

  private subjectId(report): string | undefined {
    const fields = report?.fields || {};
    return fields.patient_uuid || fields.place_id || undefined;
  }

  // keeps the order the search library returned, and drops ids that no longer exist
  private async getDocs(ids: string[]) {
    if (!ids.length) {
      return [];
    }
    const result = await this.dbService.get().allDocs({ keys: ids, include_docs: true });
    return result.rows
      .filter(row => row.doc)
      .map(row => row.doc);
  }
}
